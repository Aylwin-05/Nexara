from uuid import UUID

from app.core.enums import FriendRequestStatus
from app.models.friendship import Friendship
from app.models.user import User
from app.repositories.friend_repository import FriendRepository


class FriendService:
    """
    Business logic for friendships.
    """

    def __init__(
        self,
        repository: FriendRepository,
    ):
        self.repository = repository

    # ==========================================================
    # Send Friend Request
    # ==========================================================

    async def send_request(
        self,
        sender: User,
        receiver_id: UUID,
    ) -> Friendship:

        if sender.id == receiver_id:
            raise ValueError("You cannot send a friend request to yourself.")

        from sqlalchemy import select

        receiver_exists = (
            await self.repository.db.execute(select(User.id).where(User.id == receiver_id))
        ).scalar_one_or_none()

        if receiver_exists is None:
            raise ValueError("User not found.")

        try:
            existing = await self.repository.get_existing_friendship(
                sender.id,
                receiver_id,
            )

            if existing:
                raise ValueError("Friend request already exists.")

            friendship = Friendship(
                sender_id=sender.id,
                receiver_id=receiver_id,
                status=FriendRequestStatus.PENDING.value,
            )

            friendship = await self.repository.create_request(friendship)

            await self.repository.commit()

            # Reload with sender/receiver relationships loaded
            friendship = await self.repository.get_by_id(friendship.id)

            return friendship

        except Exception:
            await self.repository.rollback()

            raise

    # ==========================================================
    # Accept Request
    # ==========================================================

    async def accept_request(
        self,
        friendship_id: UUID,
        current_user: User,
    ) -> Friendship:

        try:
            friendship = await self.repository.get_by_id(friendship_id)

            if friendship is None:
                raise ValueError("Friend request not found.")

            if friendship.receiver_id != current_user.id:
                raise ValueError("Not authorized.")

            friendship.status = FriendRequestStatus.ACCEPTED.value

            await self.repository.save()

            await self.repository.commit()

            return friendship

        except Exception:
            await self.repository.rollback()

            raise

    # ==========================================================
    # Reject Request
    # ==========================================================

    async def reject_request(
        self,
        friendship_id: UUID,
        current_user: User,
    ):

        try:
            friendship = await self.repository.get_by_id(friendship_id)

            if friendship is None:
                raise ValueError("Friend request not found.")

            if friendship.receiver_id != current_user.id:
                raise ValueError("Not authorized.")

            friendship.status = FriendRequestStatus.REJECTED.value

            await self.repository.save()

            await self.repository.commit()

        except Exception:
            await self.repository.rollback()

            raise

    # ==========================================================
    # Remove Friend
    # ==========================================================

    async def remove_friend(
        self,
        friendship_id: UUID,
        current_user: User,
    ):

        try:
            friendship = await self.repository.get_by_id(friendship_id)

            if friendship is None:
                raise ValueError("Friendship not found.")

            if (
                friendship.sender_id != current_user.id
                and friendship.receiver_id != current_user.id
            ):
                raise ValueError("Not authorized.")

            await self.repository.remove(friendship)

            await self.repository.commit()

        except Exception:
            await self.repository.rollback()

            raise

    # ==========================================================
    # Pending Requests
    # ==========================================================

    async def pending_requests(
        self,
        current_user: User,
    ):

        return await self.repository.get_pending_requests(current_user.id)

    # ==========================================================
    # Friends List
    # ==========================================================

    async def friends(
        self,
        current_user: User,
    ):

        return await self.repository.get_friends(current_user.id)

    # ==========================================================
    # Search Users
    # ==========================================================

    async def search_users(
        self,
        current_user: User,
        email: str,
    ):

        return await self.repository.search_users(
            current_user.id,
            email,
        )
