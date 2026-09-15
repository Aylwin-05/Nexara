from datetime import UTC, datetime, timedelta
from uuid import UUID

from app.models.device import (
    Device,
    OneTimePreKey,
    SignedPreKey,
)
from app.models.user import User
from app.repositories.device_repository import DeviceRepository
from app.services.recovery_service import create_recovery_key
from sqlalchemy.exc import IntegrityError

# Default number of one-time prekeys to keep available
ONE_TIME_PREKEY_TARGET = 100

# Signed prekeys expire after this many days; the client should
# rotate before this deadline.
SIGNED_PREKEY_TTL_DAYS = 30


class DeviceService:
    """
    Manages devices and their Signal Protocol key material.

    Key generation happens entirely on the client; the server
    stores ONLY the public key material (identity, signed prekey,
    one-time prekeys). Private halves live in the device's local
    key store, so the server can never decrypt handshakes.
    """

    def __init__(self, repository: DeviceRepository):
        self.repository = repository

    # ==========================================================
    # Device Registration
    # ==========================================================

    async def register_device(
        self,
        user: User,
        *,
        device_id: str,
        platform: str = "other",
        device_name: str | None = None,
        platform_version: str | None = None,
        app_version: str | None = None,
        identity_key_public: str,  # b64 Ed25519 public
        identity_key_x25519: str,  # b64 X25519 public
        signed_prekey_public: str,  # b64 X25519 public
        signed_prekey_id: int,
        signed_prekey_signature: str,  # b64 Ed25519 sig
        one_time_prekeys: list[dict],  # [{key_id, public_key}]
    ) -> tuple[Device, dict | None]:
        """Register (or re-register) a device with its PUBLIC key material.

        Private key material never leaves the client.

        The FIRST device registered on an account also mints the
        recovery key (code + wrapped sync secret). The code is
        returned exactly once — in this call's result — and never
        stored server-side.
        """

        existing = await self.repository.get_by_device_id(device_id)
        recovery_info: dict | None = None
        if existing is not None:
            # A device_id is client-chosen ("web-<uuid>") but must be
            # bound to the account that created it. Overwriting key
            # material of another user's device would let anyone
            # hijack that device's identity (permanent MITM).
            if existing.user_id != user.id:
                raise PermissionError("This device is registered to another account.")

            existing.identity_key_public = identity_key_public
            existing.identity_key_x25519 = identity_key_x25519
            existing.is_active = True
            existing.platform = platform
            existing.device_name = device_name
            existing.app_version = app_version
            existing.unregistered_at = None
            device = existing
            await self.repository.update()
        else:
            is_first = (await self.repository.count_active_devices(user.id)) == 0
            device = Device(
                user_id=user.id,
                device_id=device_id,
                platform=platform,
                device_name=device_name,
                platform_version=platform_version,
                app_version=app_version,
                is_primary=is_first,
                is_active=True,
                identity_key_public=identity_key_public,
                identity_key_x25519=identity_key_x25519,
            )

            try:
                await self.repository.create_device(device)
                await self.repository.flush()
                # Race-free primary assignment: if this is the first
                # device, exactly one of any concurrent registrations
                # wins the primary flag (guarded by the partial unique
                # index on is_primary=true).
                if is_first:
                    await self.repository.claim_primary_for_new_device(device)
            except IntegrityError:
                # A concurrent registration inserted the same
                # device_id (or claimed primary) first. Roll back
                # and treat this as idempotent re-registration.
                await self.repository.rollback()
                reloaded = await self.repository.get_by_device_id(device_id)
                if reloaded is not None and reloaded.user_id == user.id:
                    device = reloaded
                else:
                    raise

            # First device on the account -> mint the recovery key
            # (unless one already exists). The plaintext code lives
            # only in this return value; server keeps salt + blob.
            if user.recovery_salt is None and user.recovery_wrapped_key is None:
                recovery = create_recovery_key()
                user.recovery_salt = recovery["salt"]
                user.recovery_wrapped_key = recovery["wrapped_key"]
                recovery_info = {
                    "code": recovery["code"],
                    "salt": recovery["salt"],
                    "wrapped_key": recovery["wrapped_key"],
                }

        # Signed prekey (the latest id from the client replaces the old one)
        existing_spk = await self.repository.get_signed_prekey(device.id, signed_prekey_id)
        if existing_spk is None:
            expires = datetime.now(UTC) + timedelta(days=SIGNED_PREKEY_TTL_DAYS)
            await self.repository.create_signed_prekey(
                SignedPreKey(
                    device_id=device.id,
                    key_id=signed_prekey_id,
                    public_key=signed_prekey_public,
                    signature=signed_prekey_signature,
                    expires_at=expires,
                )
            )

        # One-time prekeys (batch upload, public halves only)
        for opk in one_time_prekeys:
            await self.repository.create_one_time_prekey(
                OneTimePreKey(
                    device_id=device.id,
                    key_id=opk["key_id"],
                    public_key=opk["public_key"],
                )
            )

        await self.repository.commit()
        await self.repository.refresh(device)
        return device, recovery_info

    # ==========================================================
    # One-Time PreKey upload (client-generated batch)
    # ==========================================================

    async def upload_one_time_prekeys(
        self,
        device: Device,
        one_time_prekeys: list[dict],
    ) -> list[dict]:
        """
        Append a client-generated batch of one-time prekeys to an
        existing device.

        The client (not the server) generates and holds the private
        halves; the server only stores the public payload so other
        peers can initiate X3DH handshakes with this device.
        Duplicate key_ids are skipped (upload is idempotent).
        """
        stored = []
        for opk in one_time_prekeys:
            existing = await self.repository.get_one_time_prekey(device.id, opk["key_id"])
            if existing is not None:
                continue
            row = OneTimePreKey(
                device_id=device.id,
                key_id=opk["key_id"],
                public_key=opk["public_key"],
            )
            await self.repository.create_one_time_prekey(row)
            stored.append(row)

        await self.repository.commit()
        return stored

    # ==========================================================
    # Signed PreKey Rotation
    # ==========================================================

    async def rotate_signed_prekey(
        self,
        device: Device,
        *,
        key_id: int,
        public_key: str,
        signature: str,
    ) -> dict:
        """Upload a fresh signed prekey and expire older ones.

        The client generates a new X25519 keypair, signs the
        public half with the device identity key, and uploads
        it here. The server stores the new key, marks all
        previous SPKs as expired, and garbage-collects old
        expired entries that are no longer the latest.
        """
        expires = datetime.now(UTC) + timedelta(days=SIGNED_PREKEY_TTL_DAYS)
        new_spk = await self.repository.rotate_signed_prekey(
            device.id,
            key_id=key_id,
            public_key=public_key,
            signature=signature,
            expires_at=expires,
        )
        purged = await self.repository.purge_superseded_signed_prekeys(device.id)
        await self.repository.commit()

        return {
            "key_id": new_spk.key_id,
            "public_key": new_spk.public_key,
            "signature": new_spk.signature,
            "expires_at": new_spk.expires_at.isoformat() if new_spk.expires_at else None,
            "purged": purged,
        }

    # ==========================================================
    # Key Bundle serving (used by X3DH initiators)
    # ==========================================================

    async def get_device_bundle(
        self,
        user_id: UUID,
    ) -> dict:
        """
        Return a key bundle for ALL active devices of a user, ready for
        X3DH initiation.
        """
        devices = await self.repository.get_by_user_id(user_id)
        if not devices:
            return {"user_id": str(user_id), "devices": []}

        devices_data = []
        for device in devices:
            spks = await self.repository.get_active_signed_prekeys(device.id)
            if not spks:
                continue
            spk = spks[0]

            if spk.expires_at:
                exp = (
                    spk.expires_at.replace(tzinfo=UTC)
                    if spk.expires_at.tzinfo is None
                    else spk.expires_at
                )
                if exp < datetime.now(UTC):
                    continue

            # One-time prekeys are single-use: serving one consumes
            # it (atomic conditional UPDATE), so two handshakes can
            # never be built on the same prekey.
            opks = await self.repository.reserve_one_time_prekeys(device.id, limit=1)
            opk_data = None
            if opks:
                opk_data = {
                    "key_id": opks[0].key_id,
                    "public_key": opks[0].public_key,
                }

            devices_data.append(
                {
                    "device_id": device.device_id,
                    "identity_key": device.identity_key_public,
                    "x25519_identity_key": device.identity_key_x25519,
                    "signed_prekey": {
                        "key_id": spk.key_id,
                        "public_key": spk.public_key,
                        "signature": spk.signature,
                    },
                    "one_time_prekeys": [opk_data] if opk_data else [],
                }
            )

        await self.repository.commit()
        return {"user_id": str(user_id), "devices": devices_data}

    # ===========================================================
    # One-Time PreKey replenishment
    # ===========================================================

    async def replenish_one_time_prekeys_for_user(
        self,
        user_id: UUID,
    ) -> list[dict]:
        """Report the OPK supply across all active devices of a user.

        The server never generates prekeys (private halves must stay
        client-side); the client tops up via /prekeys/upload.
        """
        devices = await self.repository.get_by_user_id(user_id)
        total = []
        for device in devices:
            opks = await self.repository.get_unconsumed_one_time_prekeys(
                device.id, limit=ONE_TIME_PREKEY_TARGET
            )
            total.append(
                {
                    "device_id": device.device_id,
                    "count": len(opks),
                }
            )
        return total

    # ================================================================
    # Helpers
    # ================================================================

    async def get_device_signed_prekey(
        self,
        device: Device,
        key_id: int,
    ):
        """Fetch a signed prekey row (public material)."""
        spk = await self.repository.get_signed_prekey(device.id, key_id)
        if spk is None:
            return None
        return {
            "key_id": spk.key_id,
            "public_key": spk.public_key,
            "signature": spk.signature,
        }

    async def get_device_one_time_prekey(
        self,
        device: Device,
        key_id: int,
    ):
        """Fetch an OPK row (public material)."""
        opk = await self.repository.get_one_time_prekey(device.id, key_id)
        if opk is None:
            return None
        return {
            "key_id": opk.key_id,
            "public_key": opk.public_key,
        }
