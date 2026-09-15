from datetime import UTC
from uuid import UUID

from app.models.device import DeviceTrust, DeviceTrustLevel
from app.repositories.base_repository import BaseRepository
from sqlalchemy import select


class DeviceTrustRepository(BaseRepository):
    """Repository for DeviceTrust (TOFU trust records)."""

    async def get_trust(
        self,
        owner_id: UUID,
        device_id: UUID,
    ) -> DeviceTrust | None:
        result = await self.execute(
            select(DeviceTrust).where(
                DeviceTrust.owner_id == owner_id,
                DeviceTrust.device_id == device_id,
            )
        )
        return result.scalar_one_or_none()

    async def get_or_create_trust(
        self,
        owner_id: UUID,
        device_id: UUID,
    ) -> DeviceTrust:
        trust = await self.get_trust(owner_id, device_id)
        if trust is not None:
            return trust
        trust = DeviceTrust(
            owner_id=owner_id,
            device_id=device_id,
            trust_level=DeviceTrustLevel.unknown.value,
        )
        await self.create(trust)
        return trust

    async def set_trust_level(
        self,
        owner_id: UUID,
        device_id: UUID,
        level: str,
        fingerprint: str | None = None,
    ) -> DeviceTrust:
        from datetime import datetime

        trust = await self.get_or_create_trust(owner_id, device_id)
        trust.trust_level = level
        if fingerprint is not None:
            trust.identity_key_fingerprint = fingerprint
        if level in (
            DeviceTrustLevel.trusted.value,
            DeviceTrustLevel.verified.value,
        ):
            trust.trusted_at = datetime.now(UTC)
        await self.update()
        await self.refresh(trust)
        return trust

    async def get_all_trusted_devices(
        self,
        owner_id: UUID,
    ) -> list[DeviceTrust]:
        result = await self.execute(
            select(DeviceTrust).where(
                DeviceTrust.owner_id == owner_id,
                DeviceTrust.trust_level.in_(
                    [
                        DeviceTrustLevel.trusted.value,
                        DeviceTrustLevel.verified.value,
                    ]
                ),
            )
        )
        return list(result.scalars().all())

    async def remove_trust(
        self,
        owner_id: UUID,
        device_id: UUID,
    ) -> bool:
        trust = await self.get_trust(owner_id, device_id)
        if trust is None:
            return False
        await self.db.delete(trust)
        return True
