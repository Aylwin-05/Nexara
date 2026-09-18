from uuid import UUID

from app.models.block import Block
from app.models.user import User
from app.models.user_privacy import UserPrivacySetting
from app.repositories.base_repository import BaseRepository
from sqlalchemy import and_, delete, or_, select


class BlockRepository(BaseRepository):
    """
    Repository for user blocks and privacy settings.
    """

    # ==========================================================
    # Blocks
    # ==========================================================

    async def block_user(
        self,
        blocker_id: UUID,
        blocked_id: UUID,
    ) -> Block:

        return await self.create(
            Block(
                blocker_id=blocker_id,
                blocked_id=blocked_id,
            )
        )

    async def unblock_user(
        self,
        blocker_id: UUID,
        blocked_id: UUID,
    ) -> bool:

        result = await self.execute(
            delete(Block).where(
                Block.blocker_id == blocker_id,
                Block.blocked_id == blocked_id,
            )
        )

        return result.rowcount > 0

    async def is_blocked(
        self,
        user_id: UUID,
        other_user_id: UUID,
    ) -> bool:
        """True when user_id is blocked by other_user_id."""

        result = await self.execute(
            select(Block.id).where(
                Block.blocker_id == other_user_id,
                Block.blocked_id == user_id,
            )
        )

        return result.scalar_one_or_none() is not None

    async def block_exists(
        self,
        user_id: UUID,
        other_user_id: UUID,
    ) -> bool:
        """True when either direction is blocked."""

        result = await self.execute(
            select(Block.id).where(
                or_(
                    and_(
                        Block.blocker_id == user_id,
                        Block.blocked_id == other_user_id,
                    ),
                    and_(
                        Block.blocker_id == other_user_id,
                        Block.blocked_id == user_id,
                    ),
                )
            )
        )

        return result.scalar_one_or_none() is not None

    async def get_blocked_ids(
        self,
        blocker_id: UUID,
    ) -> list[UUID]:

        result = await self.execute(select(Block.blocked_id).where(Block.blocker_id == blocker_id))

        return list(result.scalars().all())

    async def get_blocked_by_ids(
        self,
        user_id: UUID,
    ) -> list[UUID]:

        result = await self.execute(select(Block.blocker_id).where(Block.blocked_id == user_id))

        return list(result.scalars().all())

    async def get_blocked_users(
        self,
        blocker_id: UUID,
    ) -> list[User]:

        result = await self.execute(
            select(User)
            .join(
                Block,
                Block.blocked_id == User.id,
            )
            .where(Block.blocker_id == blocker_id)
            .order_by(User.display_name)
        )

        return result.scalars().all()

    # ==========================================================
    # Privacy settings
    # ==========================================================

    async def get_privacy(
        self,
        user_id: UUID,
    ) -> UserPrivacySetting | None:

        result = await self.execute(
            select(UserPrivacySetting).where(UserPrivacySetting.user_id == user_id)
        )

        return result.scalar_one_or_none()

    async def get_or_create_privacy(
        self,
        user_id: UUID,
    ) -> UserPrivacySetting:

        setting = await self.get_privacy(user_id)

        if setting is not None:
            return setting

        setting = UserPrivacySetting(user_id=user_id)

        await self.create(setting)

        return setting

    async def flush(self):
        await self.db.flush()
