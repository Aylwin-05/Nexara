from datetime import datetime
from uuid import UUID

from app.core.utc import UTC
from app.models.conversation import Conversation
from app.models.conversation_participant import (
    ConversationParticipant,
)
from app.models.group_invite_link import GroupInviteLink
from app.models.user import User
from app.repositories.base_repository import BaseRepository
from sqlalchemy import and_, delete, func, select


class ConversationRepository(BaseRepository):
    """
    Repository for conversation operations.
    """

    # ==========================================================
    # Create Conversation
    # ==========================================================

    async def create_conversation(
        self,
        conversation: Conversation,
    ) -> Conversation:

        return await self.create(conversation)

    # ==========================================================
    # Add Participant
    # ==========================================================

    async def add_participant(
        self,
        participant: ConversationParticipant,
    ) -> ConversationParticipant:

        return await self.create(participant)

    # ==========================================================
    # Existing Private Conversation
    # ==========================================================

    async def get_by_conversation_key(
        self,
        conversation_key: str,
    ) -> Conversation | None:

        result = await self.execute(
            select(Conversation).where(Conversation.conversation_key == conversation_key)
        )

        return result.scalar_one_or_none()

    async def get_private_conversation(
        self,
        user1: UUID,
        user2: UUID,
    ) -> Conversation | None:

        participant_count = (
            select(ConversationParticipant.conversation_id)
            .group_by(ConversationParticipant.conversation_id)
            .having(func.count() == 2)
            .subquery()
        )

        result = await self.execute(
            select(Conversation)
            .join(
                ConversationParticipant,
                Conversation.id == ConversationParticipant.conversation_id,
            )
            .where(
                Conversation.id.in_(select(participant_count.c.conversation_id)),
                ConversationParticipant.user_id.in_([user1, user2]),
            )
            .group_by(Conversation.id)
            .having(func.count() == 2)
        )

        return result.scalar_one_or_none()

    # ==========================================================
    # User Conversations
    # ==========================================================

    async def get_user_conversations(
        self,
        user_id: UUID,
    ):

        result = await self.execute(
            select(Conversation)
            .join(
                ConversationParticipant,
                Conversation.id == ConversationParticipant.conversation_id,
            )
            .where(ConversationParticipant.user_id == user_id)
            .order_by(Conversation.updated_at.desc())
        )

        return result.scalars().all()

    # ==========================================================
    # Get Conversation Participants
    # ==========================================================

    async def get_participants(
        self,
        conversation_id: UUID,
    ):

        result = await self.execute(
            select(ConversationParticipant).where(
                ConversationParticipant.conversation_id == conversation_id
            )
        )

        return result.scalars().all()

    # ==========================================================
    # Get Conversation Participant
    # ==========================================================

    async def get_participant(
        self,
        conversation_id: UUID,
        user_id: UUID,
    ) -> ConversationParticipant | None:

        result = await self.execute(
            select(ConversationParticipant).where(
                and_(
                    ConversationParticipant.conversation_id == conversation_id,
                    ConversationParticipant.user_id == user_id,
                )
            )
        )

        return result.scalar_one_or_none()

    # ==========================================================
    # Get User's Participants in Many Conversations (batch)
    # ==========================================================

    async def get_participants_for_user(
        self,
        conversation_ids: list[UUID],
        user_id: UUID,
    ) -> dict[UUID, ConversationParticipant]:
        """Map conversation_id -> the user's own participant row."""

        if not conversation_ids:
            return {}

        result = await self.execute(
            select(ConversationParticipant).where(
                ConversationParticipant.user_id == user_id,
                ConversationParticipant.conversation_id.in_(conversation_ids),
            )
        )

        return {participant.conversation_id: participant for participant in result.scalars().all()}

    # ==========================================================
    # Get Other User
    # ==========================================================

    async def get_other_user(
        self,
        conversation_id: UUID,
        current_user_id: UUID,
    ) -> User | None:

        result = await self.execute(
            select(User)
            .join(
                ConversationParticipant,
                User.id == ConversationParticipant.user_id,
            )
            .where(
                ConversationParticipant.conversation_id == conversation_id,
                User.id != current_user_id,
            )
        )

        return result.scalar_one_or_none()

    # ==========================================================
    # Get Other Users in Many Conversations (batch)
    # ==========================================================

    async def get_other_users(
        self,
        conversation_ids: list[UUID],
        current_user_id: UUID,
    ) -> dict[UUID, User]:
        """Map conversation_id -> the peer (facts up to the same
        semantics as get_other_user: it is only consulted for
        two-person conversations, which have exactly one peer)."""

        if not conversation_ids:
            return {}

        result = await self.execute(
            select(
                ConversationParticipant.conversation_id,
                User,
            )
            .join(
                ConversationParticipant,
                User.id == ConversationParticipant.user_id,
            )
            .where(
                ConversationParticipant.conversation_id.in_(conversation_ids),
                User.id != current_user_id,
            )
        )

        return dict(result.all())

    # ==========================================================
    # Verify Participant
    # ==========================================================

    async def is_participant(
        self,
        conversation_id: UUID,
        user_id: UUID,
    ) -> bool:

        result = await self.execute(
            select(ConversationParticipant).where(
                and_(
                    ConversationParticipant.conversation_id == conversation_id,
                    ConversationParticipant.user_id == user_id,
                )
            )
        )

        return result.scalar_one_or_none() is not None

    # ==========================================================
    # Get Conversation
    # ==========================================================

    async def get_by_id(
        self,
        conversation_id: UUID,
    ):

        result = await self.execute(select(Conversation).where(Conversation.id == conversation_id))

        return result.scalar_one_or_none()

    # ==========================================================
    # Get Participants with User Profiles + Public Keys
    #
    # Group chat needs every member's profile and RSA public
    # key so the client can wrap the fresh AES message key for
    # each recipient. Returns raw rows: (participant, user,
    # public_key or None).
    # ==========================================================

    async def get_participants_with_users(
        self,
        conversation_id: UUID,
    ):

        from app.models.user_key import UserKey

        result = await self.execute(
            select(
                ConversationParticipant,
                User,
                UserKey.public_key,
            )
            .join(
                User,
                User.id == ConversationParticipant.user_id,
            )
            .outerjoin(
                UserKey,
                UserKey.user_id == User.id,
            )
            .where(ConversationParticipant.conversation_id == conversation_id)
        )

        return result.all()

    # ==========================================================
    # Get Participant Count
    # ==========================================================

    async def get_participant_count(
        self,
        conversation_id: UUID,
    ) -> int:

        result = await self.execute(
            select(func.count())
            .select_from(ConversationParticipant)
            .where(ConversationParticipant.conversation_id == conversation_id)
        )

        return result.scalar_one()

    # ==========================================================
    # Get Participant Counts in Many Conversations (batch)
    # ==========================================================

    async def get_participant_counts(
        self,
        conversation_ids: list[UUID],
    ) -> dict[UUID, int]:
        """Map conversation_id -> member count."""

        if not conversation_ids:
            return {}

        result = await self.execute(
            select(
                ConversationParticipant.conversation_id,
                func.count(),
            )
            .where(ConversationParticipant.conversation_id.in_(conversation_ids))
            .group_by(ConversationParticipant.conversation_id)
        )

        return dict(result.all())

    # ==========================================================
    # Remove Participant (leave group)
    # ==========================================================

    async def remove_participant(
        self,
        conversation_id: UUID,
        user_id: UUID,
    ) -> None:

        await self.db.execute(
            delete(ConversationParticipant).where(
                and_(
                    ConversationParticipant.conversation_id == conversation_id,
                    ConversationParticipant.user_id == user_id,
                )
            )
        )

        await self.db.flush()

    # ==========================================================
    # Group Invite Links
    # ==========================================================

    async def add_invite_link(
        self,
        link: GroupInviteLink,
    ) -> GroupInviteLink:

        return await self.create(link)

    async def get_active_invite_link(
        self,
        conversation_id: UUID,
    ) -> GroupInviteLink | None:
        """Most recent non-revoked, non-expired link, if any."""

        result = await self.execute(
            select(GroupInviteLink)
            .where(
                GroupInviteLink.conversation_id == conversation_id,
                GroupInviteLink.revoked.is_(False),
            )
            .order_by(GroupInviteLink.created_at.desc())
            .limit(1)
        )

        link = result.scalar_one_or_none()

        if link is None:
            return None

        # DB drivers may return naive datetimes (e.g. SQLite);
        # normalize to naive timezone.utc so the comparison is valid.
        expires_at = link.expires_at

        if expires_at is not None:
            if expires_at.tzinfo is not None:
                expires_at = expires_at.astimezone(UTC).replace(tzinfo=None)

            now = datetime.now(UTC).replace(tzinfo=None)

            if expires_at <= now:
                return None

        return link

    async def get_invite_link_by_token(
        self,
        token: str,
    ) -> GroupInviteLink | None:

        result = await self.execute(
            select(GroupInviteLink).where(
                GroupInviteLink.token == token,
                GroupInviteLink.revoked.is_(False),
            )
        )

        return result.scalar_one_or_none()

    async def revoke_invite_links(
        self,
        conversation_id: UUID,
    ) -> None:

        await self.db.execute(
            delete(GroupInviteLink).where(GroupInviteLink.conversation_id == conversation_id)
        )

        await self.db.flush()

    # ==========================================================
    # Save
    # ==========================================================

    async def save(self):

        await self.update()

    # ==========================================================
    # Delete Conversation (two-party consent wipe)
    # ==========================================================

    async def delete_conversation_record(
        self,
        conversation_id: UUID,
    ) -> None:
        """
        Remove the participants and the conversation row itself.

        Messages + attachments are wiped separately via
        MessageRepository.delete_conversation_content.
        """

        await self.db.execute(
            delete(ConversationParticipant).where(
                ConversationParticipant.conversation_id == conversation_id
            )
        )

        await self.db.execute(delete(Conversation).where(Conversation.id == conversation_id))

        await self.db.flush()
