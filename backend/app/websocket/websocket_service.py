import logging
from uuid import UUID

from app.core.rate_limit import (
    get_limiter,
)
from app.core.utc import UTC
from app.models.user import User
from app.repositories.conversation_repository import (
    ConversationRepository,
)
from app.repositories.message_repository import (
    MessageRepository,
)
from app.websocket.connection_manager import manager
from fastapi import WebSocket

logger = logging.getLogger("app.websocket.websocket_service")

WS_RATE_LIMITS = {
    "message": (30, 60),
    "edit": (30, 60),
    "delete": (30, 60),
    "typing": (120, 60),
    "stop_typing": (120, 60),
    "chat_open": (120, 60),
    "chat_close": (120, 60),
    "delivered": (120, 60),
    "read": (120, 60),
    "call_offer": (60, 60),
    "call_answer": (60, 60),
    "call_ice": (60, 60),
    "call_end": (60, 60),
    "location_update": (60, 60),
}


class WebSocketService:
    """
    Nexara WebSocket Service

    IMPORTANT
    ---------
    WebSocket NEVER stores messages.

    Messages are stored by:

        POST /messages/send

    WebSocket only broadcasts realtime events.

    Responsibilities
    ----------------
    ✓ Verify conversation access
    ✓ Broadcast new encrypted messages
    ✓ Typing indicators
    ✓ Stop typing
    ✓ Read receipts
    ✓ Delivery receipts
    ✓ Edit notifications
    ✓ Delete notifications
    ✓ Ping / Pong
    """

    def __init__(self, db):

        self.db = db

        self.conversation_repository = ConversationRepository(db)

        self.message_repository = MessageRepository(db)

        # Built once per WebSocketService instance (one per
        # connection) instead of re-creating the dict on every
        # incoming event.
        self._handlers = {
            "message": self.handle_message,
            "typing": self.handle_typing,
            "stop_typing": self.handle_stop_typing,
            "chat_open": self.handle_chat_open,
            "chat_close": self.handle_chat_close,
            "delivered": self.handle_delivered,
            "read": self.handle_read,
            "edit": self.handle_edit,
            "delete": self.handle_delete,
            "call_offer": self.handle_call,
            "call_answer": self.handle_call,
            "call_ice": self.handle_call,
            "call_end": self.handle_call,
            "location_update": self.handle_location_update,
        }

    # ======================================================
    # Authorization
    # ======================================================

    async def verify_access(
        self,
        conversation_id: UUID,
        current_user: User,
    ) -> bool:

        participants = await self.conversation_repository.get_participants(conversation_id)

        return any(participant.user_id == current_user.id for participant in participants)

    # ======================================================
    # Event Dispatcher
    # ======================================================

    async def handle_event(
        self,
        websocket: WebSocket,
        current_user: User,
        data: dict,
    ):

        event = data.get("event")

        if event == "ping":
            await self.handle_ping(websocket)

            return

        limits = WS_RATE_LIMITS.get(event)
        if limits:
            limiter = get_limiter()
            limit, window = limits
            await limiter.check(
                f"ws:{current_user.id}:{event}",
                limit,
                window,
            )

        if event == "sync_request":
            await self.handle_sync_request(current_user, data)
            return

        # The socket is user-scoped (/ws/me), so every real event
        # must declare which conversation it targets AND the sender
        # must be a participant of it.
        raw_cid = data.get("conversation_id", "")

        if not raw_cid:
            raise ValueError("Missing 'conversation_id' in event payload.")

        conversation_id = UUID(raw_cid)

        if not await self.verify_access(
            conversation_id,
            current_user,
        ):
            raise ValueError("Access denied.")

        handler = self._handlers.get(event)

        if handler is None:
            raise ValueError(f"Unknown websocket event '{event}'")

        await handler(
            conversation_id,
            current_user,
            data,
        )

    # ======================================================
    # MESSAGE
    #
    # IMPORTANT
    #
    # Message has ALREADY been saved by:
    #
    # POST /messages/send
    #
    # WebSocket only broadcasts it.
    # ======================================================

    async def handle_message(
        self,
        conversation_id: UUID,
        current_user: User,
        data: dict,
    ):

        required = [
            "id",
            "conversation_id",
            "sender_id",
            "ciphertext",
            "encrypted_key_sender",
            "encrypted_key_receiver",
            "nonce",
            "created_at",
        ]

        for field in required:
            if field not in data:
                raise ValueError(f"Missing field '{field}'.")

        exclude = await self._blocked_recipients(
            conversation_id,
            current_user.id,
        )

        await manager.broadcast(
            conversation_id,
            {
                "event": "message",
                "id": data["id"],
                "conversation_id": data["conversation_id"],
                "sender_id": data["sender_id"],
                "ciphertext": data["ciphertext"],
                "encrypted_key_sender": data["encrypted_key_sender"],
                "encrypted_key_receiver": data["encrypted_key_receiver"],
                "nonce": data["nonce"],
                "crypto_version": data.get(
                    "crypto_version",
                    1,
                ),
                "message_type": data.get(
                    "message_type",
                    "text",
                ),
                "reply_to_id": data.get("reply_to_id"),
                "edited": data.get(
                    "edited",
                    False,
                ),
                "deleted_for_everyone": data.get(
                    "deleted_for_everyone",
                    False,
                ),
                "is_read": data.get(
                    "is_read",
                    False,
                ),
                "expires_at": data.get("expires_at"),
                "created_at": data["created_at"],
                "updated_at": data.get(
                    "updated_at",
                    data["created_at"],
                ),
                "attachments": data.get(
                    "attachments",
                    [],
                ),
                "recipient_keys": data.get(
                    "recipient_keys",
                    [],
                ),
                "envelopes": data.get(
                    "envelopes",
                    [],
                ),
                "sync_envelope": data.get("sync_envelope"),
            },
            exclude_user_ids=exclude,
        )

        await self._push_new_message(
            conversation_id,
            current_user,
        )

    # ======================================================
    # EDIT MESSAGE
    # ======================================================

    async def handle_edit(
        self,
        conversation_id: UUID,
        current_user: User,
        data: dict,
    ):

        raw_message_id = data.get("message_id")
        if not raw_message_id:
            raise ValueError("Missing 'message_id' in event payload.")

        message_id = UUID(raw_message_id)

        message = await self.message_repository.get_by_id(message_id)

        if message is None:
            raise ValueError("Message not found.")

        if message.sender_id != current_user.id:
            raise ValueError("You can edit only your own messages.")

        if message.deleted_for_everyone:
            raise ValueError("Message has already been deleted.")

        from datetime import datetime

        # The edited content arrives already encrypted
        # (Signal ratchet): the server only swaps the payload
        # fields — the edited plaintext never touches it.
        if data.get("ciphertext"):
            message.ciphertext = data["ciphertext"]
            message.encrypted_key_sender = data.get(
                "encrypted_key_sender",
                message.encrypted_key_sender,
            )
            message.encrypted_key_receiver = data.get(
                "encrypted_key_receiver",
                message.encrypted_key_receiver,
            )
            message.nonce = data.get(
                "nonce",
                message.nonce,
            )

            # Group edits carry fresh per-recipient wrapped keys.
            if data.get("recipient_keys"):
                await self.message_repository.replace_recipient_keys(
                    message.id,
                    [
                        (
                            UUID(key["user_id"]),
                            key["encrypted_key"],
                        )
                        for key in data["recipient_keys"]
                    ],
                )

            # Multi-device edits carry fresh per-device envelopes.
            if data.get("envelopes"):
                message.envelopes = [
                    {
                        "device_id": env["device_id"],
                        "data": env["data"],
                    }
                    for env in data["envelopes"]
                ]

            # Edited content is a fresh plaintext: replace the
            # account-key copy so other browsers don't keep the
            # stale text.
            if data.get("sync_envelope"):
                message.sync_envelope = data["sync_envelope"]

        message.edited = True
        message.updated_at = datetime.now(UTC)

        await self.message_repository.update()

        await manager.broadcast(
            conversation_id,
            {
                "event": "edit",
                "message_id": str(message.id),
                "sender_id": str(message.sender_id),
                "edited": True,
                "ciphertext": data.get(
                    "ciphertext",
                    message.ciphertext,
                ),
                "encrypted_key_sender": message.encrypted_key_sender,
                "encrypted_key_receiver": message.encrypted_key_receiver,
                "nonce": message.nonce,
                "recipient_keys": [
                    {
                        "user_id": str(key.user_id),
                        "encrypted_key": key.encrypted_key,
                    }
                    for key in message.recipient_keys
                ]
                if "recipient_keys" in message.__dict__
                else [],
                "envelopes": message.envelopes or [],
                "sync_envelope": message.sync_envelope,
                "updated_at": message.updated_at.isoformat(),
            },
        )

    # ======================================================
    # DELETE MESSAGE
    # ======================================================

    async def handle_delete(
        self,
        conversation_id: UUID,
        current_user: User,
        data: dict,
    ):

        raw_message_id = data.get("message_id")
        if not raw_message_id:
            raise ValueError("Missing 'message_id' in event payload.")

        message_id = UUID(raw_message_id)

        message = await self.message_repository.get_by_id(message_id)

        if message is None:
            raise ValueError("Message not found.")

        if message.sender_id != current_user.id:
            raise ValueError("You can delete only your own messages.")

        from datetime import datetime

        # The REST 'delete for everyone' endpoint normally runs
        # first and already sets the flag; this WS event is the
        # real-time notification. Skip the write when it is
        # already deleted, but ALWAYS broadcast so the other
        # participant's UI updates without a reload.
        if not message.deleted_for_everyone:
            message.deleted_for_everyone = True
            message.updated_at = datetime.now(UTC)

            await self.message_repository.update()

        await manager.broadcast(
            conversation_id,
            {
                "event": "delete",
                "message_id": str(message.id),
                "deleted_for_everyone": True,
                "updated_at": message.updated_at.isoformat(),
            },
        )

    # ======================================================
    # DELIVERED RECEIPT
    # ======================================================

    async def handle_delivered(
        self,
        conversation_id: UUID,
        current_user: User,
        data: dict,
    ):

        raw_message_id = data.get("message_id")
        if not raw_message_id:
            raise ValueError("Missing 'message_id' in event payload.")

        message = await self.message_repository.get_by_id(UUID(raw_message_id))

        if message is None:
            raise ValueError("Message not found.")

        await self.message_repository.mark_delivered(message)

        await manager.broadcast(
            conversation_id,
            {
                "event": "delivered",
                "message_id": str(message.id),
                "user_id": str(current_user.id),
                "delivered_at": message.delivered_at.isoformat() if message.delivered_at else None,
            },
        )

    # ======================================================
    # READ RECEIPT
    # ======================================================

    async def handle_read(
        self,
        conversation_id: UUID,
        current_user: User,
        data: dict,
    ):

        raw_message_id = data.get("message_id")
        if not raw_message_id:
            raise ValueError("Missing 'message_id' in event payload.")

        message = await self.message_repository.get_by_id(UUID(raw_message_id))

        if message is None:
            raise ValueError("Message not found.")

        await self.message_repository.mark_read(message)

        await manager.broadcast(
            conversation_id,
            {
                "event": "read",
                "message_id": str(message.id),
                "user_id": str(current_user.id),
                "read_at": message.read_at.isoformat() if message.read_at else None,
            },
        )

    # ======================================================
    # VOICE / VIDEO CALL SIGNALING (WebRTC relay)
    #
    # The server is a dumb relay: it validates the conversation
    # membership (already done by the dispatcher), stamps the
    # sender id on the event and broadcasts it to every member.
    # Media itself is P2P (DTLS-SRTP encrypted) and never
    # touches the server.
    # ======================================================

    async def handle_call(
        self,
        conversation_id: UUID,
        current_user: User,
        data: dict,
    ):

        event = data.get("event")

        if not data.get("call_id"):
            raise ValueError("Missing field 'call_id'.")

        if event == "call_offer" and not data.get("call_type"):
            raise ValueError("Missing field 'call_type'.")

        payload = {
            "event": event,
            "conversation_id": str(conversation_id),
            "call_id": data["call_id"],
            "from": str(current_user.id),
        }

        # Optional addressing: "to" lets callers target one peer
        # (ICE candidates, answers); when absent the event goes
        # to every member.
        if data.get("to"):
            payload["to"] = str(data["to"])

        if data.get("call_type"):
            payload["call_type"] = data["call_type"]

        if data.get("sdp"):
            payload["sdp"] = data["sdp"]

        if data.get("candidate"):
            payload["candidate"] = data["candidate"]

        if data.get("call_nonce"):
            payload["call_nonce"] = data["call_nonce"]

        if data.get("call_key_hash"):
            payload["call_key_hash"] = data["call_key_hash"]

        if data.get("answer_key_hash"):
            payload["answer_key_hash"] = data["answer_key_hash"]

        exclude = await self._blocked_recipients(
            conversation_id,
            current_user.id,
        )

        targeted = data.get("to")

        if targeted and UUID(targeted) in exclude:
            return

        await manager.broadcast(
            conversation_id,
            payload,
            exclude_user_ids=exclude,
        )

        # Ringing offers must not be lost to a briefly offline
        # recipient: keep the offer pending for members that
        # (re)connect within the ring window, and push-notify the
        # members with no live socket at all.
        if event == "call_offer":
            await manager.store_pending_call(
                conversation_id,
                payload,
            )

            await self._push_new_call(
                conversation_id,
                current_user,
                payload,
            )

        elif event == "call_end":
            await manager.drop_pending_call(data["call_id"])

    # ======================================================
    # TYPING
    # ======================================================

    async def handle_typing(
        self,
        conversation_id: UUID,
        current_user: User,
        data: dict,
    ):

        await manager.broadcast(
            conversation_id,
            {
                "event": "typing",
                "user_id": str(current_user.id),
                "conversation_id": str(conversation_id),
            },
        )

    # ======================================================
    # STOP TYPING
    # ======================================================

    async def handle_stop_typing(
        self,
        conversation_id: UUID,
        current_user: User,
        data: dict,
    ):

        await manager.broadcast(
            conversation_id,
            {
                "event": "stop_typing",
                "user_id": str(current_user.id),
                "conversation_id": str(conversation_id),
            },
        )

    # ======================================================
    # CHAT OPEN
    #
    # Snapchat-style "I'm viewing this conversation" signal.
    # Anyone who already had the chat open when this user
    # opened it missed this broadcast, so a one-shot snapshot
    # of current viewers makes up the gap (the frontend
    # filters the sender's own id / its own snapshot).
    # ======================================================

    async def handle_chat_open(
        self,
        conversation_id: UUID,
        current_user: User,
        data: dict,
    ):
        manager.mark_chat_open(
            current_user.id,
            conversation_id,
        )

        await manager.broadcast(
            conversation_id,
            {
                "event": "chat_open",
                "user_id": str(current_user.id),
                "conversation_id": str(conversation_id),
                "presence_animal": (current_user.presence_animal or "default"),
            },
        )

        viewers = manager.chat_open_viewers(conversation_id)

        if viewers:
            await manager.send_to_user(
                current_user.id,
                {
                    "event": "chat_open_snapshot",
                    "conversation_id": str(conversation_id),
                    "user_ids": viewers,
                },
            )

    # ======================================================
    # CHAT CLOSE
    # ======================================================

    async def handle_chat_close(
        self,
        conversation_id: UUID,
        current_user: User,
        data: dict,
    ):
        manager.mark_chat_closed(
            current_user.id,
            conversation_id,
        )

        await manager.broadcast(
            conversation_id,
            {
                "event": "chat_close",
                "user_id": str(current_user.id),
                "conversation_id": str(conversation_id),
            },
        )

    # ======================================================
    # LIVE LOCATION UPDATE (transient, never stored)
    # ======================================================

    async def handle_location_update(
        self,
        conversation_id: UUID,
        current_user: User,
        data: dict,
    ):

        lat = data.get("lat")
        lng = data.get("lng")

        if lat is None or lng is None:
            raise ValueError("Missing 'lat' or 'lng' in location_update payload.")

        await manager.broadcast_transient(
            conversation_id,
            {
                "event": "location_update",
                "conversation_id": str(conversation_id),
                "sender_id": str(current_user.id),
                "lat": lat,
                "lng": lng,
                "timestamp": data.get("timestamp"),
            },
        )

    # ======================================================
    # SYNC REQUEST
    #
    # A newly registered device sends this to ask its OTHER
    # online devices to re-upload sync envelopes for the
    # specified conversations.
    # ======================================================

    async def handle_sync_request(
        self,
        current_user: User,
        data: dict,
    ):
        conversation_ids = data.get("conversation_ids", [])
        notification = {
            "event": "sync_needed",
            "requester_id": str(current_user.id),
            "conversation_ids": conversation_ids,
        }
        await manager.send_to_user(
            current_user.id,
            notification,
        )

    # ======================================================
    # PING / PONG
    # ======================================================

    async def handle_ping(
        self,
        websocket: WebSocket,
    ):

        await websocket.send_json(
            {
                "event": "pong",
            }
        )

    # ======================================================
    # BLOCKED RECIPIENTS (message/call fan-out)
    #
    # A message or call event is only suppressed for recipients
    # whose conversation with the sender is blocked (either
    # direction). The sender's own sockets keep receiving their
    # own events.
    # ======================================================

    async def _blocked_recipients(
        self,
        conversation_id: UUID,
        sender_id: UUID,
    ) -> set:

        from app.models.block import Block
        from app.models.conversation_participant import (
            ConversationParticipant,
        )
        from sqlalchemy import and_, or_, select

        try:
            result = await self.db.execute(
                select(ConversationParticipant.user_id).where(
                    ConversationParticipant.conversation_id == conversation_id
                )
            )

            member_ids = set(result.scalars().all())

            block_result = await self.db.execute(
                select(
                    Block.blocker_id,
                    Block.blocked_id,
                ).where(
                    or_(
                        and_(
                            Block.blocker_id == sender_id,
                            Block.blocked_id.in_(member_ids),
                        ),
                        and_(
                            Block.blocked_id == sender_id,
                            Block.blocker_id.in_(member_ids),
                        ),
                    )
                )
            )

            blocked = set()

            for blocker_id, blocked_id in block_result.all():
                if blocker_id == sender_id:
                    blocked.add(blocked_id)

                if blocked_id == sender_id:
                    blocked.add(blocker_id)

            return blocked

        except Exception:
            logger.exception(
                "Block lookup failed for conversation=%s",
                conversation_id,
            )

            return set()

    # ======================================================
    # WEB PUSH NOTIFICATION (new message)
    #
    # The user-scoped socket already delivered the event to the
    # open app; Web Push covers every browser that is closed or
    # in the background. The service worker suppresses the
    # notification when the app is visible and focused, so there
    # is no double-notification. Payloads are redacted — message
    # content is end-to-end encrypted and never touches the
    # server, let alone the push provider.
    # ======================================================

    async def _push_new_message(
        self,
        conversation_id: UUID,
        current_user: User,
    ):

        try:
            from app.models.conversation import Conversation
            from app.services.push_service import push_service
            from app.websocket.connection_manager import manager
            from sqlalchemy import select

            member_ids = await manager._member_ids(
                conversation_id,
                user_id=current_user.id,
            )

            result = await self.db.execute(
                select(Conversation.conversation_type).where(Conversation.id == conversation_id)
            )

            conversation_type = result.scalar_one_or_none() or "private"

            await push_service.notify_message(
                recipient_ids=member_ids,
                sender_id=current_user.id,
                sender_name=current_user.display_name,
                conversation_id=conversation_id,
                conversation_type=conversation_type,
            )

        except Exception:
            logger.exception(
                "Push fan-out failed for conversation=%s",
                conversation_id,
            )

    # ======================================================
    # CALL PUSH
    #
    # The user-scoped socket delivers the offer to every ONLINE
    # member; Web Push covers the members whose socket is down
    # (closed tab, reconnect gap). Payload is metadata only — SDP
    # is never pushed, and the notification itself never contains
    # call content (media is peer-to-peer DTLS-SRTP).
    # ======================================================

    async def _push_new_call(
        self,
        conversation_id: UUID,
        current_user: User,
        payload: dict,
    ):

        try:
            from app.models.conversation import Conversation
            from app.services.push_service import push_service
            from app.websocket.connection_manager import manager
            from sqlalchemy import select

            member_ids = await manager._member_ids(
                conversation_id,
                user_id=current_user.id,
            )

            connected = await manager.connected_user_ids()

            offline_members = [member_id for member_id in member_ids if member_id not in connected]

            result = await self.db.execute(
                select(Conversation.conversation_type).where(Conversation.id == conversation_id)
            )

            conversation_type = result.scalar_one_or_none() or "private"

            await push_service.notify_call(
                recipient_ids=offline_members,
                sender_id=current_user.id,
                sender_name=current_user.display_name,
                conversation_id=conversation_id,
                conversation_type=conversation_type,
                call_type=payload.get(
                    "call_type",
                    "voice",
                ),
                call_id=payload["call_id"],
            )

        except Exception:
            logger.exception(
                "Call push fan-out failed for call=%s",
                payload.get("call_id"),
            )

    # ======================================================
    # VALIDATION HELPERS
    # ======================================================

    def validate_message_type(
        self,
        message_type: str,
    ):

        allowed = {
            "text",
            "image",
            "video",
            "audio",
            "document",
            "system",
            "location",
        }

        if message_type not in allowed:
            raise ValueError(f"Unsupported message type '{message_type}'.")

    async def ensure_participant(
        self,
        conversation_id: UUID,
        current_user: User,
    ):

        allowed = await self.verify_access(
            conversation_id,
            current_user,
        )

        if not allowed:
            raise ValueError("Access denied.")

    # ======================================================
    # END
    # ======================================================
