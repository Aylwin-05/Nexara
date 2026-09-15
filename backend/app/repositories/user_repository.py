from uuid import UUID

from app.models.user import User
from app.repositories.base_repository import BaseRepository
from sqlalchemy import select


class UserRepository(BaseRepository):
    """
    Repository for user-related database operations.
    """

    # ==========================================================
    # Get User by ID
    # ==========================================================

    async def get_by_id(
        self,
        user_id,
    ) -> User | None:

        result = await self.execute(select(User).where(User.id == user_id))

        return result.scalar_one_or_none()

    # ==========================================================
    # Get User by Email
    # ==========================================================

    async def get_by_email(
        self,
        email: str,
    ) -> User | None:

        result = await self.execute(select(User).where(User.email == email))

        return result.scalar_one_or_none()

    # ==========================================================
    # Get User by Username
    # ==========================================================

    async def get_by_username(
        self,
        username: str,
    ) -> User | None:

        result = await self.execute(select(User).where(User.username == username))

        return result.scalar_one_or_none()

    # ==========================================================
    # Search Users
    # ==========================================================

    async def search_users(
        self,
        query: str,
        limit: int = 20,
        exclude_user_id: UUID | None = None,
    ) -> list[User]:

        stmt = select(User).where(User.email.ilike(f"%{query}%"))
        if exclude_user_id is not None:
            stmt = stmt.where(User.id != exclude_user_id)

        result = await self.execute(stmt.order_by(User.email).limit(limit))

        return result.scalars().all()

    # ==========================================================
    # Update User
    # ==========================================================

    async def update_user(
        self,
        user: User,
    ) -> User:
        """
        Commit changes made to an existing user and refresh it.
        """

        await self.update()
        await self.refresh(user)

        return user

    # ==========================================================
    # Delete User
    # ==========================================================

    async def delete_user(
        self,
        user: User,
    ) -> None:

        await self.delete(user)
