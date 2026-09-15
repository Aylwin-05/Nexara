from uuid import UUID

from app.core.enums import FriendRequestStatus
from app.models.friendship import Friendship
from app.models.user import User
from app.repositories.base_repository import BaseRepository
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import selectinload


class FriendRepository(BaseRepository):
    """
    Repository for all friendship operations.
    """

    # ==========================================================
    # Create Friend Request
    # ==========================================================

    async def create_request(
        self,
        friendship: Friendship,
    ) -> Friendship:
        return await self.create(friendship)

    # ==========================================================
    # Existing Friendship
    # ==========================================================

    async def get_existing_friendship(
        self,
        user1: UUID,
        user2: UUID,
    ) -> Friendship | None:

        result = await self.execute(
            select(Friendship).where(
                or_(
                    and_(
                        Friendship.sender_id == user1,
                        Friendship.receiver_id == user2,
                    ),
                    and_(
                        Friendship.sender_id == user2,
                        Friendship.receiver_id == user1,
                    ),
                )
            )
        )

        return result.scalar_one_or_none()

    # ==========================================================
    # Get by ID
    # ==========================================================

    async def get_by_id(
        self,
        friendship_id: UUID,
    ) -> Friendship | None:

        result = await self.execute(
            select(Friendship)
            .options(
                selectinload(Friendship.sender),
                selectinload(Friendship.receiver),
            )
            .where(Friendship.id == friendship_id)
        )

        return result.scalar_one_or_none()

    # ==========================================================
    # Pending Requests
    # ==========================================================

    async def get_pending_requests(
        self,
        receiver_id: UUID,
    ):

        result = await self.execute(
            select(Friendship)
            .options(
                selectinload(Friendship.sender),
                selectinload(Friendship.receiver),
            )
            .where(
                Friendship.receiver_id == receiver_id,
                Friendship.status == FriendRequestStatus.PENDING.value,
            )
            .order_by(Friendship.created_at.desc())
        )

        return result.scalars().all()

    # ==========================================================
    # Friends List
    # ==========================================================

    async def get_friends(
        self,
        user_id: UUID,
    ):

        result = await self.execute(
            select(Friendship)
            .options(
                selectinload(Friendship.sender),
                selectinload(Friendship.receiver),
            )
            .where(
                Friendship.status == FriendRequestStatus.ACCEPTED.value,
                or_(
                    Friendship.sender_id == user_id,
                    Friendship.receiver_id == user_id,
                ),
            )
        )

        return result.scalars().all()

    # ==========================================================
    # Search Users by Email
    # ==========================================================

    async def search_users(
        self,
        current_user_id: UUID,
        email: str,
    ):

        result = await self.execute(
            select(User)
            .where(
                User.id != current_user_id,
                User.email.ilike(f"%{email}%"),
            )
            .order_by(User.email)
            .limit(20)
        )

        return result.scalars().all()

    # ==========================================================
    # Update Friendship
    # ==========================================================

    async def save(self):
        await self.update()

    # ==========================================================
    # Delete Friendship
    # ==========================================================

    async def remove(
        self,
        friendship: Friendship,
    ):
        await self.delete(friendship)
