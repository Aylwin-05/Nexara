import base64
import json
import logging
import time
from datetime import datetime
from urllib.parse import urlparse
from uuid import UUID

import httpx
from app.core.config import settings
from app.core.utc import UTC
from app.database.session import AsyncSessionLocal
from app.models.push_subscription import PushSubscription
from app.repositories.push_repository import PushRepository
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from http_ece import encrypt as ece_encrypt
from jose import jwt

logger = logging.getLogger("app.services.push")

VAPID_KEYS_SETTING = "vapid.private_key"
VAPID_PUBLIC_SETTING = "vapid.public_key"
VAPID_TOKEN_TTL_SECONDS = 12 * 60 * 60
PUSH_TTL_SECONDS = 600
CALL_PUSH_TTL_SECONDS = 1800

# Pre-shared httpx client with HTTP/2 enabled: Web Push endpoints
# require HTTP/2. A single long-lived client keeps the connection
# pool warm across pushes.
_client: httpx.AsyncClient | None = None


def _b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def _http_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(http2=True, timeout=10.0)
    return _client


class PushService:
    """
    Web Push (VAPID + aes128gcm) delivery.

    Notifications never carry plaintext: message content is
    end-to-end encrypted and lives only on the clients, so push
    payloads carry sender + conversation metadata only. The
    service worker shows a redacted notification ("New message
    from X") and the real content is decrypted in the app.
    """

    def __init__(self):
        # Cached (private_pem, public_b64url); loaded lazily.
        self._vapid: tuple[str, str] | None = None

    # ==========================================================
    # VAPID keypair (generated once, persisted in app_settings)
    # ==========================================================

    async def _ensure_vapid_keys(
        self,
        repo: PushRepository,
    ) -> tuple[str, str]:

        if self._vapid is not None:
            return self._vapid

        private_pem = await repo.get_setting(VAPID_KEYS_SETTING)
        public_b64 = await repo.get_setting(VAPID_PUBLIC_SETTING)

        if private_pem and public_b64:
            self._vapid = (private_pem, public_b64)
            return self._vapid

        private_key = ec.generate_private_key(ec.SECP256R1())

        private_pem = private_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode()

        # Uncompressed point (65 bytes), base64url — the exact
        # format the browser's PushManager expects.
        public_bytes = private_key.public_key().public_bytes(
            serialization.Encoding.X962,
            serialization.PublicFormat.UncompressedPoint,
        )

        public_b64 = _b64url_encode(public_bytes)

        await repo.set_setting(VAPID_KEYS_SETTING, private_pem)
        await repo.set_setting(VAPID_PUBLIC_SETTING, public_b64)
        await repo.commit()

        self._vapid = (private_pem, public_b64)

        logger.info("Generated new VAPID keypair for Web Push")

        return self._vapid

    async def get_vapid_public_key(self) -> str | None:

        async with AsyncSessionLocal() as db:
            repo = PushRepository(db)
            _, public_b64 = await self._ensure_vapid_keys(repo)
            return public_b64

    # ==========================================================
    # Delivery
    # ==========================================================

    async def _send_to_subscription(
        self,
        repo: PushRepository,
        subscription: PushSubscription,
        payload: dict,
        ttl: int | None = None,
        urgency: str | None = None,
    ) -> bool:
        """
        Deliver one encrypted push. Returns False when the
        subscription is dead (404/410) and should be dropped.
        """

        private_pem, public_b64 = await self._ensure_vapid_keys(repo)

        origin = urlparse(subscription.endpoint)

        audience = f"{origin.scheme}://{origin.netloc}"

        token = jwt.encode(
            {
                "aud": audience,
                "exp": int(time.time()) + VAPID_TOKEN_TTL_SECONDS,
                "sub": f"mailto:{settings.SMTP_FROM_EMAIL}",
            },
            private_pem,
            algorithm="ES256",
            headers={"typ": "JWT"},
        )

        # Ephemeral ECDH keypair: its public key is embedded in
        # the aes128gcm header so the browser's subscription can
        # derive the shared secret and decrypt the payload.
        #
        # `dh` must be set (the recipient's public key) or
        # http_ece skips the auth secret on the encrypt side,
        # which would break the browser's decrypt.
        ephemeral = ec.generate_private_key(ec.SECP256R1())

        receiver_public = _b64url_decode(subscription.p256dh)

        ciphertext = ece_encrypt(
            json.dumps(payload).encode(),
            salt=None,
            key=receiver_public,
            dh=receiver_public,
            auth_secret=_b64url_decode(subscription.auth),
            private_key=ephemeral,
        )

        headers = {
            "Authorization": f"vapid t={token}, k={public_b64}",
            "Content-Encoding": "aes128gcm",
            "TTL": str(ttl or PUSH_TTL_SECONDS),
            "Content-Type": "application/octet-stream",
        }
        if urgency:
            headers["Urgency"] = urgency

        response = await _http_client().post(
            subscription.endpoint,
            content=ciphertext,
            headers=headers,
        )

        if response.status_code in (404, 410):
            logger.info(
                "Push subscription gone (%s), dropping",
                response.status_code,
            )
            return False

        if response.status_code >= 400:
            logger.warning(
                "Push failed: status=%s body=%s",
                response.status_code,
                response.text[:200],
            )

        return True

    # ==========================================================
    # notify_user — all subscriptions of one user
    # ==========================================================

    async def notify_user(
        self,
        user_id: UUID,
        payload: dict,
        *,
        ttl: int | None = None,
        urgency: str | None = None,
    ) -> None:

        try:
            async with AsyncSessionLocal() as db:
                repo = PushRepository(db)

                subscriptions = await repo.get_subscriptions(user_id)

                if not subscriptions:
                    return

                for subscription in subscriptions:
                    alive = await self._send_to_subscription(
                        repo,
                        subscription,
                        payload,
                        ttl=ttl,
                        urgency=urgency,
                    )

                    if not alive:
                        await repo.delete_subscription(
                            user_id,
                            subscription.id,
                        )

                await db.commit()

        except Exception:
            logger.exception(
                "Web Push delivery failed for user=%s",
                user_id,
            )

    # ==========================================================
    # Message pushes (respects per-user conversation muting)
    # ==========================================================

    async def notify_message(
        self,
        *,
        recipient_ids: list[UUID],
        sender_id: UUID,
        sender_name: str,
        conversation_id: UUID,
        conversation_type: str,
    ) -> None:

        if not recipient_ids:
            return

        try:
            async with AsyncSessionLocal() as db:
                if db.bind.dialect.name == "postgresql":
                    from sqlalchemy import text

                    await db.execute(
                        text("SELECT set_config('app.current_user_id', 'system', true)")
                    )

                from app.models.conversation_participant import (
                    ConversationParticipant,
                )
                from sqlalchemy import select

                now = datetime.now(UTC)

                result = await db.execute(
                    select(
                        ConversationParticipant.user_id,
                        ConversationParticipant.muted_until,
                    ).where(
                        ConversationParticipant.conversation_id == conversation_id,
                        ConversationParticipant.user_id.in_(recipient_ids),
                    )
                )

                muted = {
                    user_id
                    for user_id, muted_until in result.all()
                    if (muted_until is not None and self._muted_at(muted_until) > now)
                }

                for recipient_id in recipient_ids:
                    if recipient_id == sender_id:
                        continue

                    if recipient_id in muted:
                        continue

                    await self.notify_user(
                        recipient_id,
                        {
                            "event": "message",
                            "sender_id": str(sender_id),
                            "sender_name": sender_name,
                            "conversation_id": str(conversation_id),
                            "conversation_type": conversation_type,
                        },
                    )

        except Exception:
            logger.exception(
                "Message push fan-out failed for conversation=%s",
                conversation_id,
            )

    def _muted_at(self, muted_until):
        if muted_until.tzinfo is None:
            return muted_until.replace(tzinfo=UTC)
        return muted_until

    # ==========================================================
    # Call pushes (incoming voice/video call to offline members)
    #
    # Unlike messages, calls are NOT muted by conversation mute:
    # muting silences message chatter, not ringing. Payload is
    # metadata only — no SDP, no call content.
    # ==========================================================

    async def notify_call(
        self,
        *,
        recipient_ids: list[UUID],
        sender_id: UUID,
        sender_name: str,
        conversation_id: UUID,
        conversation_type: str,
        call_type: str,
        call_id: str,
    ) -> None:

        if not recipient_ids:
            return

        try:
            for recipient_id in recipient_ids:
                if recipient_id == sender_id:
                    continue

                await self.notify_user(
                    recipient_id,
                    {
                        "event": "call_offer",
                        "sender_id": str(sender_id),
                        "sender_name": sender_name,
                        "conversation_id": str(conversation_id),
                        "conversation_type": conversation_type,
                        "call_type": call_type,
                        "call_id": str(call_id),
                    },
                    ttl=CALL_PUSH_TTL_SECONDS,
                    urgency="high",
                )

        except Exception:
            logger.exception(
                "Call push fan-out failed for call=%s",
                call_id,
            )

    # ==========================================================
    # Story pushes (new 24h status from a friend)
    # ==========================================================

    async def notify_story(
        self,
        *,
        friend_ids: list[UUID],
        owner_name: str,
        story_id: UUID,
    ) -> None:

        for friend_id in friend_ids:
            await self.notify_user(
                friend_id,
                {
                    "event": "story",
                    "sender_name": owner_name,
                    "story_id": str(story_id),
                },
            )


push_service = PushService()
