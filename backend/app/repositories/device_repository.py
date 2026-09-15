from datetime import UTC, datetime
from uuid import UUID

from app.models.device import Device, OneTimePreKey, SignedPreKey
from app.models.signal_session import SignalSession
from app.repositories.base_repository import BaseRepository
from sqlalchemy import func as sqlfunc
from sqlalchemy import select, update


class DeviceRepository(BaseRepository):
    """
    Repository responsible for Device, SignedPreKey, OneTimePreKey and
    SignalSession operations.
    """

    # ==========================================================
    # Devices
    # ==========================================================

    async def create_device(
        self,
        device: Device,
    ) -> Device:
        return await self.create(device)

    async def get_by_device_id(
        self,
        device_id: str,
    ) -> Device | None:
        result = await self.execute(select(Device).where(Device.device_id == device_id))
        return result.scalar_one_or_none()

    async def get_by_id(
        self,
        device_pk: UUID,
    ) -> Device | None:
        result = await self.execute(select(Device).where(Device.id == device_pk))
        return result.scalar_one_or_none()

    async def get_by_ids(
        self,
        device_pks: list[UUID],
    ) -> list[Device]:
        if not device_pks:
            return []
        result = await self.execute(select(Device).where(Device.id.in_(device_pks)))
        return list(result.scalars().all())

    async def get_by_user_id(
        self,
        user_id: UUID,
    ) -> list[Device]:
        result = await self.execute(
            select(Device)
            .where(
                Device.user_id == user_id,
                Device.is_active.is_(True),
            )
            .order_by(Device.is_primary.desc(), Device.registered_at)
        )
        return list(result.scalars().all())

    async def get_active_device_ids(
        self,
        user_id: UUID,
    ) -> list[str]:
        result = await self.execute(
            select(Device.device_id).where(
                Device.user_id == user_id,
                Device.is_active.is_(True),
            )
        )
        return list(result.scalars().all())

    async def get_owners_by_device_ids(
        self,
        device_ids: list[str],
    ) -> dict[str, UUID]:
        """Map device_id -> owning user_id for the given device ids."""
        if not device_ids:
            return {}
        result = await self.execute(
            select(
                Device.device_id,
                Device.user_id,
            ).where(Device.device_id.in_(device_ids))
        )
        return {row.device_id: row.user_id for row in result.all()}

    async def get_primary_device(
        self,
        user_id: UUID,
    ) -> Device | None:
        result = await self.execute(
            select(Device).where(
                Device.user_id == user_id,
                Device.is_primary.is_(True),
                Device.is_active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def set_primary(
        self,
        user_id: UUID,
        device_pk: UUID,
    ):
        # Demote all of the user's devices first
        await self.db.execute(
            update(Device)
            .where(Device.user_id == user_id)
            .values(is_primary=False)
            .execution_options(synchronize_session=False)
        )
        # Promote the target device
        await self.db.execute(
            update(Device)
            .where(Device.id == device_pk)
            .values(is_primary=True)
            .execution_options(synchronize_session=False)
        )

    async def disable_device(
        self,
        device_pk: UUID,
    ):
        await self.db.execute(
            update(Device)
            .where(Device.id == device_pk)
            .values(is_active=False)
            .execution_options(synchronize_session=False)
        )

    async def update_metadata(
        self,
        device_pk: UUID,
        *,
        device_name: str | None = None,
        platform_version: str | None = None,
        app_version: str | None = None,
    ):
        values: dict = {}
        if device_name is not None:
            values["device_name"] = device_name
        if platform_version is not None:
            values["platform_version"] = platform_version
        if app_version is not None:
            values["app_version"] = app_version
        if values:
            await self.db.execute(
                update(Device)
                .where(Device.id == device_pk)
                .values(**values)
                .execution_options(synchronize_session=False)
            )

    async def delete_device_prekeys(
        self,
        device_pk: UUID,
    ):
        """Drop all prekeys of a removed device.

        Public key material of a gone device is useless and must
        not linger: nothing may start a handshake with it again.
        """
        from sqlalchemy import delete

        await self.db.execute(delete(OneTimePreKey).where(OneTimePreKey.device_id == device_pk))
        await self.db.execute(delete(SignedPreKey).where(SignedPreKey.device_id == device_pk))

    async def count_active_devices(
        self,
        user_id: UUID,
    ) -> int:
        """Count active devices (single aggregate query)."""
        result = await self.db.execute(
            select(sqlfunc.count(Device.id)).where(
                Device.user_id == user_id,
                Device.is_active.is_(True),
            )
        )
        return int(result.scalar_one() or 0)

    async def claim_primary_for_new_device(
        self,
        device: Device,
    ) -> bool:
        """Atomically mark the first active device of a user as primary.

        Uses a conditional UPDATE retried around the partial unique
        index on (user_id, is_primary). When two registrations race
        to be the first device, only one may hold the primary flag.
        Returns True when this device is the (new) primary.
        """
        from sqlalchemy import update
        from sqlalchemy.exc import IntegrityError

        # Promote this device if it is the only active one.
        # The partial unique index (is_primary=true) is our guard:
        # if a concurrent request already made another device primary,
        # this UPDATE raises IntegrityError and we roll back only the
        # demotion/promotion pair, leaving the existing primary intact.
        try:
            promoted = await self.db.execute(
                update(Device)
                .where(
                    Device.id == device.id,
                    Device.is_active.is_(True),
                )
                .values(is_primary=True)
                .execution_options(synchronize_session=False)
            )
        except IntegrityError:
            await self.db.rollback()
            return False
        return promoted.rowcount == 1

    # ==========================================================
    # Signed PreKeys
    # ==========================================================

    async def create_signed_prekey(
        self,
        prekey: SignedPreKey,
    ) -> SignedPreKey:
        return await self.create(prekey)

    async def get_active_signed_prekeys(
        self,
        device_pk: UUID,
    ) -> list[SignedPreKey]:
        result = await self.execute(
            select(SignedPreKey)
            .where(
                SignedPreKey.device_id == device_pk,
            )
            .order_by(SignedPreKey.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_signed_prekey(
        self,
        device_pk: UUID,
        key_id: int,
    ) -> SignedPreKey | None:
        result = await self.execute(
            select(SignedPreKey).where(
                SignedPreKey.device_id == device_pk,
                SignedPreKey.key_id == key_id,
            )
        )
        return result.scalar_one_or_none()

    async def get_next_signed_prekey_id(
        self,
        device_pk: UUID,
    ) -> int:
        result = await self.execute(
            select(SignedPreKey.key_id)
            .where(
                SignedPreKey.device_id == device_pk,
            )
            .order_by(SignedPreKey.key_id.desc())
            .limit(1)
        )
        latest = result.scalar_one_or_none()
        return (latest or 0) + 1

    async def rotate_signed_prekey(
        self,
        device_pk: UUID,
        key_id: int,
        public_key: str,
        signature: str,
        expires_at,
    ) -> SignedPreKey:
        """Create a new signed prekey and expire all older ones."""

        new_spk = SignedPreKey(
            device_id=device_pk,
            key_id=key_id,
            public_key=public_key,
            signature=signature,
            expires_at=expires_at,
        )
        await self.create(new_spk)

        await self.db.execute(
            update(SignedPreKey)
            .where(
                SignedPreKey.device_id == device_pk,
                SignedPreKey.key_id < key_id,
            )
            .values(expires_at=datetime.now(UTC))
            .execution_options(synchronize_session=False)
        )

        return new_spk

    async def purge_superseded_signed_prekeys(
        self,
        device_pk: UUID,
    ) -> int:
        """Delete expired signed prekeys that are NOT the latest.

        The newest SPK is always kept (even if expired) so that
        in-flight handshakes can still complete. Older expired
        SPKs are hard-deleted.
        """
        from sqlalchemy import delete
        from sqlalchemy import func as sqlfunc

        subq = (
            select(sqlfunc.max(SignedPreKey.key_id))
            .where(SignedPreKey.device_id == device_pk)
            .scalar_subquery()
        )

        result = await self.db.execute(
            delete(SignedPreKey).where(
                SignedPreKey.device_id == device_pk,
                SignedPreKey.key_id < subq,
                SignedPreKey.expires_at.isnot(None),
                SignedPreKey.expires_at < datetime.now(UTC),
            )
        )
        return result.rowcount

    # ===========================================================
    # One-Time PreKeys
    # ===========================================================

    async def create_one_time_prekey(
        self,
        prekey: OneTimePreKey,
    ) -> OneTimePreKey:
        return await self.create(prekey)

    async def get_unconsumed_one_time_prekeys(
        self,
        device_pk: UUID,
        limit: int = 100,
    ) -> list[OneTimePreKey]:
        result = await self.execute(
            select(OneTimePreKey)
            .where(
                OneTimePreKey.device_id == device_pk,
                OneTimePreKey.consumed.is_(False),
            )
            .order_by(OneTimePreKey.key_id)
            .limit(limit)
        )
        return list(result.scalars().all())

    async def get_one_time_prekey(
        self,
        device_pk: UUID,
        key_id: int,
    ) -> OneTimePreKey | None:
        result = await self.execute(
            select(OneTimePreKey).where(
                OneTimePreKey.device_id == device_pk,
                OneTimePreKey.key_id == key_id,
            )
        )
        return result.scalar_one_or_none()

    async def mark_one_time_prekey_consumed(
        self,
        prekey_pk: UUID,
        consumed_by_device_pk: UUID | None = None,
    ):
        from datetime import datetime

        await self.db.execute(
            update(OneTimePreKey)
            .where(OneTimePreKey.id == prekey_pk)
            .values(
                consumed=True,
                consumed_at=datetime.now(UTC),
                consumed_by_device_id=consumed_by_device_pk,
            )
            .execution_options(synchronize_session=False)
        )

    async def reserve_one_time_prekeys(
        self,
        device_pk: UUID,
        limit: int = 1,
    ) -> list[OneTimePreKey]:
        """Atomically claim unconsumed one-time prekeys for serving.

        A conditional UPDATE (WHERE consumed = false) makes the
        claim race-free: concurrent bundle requests can never be
        handed the same prekey twice.

        SELECT ... FOR UPDATE SKIP LOCKED ensures that if two
        concurrent requests read the same unconsumed prekey, only
        one will succeed in consuming it; the other will skip it
        and receive rowcount=0.
        """
        from datetime import datetime

        result = await self.db.execute(
            select(OneTimePreKey)
            .where(
                OneTimePreKey.device_id == device_pk,
                OneTimePreKey.consumed.is_(False),
            )
            .order_by(OneTimePreKey.key_id)
            .limit(limit)
            .with_for_update(skip_locked=True)
        )
        rows = list(result.scalars().all())

        reserved = []
        for row in rows:
            claimed = await self.db.execute(
                update(OneTimePreKey)
                .where(
                    OneTimePreKey.id == row.id,
                    OneTimePreKey.consumed.is_(False),
                )
                .values(
                    consumed=True,
                    consumed_at=datetime.now(UTC),
                )
                .execution_options(synchronize_session=False)
            )
            if claimed.rowcount == 1:
                reserved.append(row)

        return reserved

    async def get_next_one_time_prekey_id(
        self,
        device_pk: UUID,
    ) -> int:
        result = await self.execute(
            select(OneTimePreKey.key_id)
            .where(
                OneTimePreKey.device_id == device_pk,
            )
            .order_by(OneTimePreKey.key_id.desc())
            .limit(1)
        )
        latest = result.scalar_one_or_none()
        return (latest or 0) + 1

    # ===========================================================
    # Signal Sessions
    # ===========================================================

    async def get_session(
        self,
        our_device_pk: UUID,
        remote_device_pk: UUID,
        conversation_pk: UUID,
    ) -> SignalSession | None:
        result = await self.execute(
            select(SignalSession).where(
                SignalSession.device_id == our_device_pk,
                SignalSession.remote_device_id == remote_device_pk,
                SignalSession.conversation_id == conversation_pk,
            )
        )
        return result.scalar_one_or_none()

    async def create_session(
        self,
        session: SignalSession,
    ) -> SignalSession:
        return await self.create(session)

    async def save_session(
        self,
        session: SignalSession,
    ) -> SignalSession:
        await self.update()
        await self.refresh(session)
        return session
