from datetime import UTC, datetime
from uuid import UUID

from app.models.story import Story, StoryView
from app.models.user import User
from app.repositories.base_repository import BaseRepository
from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError


class StoryRepository(BaseRepository):
    """
    Repository for stories (24h status updates) and their views.
    """

    # ==========================================================
    # Create
    # ==========================================================

    async def create_story(self, story: Story) -> Story:
        return await self.create(story)

    # ==========================================================
    # Views
    # ==========================================================

    async def add_view(
        self,
        story_id: UUID,
        user_id: UUID,
    ) -> bool:
        """
        Record a view; returns False when the viewer already
        saw this story (idempotent). Uses database-level unique
        constraint to prevent race conditions.
        """

        existing = await self.get_view(story_id, user_id)
        if existing is not None:
            return False

        try:
            await self.create(
                StoryView(
                    story_id=story_id,
                    user_id=user_id,
                )
            )
            return True
        except IntegrityError:
            # Lost a race against a concurrent view insert.
            # Roll back so the session stays usable, then report
            # the idempotent "already viewed" outcome.
            await self.rollback()
            return False

    async def get_view(
        self,
        story_id: UUID,
        user_id: UUID,
    ) -> StoryView | None:

        result = await self.execute(
            select(StoryView).where(
                and_(
                    StoryView.story_id == story_id,
                    StoryView.user_id == user_id,
                )
            )
        )

        return result.scalar_one_or_none()

    async def get_viewers(
        self,
        story_id: UUID,
    ):
        """
        Viewer profiles ordered newest first (WhatsApp order).
        """

        result = await self.execute(
            select(StoryView, User)
            .join(
                User,
                User.id == StoryView.user_id,
            )
            .where(StoryView.story_id == story_id)
            .order_by(StoryView.viewed_at.desc())
        )

        return result.all()

    async def view_count(
        self,
        story_id: UUID,
    ) -> int:

        result = await self.execute(
            select(func.count()).select_from(StoryView).where(StoryView.story_id == story_id)
        )

        return result.scalar_one()

    # ==========================================================
    # Queries
    # ==========================================================

    async def get_by_id(self, story_id: UUID) -> Story | None:

        result = await self.execute(select(Story).where(Story.id == story_id))

        return result.scalar_one_or_none()

    async def purge_expired(
        self,
        now: datetime | None = None,
    ) -> list[Story]:

        if now is None:
            now = datetime.now(UTC)

        result = await self.execute(select(Story).where(Story.expires_at <= now))

        expired = result.scalars().all()

        for story in expired:
            await self.delete(story)

        await self.flush()

        return expired

    async def get_active_stories_of(
        self,
        user_ids: list[UUID],
        now: datetime | None = None,
    ) -> list[Story]:

        if now is None:
            now = datetime.now(UTC)

        if not user_ids:
            return []

        result = await self.execute(
            select(Story)
            .where(
                Story.user_id.in_(user_ids),
                Story.expires_at > now,
            )
            .order_by(Story.created_at.asc())
        )

        return result.scalars().all()

    # ==========================================================
    # Delete
    # ==========================================================

    async def delete_story(self, story: Story) -> None:

        await self.delete(story)

    async def flush(self):
        await self.db.flush()
