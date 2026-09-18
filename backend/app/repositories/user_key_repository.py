from uuid import UUID

from app.models.user_key import UserKey
from app.repositories.base_repository import BaseRepository
from sqlalchemy import select


class UserKeyRepository(BaseRepository):
    """
    Repository responsible for UserKey operations.
    """

    # ==========================================================
    # Create
    # ==========================================================

    async def create_key(
        self,
        key: UserKey,
    ) -> UserKey:

        return await self.create(key)

    # ==========================================================
    # Get by User ID
    # ==========================================================

    async def get_by_user_id(
        self,
        user_id: UUID,
    ) -> UserKey | None:

        result = await self.execute(select(UserKey).where(UserKey.user_id == user_id))

        return result.scalar_one_or_none()

    # ==========================================================
    # Update
    # ==========================================================

    async def save(
        self,
        key: UserKey,
    ) -> UserKey:

        await self.update()

        await self.refresh(key)

        return key

    # ==========================================================
    # Delete
    # ==========================================================

    async def delete_key(
        self,
        key: UserKey,
    ):

        await self.delete(key)
