from uuid import UUID

from app.core.enums import FriendRequestStatus
from app.models.user import User
from app.models.user_privacy import PRIVACY_LEVELS
from app.repositories.block_repository import BlockRepository
from app.repositories.friend_repository import FriendRepository


class BlockService:
    """
    Business logic for blocking users and privacy settings.

    A block is directional and symmetric in effect: blocked users
    cannot message, call, see presence/stories/avatars of the
    blocker, and the blocker also stops seeing the same from them.
    """

    def __init__(
        self,
        block_repository: BlockRepository,
        friend_repository: FriendRepository | None = None,
    ):
        self.block_repository = block_repository
        self.friend_repository = friend_repository

    # ==========================================================
    # Block
    # ==========================================================

    async def block_user(
        self,
        current_user: User,
        target_id: UUID,
    ) -> dict:

        if current_user.id == target_id:
            raise ValueError("You cannot block yourself.")

        from app.models.user import User
        from sqlalchemy import select

        result = await self.block_repository.execute(select(User).where(User.id == target_id))

        target_user = result.scalar_one_or_none()

        if target_user is None:
            raise ValueError("User not found.")

        existing = await self.block_repository.block_exists(
            current_user.id,
            target_id,
        )

        if existing:
            raise ValueError("User is already blocked.")

        await self.block_repository.block_user(current_user.id, target_id)

        await self.block_repository.commit()

        # Unfriend automatically (WhatsApp removes the chat too).
        if self.friend_repository is not None:
            friendship = await self.friend_repository.get_existing_friendship(
                current_user.id,
                target_id,
            )

            if friendship is not None:
                await self.friend_repository.remove(friendship)
                await self.friend_repository.commit()

        return {
            "user_id": str(target_id),
            "status": "blocked",
        }

    # ==========================================================
    # Unblock
    # ==========================================================

    async def unblock_user(
        self,
        current_user: User,
        target_id: UUID,
    ) -> dict:

        deleted = await self.block_repository.unblock_user(
            current_user.id,
            target_id,
        )

        await self.block_repository.commit()

        if not deleted:
            raise ValueError("User is not blocked.")

        return {
            "user_id": str(target_id),
            "status": "unblocked",
        }

    # ==========================================================
    # List blocked users
    # ==========================================================

    async def list_blocked(
        self,
        current_user: User,
    ) -> list[dict]:

        users = await self.block_repository.get_blocked_users(current_user.id)

        return [
            {
                "id": str(user.id),
                "display_name": user.display_name,
                "username": user.username,
                "avatar_url": user.avatar_url,
            }
            for user in users
        ]

    # ==========================================================
    # Checks used by message/call/presence/story enforcement
    # ==========================================================

    async def is_blocked(
        self,
        user_id: UUID,
        other_user_id: UUID,
    ) -> bool:
        """True when user_id is blocked by other_user_id."""

        return await self.block_repository.is_blocked(
            user_id,
            other_user_id,
        )

    async def block_exists_between(
        self,
        user_id: UUID,
        other_user_id: UUID,
    ) -> bool:

        return await self.block_repository.block_exists(
            user_id,
            other_user_id,
        )

    # ==========================================================
    # Privacy settings
    # ==========================================================

    def _validate(self, value: str, field: str) -> str:

        value = (value or "").strip().lower()

        if value not in PRIVACY_LEVELS:
            raise ValueError(f"Invalid {field} setting. Use one of: {', '.join(PRIVACY_LEVELS)}.")

        return value

    async def get_privacy(
        self,
        current_user: User,
    ) -> dict:

        setting = await self.block_repository.get_privacy(current_user.id)

        return {
            "last_seen": setting.last_seen if setting else "everyone",
            "profile_photo": (setting.profile_photo if setting else "everyone"),
            "story": setting.story if setting else "my_contacts",
        }

    async def update_privacy(
        self,
        current_user: User,
        *,
        last_seen: str | None = None,
        profile_photo: str | None = None,
        story: str | None = None,
    ) -> dict:

        setting = await self.block_repository.get_or_create_privacy(current_user.id)

        if last_seen is not None:
            setting.last_seen = self._validate(
                last_seen,
                "last_seen",
            )

        if profile_photo is not None:
            setting.profile_photo = self._validate(
                profile_photo,
                "profile_photo",
            )

        if story is not None:
            setting.story = self._validate(
                story,
                "story",
            )

        await self.block_repository.commit()

        return {
            "last_seen": setting.last_seen,
            "profile_photo": setting.profile_photo,
            "story": setting.story,
        }

    # ==========================================================
    # Story visibility (privacy-aware)
    # ==========================================================

    async def can_view_story(
        self,
        viewer_id: UUID,
        owner_id: UUID,
    ) -> bool:
        """
        Privacy check for story visibility:
        - blocked users can never see stories (either direction)
        - "nobody" hides stories from everyone but the owner
        - "my_contacts" requires an accepted friendship
        - "everyone" is always allowed
        """

        if viewer_id == owner_id:
            return True

        if await self.block_exists_between(
            viewer_id,
            owner_id,
        ):
            return False

        setting = await self.block_repository.get_privacy(owner_id)

        level = setting.story if setting else "my_contacts"

        if level == "nobody":
            return False

        if level == "everyone":
            return True

        # my_contacts
        if self.friend_repository is None:
            return False

        friendship = await self.friend_repository.get_existing_friendship(
            viewer_id,
            owner_id,
        )

        return friendship is not None and friendship.status == FriendRequestStatus.ACCEPTED.value
