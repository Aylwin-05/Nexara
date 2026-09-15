from datetime import UTC, datetime
from uuid import UUID

from app.models.webauthn_credential import WebauthnCredential
from app.repositories.base_repository import BaseRepository
from sqlalchemy import select, update


class WebAuthnRepository(BaseRepository):
    async def create_credential(
        self,
        credential: WebauthnCredential,
    ) -> WebauthnCredential:
        return await self.create(credential)

    async def get_by_credential_id(
        self,
        credential_id: str,
    ) -> WebauthnCredential | None:
        result = await self.execute(
            select(WebauthnCredential).where(
                WebauthnCredential.credential_id == credential_id,
            )
        )
        return result.scalar_one_or_none()

    async def get_by_user(
        self,
        user_id: UUID,
    ) -> list[WebauthnCredential]:
        result = await self.execute(
            select(WebauthnCredential)
            .where(
                WebauthnCredential.user_id == user_id,
            )
            .order_by(WebauthnCredential.created_at.desc())
        )
        return list(result.scalars().all())

    async def delete_credential(
        self,
        credential: WebauthnCredential,
    ):
        await self.db.delete(credential)
        await self.db.flush()

    async def update_sign_count(
        self,
        credential: WebauthnCredential,
        new_count: int,
    ):
        await self.db.execute(
            update(WebauthnCredential)
            .where(WebauthnCredential.id == credential.id)
            .values(
                sign_count=new_count,
                last_used_at=datetime.now(UTC),
            )
            .execution_options(synchronize_session=False)
        )
        await self.db.flush()
