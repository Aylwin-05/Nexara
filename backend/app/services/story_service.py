from datetime import datetime, timedelta
from pathlib import Path
from uuid import UUID

from app.core.enums import FriendRequestStatus
from app.core.file_config import (
    MAX_STORY_SIZE,
    STORIES_DIR,
    STORY_EXTENSIONS,
    STORY_MEDIA_TYPES,
)
from app.core.file_stream import stream_to_disk
from app.core.utc import UTC
from app.models.story import Story
from app.models.user import User
from app.repositories.friend_repository import FriendRepository
from app.repositories.story_repository import StoryRepository
from app.websocket.connection_manager import manager
from fastapi import HTTPException, UploadFile

STORY_TTL_SECONDS = 24 * 60 * 60


def _is_expired(story: Story) -> bool:
    """Expiry check safe across tz-aware/naive datetimes."""

    if story.expires_at is None:
        return False

    expires = story.expires_at

    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=UTC)

    return expires <= datetime.now(UTC)


class StoryService:
    """
    Business logic for 24h status updates.

    Media is end-to-end encrypted by the client; the server
    stores ciphertext + wrapped keys only. Stories are visible
    to the owner and their accepted friends until they expire.
    """

    def __init__(
        self,
        story_repository: StoryRepository,
        friend_repository: FriendRepository | None = None,
        block_service=None,
    ):
        self.story_repository = story_repository
        self.friend_repository = friend_repository
        self.block_service = block_service

    # ==========================================================
    # Serialization
    # ==========================================================

    def _serialize(
        self,
        story: Story,
        *,
        viewed: bool = False,
        view_count: int = 0,
        viewers: list | None = None,
        owner: User | None = None,
        reactions: dict | None = None,
    ) -> dict:

        if reactions is None:
            reactions = {
                "count": 0,
                "reactions": [],
                "summary": [],
            }

        return {
            "id": str(story.id),
            "user_id": str(story.user_id),
            "owner": (
                {
                    "id": str(owner.id),
                    "display_name": owner.display_name,
                    "username": owner.username,
                    "avatar_url": owner.avatar_url,
                }
                if owner
                else None
            ),
            "caption": story.caption,
            "filename": story.filename,
            "mime_type": story.mime_type,
            "media_type": story.media_type,
            "encrypted": story.encrypted,
            "encrypted_key_sender": (story.encrypted_key_sender),
            "encrypted_key_receiver": (story.encrypted_key_receiver),
            "nonce": story.nonce,
            "wrapped_keys": story.wrapped_keys or [],
            "created_at": (story.created_at.isoformat() if story.created_at else None),
            "expires_at": (story.expires_at.isoformat() if story.expires_at else None),
            "media_url": f"/api/v1/stories/{story.id}/media",
            "viewed": viewed,
            "view_count": view_count,
            "viewers": viewers or [],
            "reactions": reactions,
        }

    # ==========================================================
    # Create
    # ==========================================================

    async def create_story(
        self,
        current_user: User,
        file: UploadFile,
        *,
        caption: str | None = None,
        encrypted: bool = True,
        encrypted_key_sender: str | None = None,
        encrypted_key_receiver: str | None = None,
        nonce: str | None = None,
        wrapped_keys: list | None = None,
    ) -> dict:

        filename = file.filename or ""

        extension = Path(filename).suffix.lower()

        if extension not in STORY_EXTENSIONS:
            raise ValueError("Unsupported file type for a status update.")

        media_type = STORY_MEDIA_TYPES.get(extension, "image")

        if encrypted and (not encrypted_key_sender or not nonce):
            raise ValueError("Encrypted stories require the wrapped key and nonce.")

        import uuid

        storage = STORIES_DIR / f"{uuid.uuid4().hex}{extension}"

        try:
            await stream_to_disk(
                file,
                storage,
                MAX_STORY_SIZE,
                extension=extension,
                sniff=not encrypted,
            )

        except HTTPException as e:
            raise ValueError(e.detail) from e

        story = Story(
            user_id=current_user.id,
            caption=(caption or "").strip()[:500] or None,
            storage_path=str(storage),
            filename=filename,
            mime_type=(file.content_type or "application/octet-stream"),
            media_type=media_type,
            encrypted=bool(encrypted),
            encrypted_key_sender=encrypted_key_sender,
            encrypted_key_receiver=encrypted_key_receiver,
            nonce=nonce,
            wrapped_keys=wrapped_keys or [],
            expires_at=datetime.now(UTC) + timedelta(seconds=STORY_TTL_SECONDS),
        )

        story = await self.story_repository.create_story(story)

        await self.story_repository.commit()

        payload = {
            "event": "story.new",
            "story": self._serialize(
                story,
                owner=current_user,
            ),
        }

        friend_ids = await self._friend_ids(current_user.id)

        if self.block_service is not None:
            friend_ids = [
                friend_id
                for friend_id in friend_ids
                if not await self.block_service.block_exists_between(
                    current_user.id,
                    friend_id,
                )
            ]

        for friend_id in friend_ids:
            await manager.send_to_user(friend_id, payload)

        # Web Push for friends whose browser is closed or in
        # the background (their service worker suppresses the
        # notification when the app is open and focused).
        from app.services.push_service import push_service

        await push_service.notify_story(
            friend_ids=friend_ids,
            owner_name=current_user.display_name,
            story_id=story.id,
        )

        return self._serialize(
            story,
            owner=current_user,
        )

    # ==========================================================
    # Feed (my stories + my friends' active stories)
    # ==========================================================

    async def feed(self, current_user: User) -> dict:

        await self.story_repository.purge_expired()

        my_stories = await self.story_repository.get_active_stories_of([current_user.id])

        friend_ids = await self._friend_ids(current_user.id)

        if self.block_service is not None:
            visible = []

            for friend_id in friend_ids:
                if await self.block_service.can_view_story(
                    viewer_id=current_user.id,
                    owner_id=friend_id,
                ):
                    visible.append(friend_id)

            friend_ids = visible

        friend_stories = await self.story_repository.get_active_stories_of(friend_ids)

        my_viewed = {str(story.id) for story in my_stories}

        # Which of my friends' stories did I already view?
        viewed_foreign = set()

        if friend_stories:
            from app.models.story import StoryView
            from sqlalchemy import select

            result = await self.story_repository.execute(
                select(StoryView.story_id).where(
                    StoryView.user_id == current_user.id,
                    StoryView.story_id.in_([story.id for story in friend_stories]),
                )
            )

            viewed_foreign = {str(row[0]) for row in result.all()}

        grouped: dict[str, dict] = {}

        for story in [*my_stories, *friend_stories]:
            owner_id = str(story.user_id)

            if owner_id not in grouped:
                grouped[owner_id] = {
                    "user_id": owner_id,
                    "stories": [],
                }

            grouped[owner_id]["stories"].append(story)

        owners = await self._owners([UUID(owner_id) for owner_id in grouped])

        owner_map = {str(user.id): user for user in owners}

        # My own stories: viewer list (WhatsApp's "seen by").
        view_map = {}

        for story in my_stories:
            viewers = await self.story_repository.get_viewers(story.id)

            view_map[str(story.id)] = {
                "count": len(viewers),
                "viewers": viewers,
            }

        # My own stories: friend reactions (grouped counts +
        # per-reactor details for the viewers panel).
        reaction_map: dict[str, dict] = {}

        if my_stories:
            from app.models.story_reaction import StoryReaction
            from sqlalchemy import select

            result = await self.story_repository.execute(
                select(StoryReaction, User)
                .join(User, User.id == StoryReaction.user_id)
                .where(StoryReaction.story_id.in_([s.id for s in my_stories]))
            )

            by_story: dict[str, list] = {}

            for reaction, reactor in result.all():
                by_story.setdefault(str(reaction.story_id), []).append(
                    {
                        "user_id": str(reactor.id),
                        "display_name": reactor.display_name,
                        "username": reactor.username,
                        "avatar_url": reactor.avatar_url,
                        "emoji": reaction.emoji,
                        "reacted_at": (
                            reaction.created_at.isoformat() if reaction.created_at else None
                        ),
                    }
                )

            for story_key, items in by_story.items():
                totals: dict[str, int] = {}

                for item in items:
                    totals[item["emoji"]] = totals.get(item["emoji"], 0) + 1

                reaction_map[story_key] = {
                    "count": len(items),
                    "reactions": items,
                    "summary": [
                        {"emoji": emoji, "count": count} for emoji, count in totals.items()
                    ],
                }

        result = []

        for owner_id, entry in grouped.items():
            stories = []

            for story in entry["stories"]:
                story_key = str(story.id)

                is_mine = story_key in my_viewed

                if is_mine and story_key in view_map:
                    info = view_map[story_key]

                    viewers = [
                        {
                            "user_id": str(view.user_id),
                            "display_name": viewer.display_name,
                            "username": viewer.username,
                            "avatar_url": viewer.avatar_url,
                            "viewed_at": (view.viewed_at.isoformat() if view.viewed_at else None),
                        }
                        for view, viewer in info["viewers"]
                    ]

                    story_data = self._serialize(
                        story,
                        viewed=True,
                        view_count=info["count"],
                        viewers=viewers,
                        owner=owner_map.get(owner_id),
                        reactions=reaction_map.get(story_key),
                    )

                else:
                    story_data = self._serialize(
                        story,
                        viewed=story_key in viewed_foreign,
                        owner=owner_map.get(owner_id),
                    )

                stories.append(story_data)

            result.append(
                {
                    "user_id": owner_id,
                    "owner": (
                        self._serialize_owner(owner_map.get(owner_id))
                        if owner_map.get(owner_id)
                        else None
                    ),
                    "stories": stories,
                }
            )

        # My own status first, then friends (WhatsApp order)
        result.sort(key=lambda item: item["user_id"] != str(current_user.id))

        return result

    # ==========================================================
    # View
    # ==========================================================

    async def mark_viewed(
        self,
        current_user: User,
        story_id: UUID,
    ) -> dict:

        story = await self.story_repository.get_by_id(story_id)

        if story is None:
            raise ValueError("Story not found.")

        if _is_expired(story):
            raise ValueError("Story has expired.")

        if story.user_id != current_user.id:
            await self._verify_friend(
                current_user.id,
                story.user_id,
            )

            if self.block_service is not None:
                if not await self.block_service.can_view_story(
                    viewer_id=current_user.id,
                    owner_id=story.user_id,
                ):
                    raise PermissionError("You cannot view this story.")

        if story.user_id == current_user.id:
            return {
                "story_id": str(story.id),
                "viewed": True,
            }

        added = await self.story_repository.add_view(
            story.id,
            current_user.id,
        )

        await self.story_repository.commit()

        if added and story.user_id != current_user.id:
            await manager.send_to_user(
                story.user_id,
                {
                    "event": "story.viewed",
                    "story_id": str(story.id),
                    "user_id": str(current_user.id),
                    "user_name": current_user.display_name,
                },
            )

        return {
            "story_id": str(story.id),
            "viewed": True,
        }

    # ==========================================================
    # Reaction / reply visibility guard
    #
    # Reacting to or replying to a story carries the same access
    # rules as viewing it: the story must exist and be live, and
    # (unless you own it) you must be a non-blocked friend per the
    # owner's story-privacy setting.
    # ==========================================================

    async def ensure_visible(
        self,
        current_user: User,
        story_id: UUID,
    ) -> Story:

        story = await self.story_repository.get_by_id(story_id)

        if story is None:
            raise ValueError("Story not found.")

        if _is_expired(story):
            raise ValueError("Story has expired.")

        if story.user_id != current_user.id:
            await self._verify_friend(
                current_user.id,
                story.user_id,
            )

            if self.block_service is not None:
                if not await self.block_service.can_view_story(
                    viewer_id=current_user.id,
                    owner_id=story.user_id,
                ):
                    raise PermissionError("You cannot interact with this story.")

        return story

    # ==========================================================
    # Media access
    # ==========================================================

    async def get_media_path(
        self,
        current_user: User,
        story_id: UUID,
    ) -> tuple[Path, str]:

        story = await self.story_repository.get_by_id(story_id)

        if story is None:
            raise PermissionError("Story not found.")

        if _is_expired(story):
            raise PermissionError("Story has expired.")

        if story.user_id != current_user.id:
            await self._verify_friend(
                current_user.id,
                story.user_id,
            )

            if self.block_service is not None:
                if not await self.block_service.can_view_story(
                    viewer_id=current_user.id,
                    owner_id=story.user_id,
                ):
                    raise PermissionError("You cannot view this story.")

        path = Path(story.storage_path)

        if not path.exists():
            raise PermissionError("Story media not found.")

        return path, story.mime_type

    # ==========================================================
    # Delete (owner only)
    # ==========================================================

    async def delete_story(
        self,
        current_user: User,
        story_id: UUID,
    ) -> dict:

        story = await self.story_repository.get_by_id(story_id)

        if story is None:
            raise ValueError("Story not found.")

        if story.user_id != current_user.id:
            raise PermissionError("You can delete only your own stories.")

        await self.story_repository.delete_story(story)

        await self.story_repository.commit()

        try:
            path = Path(story.storage_path)

            if path.exists():
                path.unlink()

        except OSError:
            pass

        payload = {
            "event": "story.deleted",
            "story_id": str(story.id),
            "user_id": str(current_user.id),
        }

        for friend_id in await self._friend_ids(current_user.id):
            if self.block_service is not None:
                if await self.block_service.block_exists_between(
                    current_user.id,
                    friend_id,
                ):
                    continue

            await manager.send_to_user(friend_id, payload)

        return {
            "story_id": str(story.id),
            "status": "deleted",
        }

    # ==========================================================
    # Helpers
    # ==========================================================

    def _serialize_owner(self, user: User) -> dict:

        return {
            "id": str(user.id),
            "display_name": user.display_name,
            "username": user.username,
            "avatar_url": user.avatar_url,
        }

    async def _friend_ids(self, user_id: UUID) -> list[UUID]:

        if self.friend_repository is None:
            return []

        friendships = await self.friend_repository.get_friends(user_id)

        return [
            (friendship.receiver_id if friendship.sender_id == user_id else friendship.sender_id)
            for friendship in friendships
        ]

    async def _verify_friend(self, viewer_id: UUID, owner_id: UUID):

        if self.friend_repository is None:
            return

        friendship = await self.friend_repository.get_existing_friendship(
            viewer_id,
            owner_id,
        )

        is_friend = (
            friendship is not None and friendship.status == FriendRequestStatus.ACCEPTED.value
        )

        if not is_friend:
            raise PermissionError("You can only view stories of your friends.")

    async def _owners(self, user_ids: list[UUID]) -> list[User]:

        if not user_ids:
            return []

        from app.models.user import User
        from sqlalchemy import select

        result = await self.story_repository.execute(select(User).where(User.id.in_(user_ids)))

        return result.scalars().all()
