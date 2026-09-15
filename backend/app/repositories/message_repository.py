from datetime import UTC, datetime
from uuid import UUID

from app.models.attachment import Attachment
from app.models.message import Message
from app.models.message_reaction import MessageReaction
from app.models.message_recipient_key import MessageRecipientKey
from app.models.message_star import MessageStar
from app.models.signal_session import SignalSession
from app.repositories.base_repository import BaseRepository
from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.orm import selectinload


def _message_options():
    """Eager-loads that serialize_message expects."""
    return [
        selectinload(Message.attachments),
        selectinload(Message.reactions),
        selectinload(Message.recipient_keys),
    ]


class MessageRepository(BaseRepository):
    """
    Repository responsible for encrypted messages.

    IMPORTANT

    The repository NEVER knows plaintext.

    It only stores:

    • ciphertext
    • encrypted AES key
    • nonce
    • metadata
    """

    # ==========================================================
    # CREATE
    # ==========================================================

    async def create_message(
        self,
        message: Message,
    ) -> Message:

        return await self.create(message)

    async def find_by_client_message_id(
        self,
        conversation_id: UUID,
        sender_id: UUID,
        client_message_id: str,
    ) -> Message | None:

        result = await self.db.execute(
            select(Message).where(
                Message.conversation_id == conversation_id,
                Message.sender_id == sender_id,
                Message.client_message_id == client_message_id,
            )
        )

        return result.scalar_one_or_none()

    # ==========================================================
    # DISAPPEARING MESSAGES
    # ==========================================================

    async def purge_expired(
        self,
        now: datetime | None = None,
    ) -> list[tuple[UUID, UUID]]:
        """
        Hard-delete messages whose expiry time has passed.

        Returns a list of (conversation_id, message_id) pairs so
        callers can broadcast a real-time cleanup event. Child
        rows (reactions, attachments) are removed explicitly so
        the purge also works on dialects without FK cascades
        (e.g. SQLite in tests).
        """

        if now is None:
            now = datetime.now(UTC)

        result = await self.execute(
            select(
                Message.id,
                Message.conversation_id,
            ).where(
                Message.expires_at.is_not(None),
                Message.expires_at <= now,
            )
        )

        expired = result.all()

        if not expired:
            return []

        message_ids = [row.id for row in expired]

        await self.db.execute(
            delete(MessageReaction).where(MessageReaction.message_id.in_(message_ids))
        )

        await self.db.execute(delete(MessageStar).where(MessageStar.message_id.in_(message_ids)))

        await self.db.execute(delete(Attachment).where(Attachment.message_id.in_(message_ids)))

        await self.db.execute(delete(Message).where(Message.id.in_(message_ids)))

        await self.db.flush()

        return [(row.conversation_id, row.id) for row in expired]

    # ==========================================================
    # GET
    # ==========================================================

    async def get_by_id(
        self,
        message_id: UUID,
    ) -> Message | None:

        result = await self.execute(
            select(Message).options(*_message_options()).where(Message.id == message_id)
        )

        return result.scalar_one_or_none()

    # ==========================================================
    # GET CONVERSATION
    # ==========================================================

    async def get_conversation_messages(
        self,
        conversation_id: UUID,
        user_id: UUID | None = None,
        limit: int | None = None,
        before: UUID | None = None,
    ) -> list[Message]:
        """Messages in a conversation, oldest first.

        `limit`/`before` page newer→older: the `limit` newest
        messages that are strictly older than the cursor message.
        `limit=None`/`0` returns the whole conversation (used by
        the E2EE client-side search, which needs everything).
        """

        await self.purge_expired()

        stmt = (
            select(Message)
            .options(*_message_options())
            .where(Message.conversation_id == conversation_id)
        )

        if before is not None:
            cursor_created_at = (
                select(Message.created_at).where(Message.id == before).scalar_subquery()
            )

            # created_at DESC with the id as a tiebreaker, so a
            # page boundary is stable even for same-timestamp
            # bursts (e.g. bulk-imported history).
            stmt = stmt.where(
                or_(
                    Message.created_at < cursor_created_at,
                    and_(
                        Message.created_at == cursor_created_at,
                        Message.id < before,
                    ),
                )
            )

        if limit:
            result = await self.execute(
                stmt.order_by(
                    Message.created_at.desc(),
                    Message.id.desc(),
                ).limit(limit)
            )

            messages = list(result.scalars().all())

            messages.reverse()

        else:
            result = await self.execute(
                stmt.order_by(
                    Message.created_at.asc(),
                    Message.id.asc(),
                )
            )

            messages = list(result.scalars().all())

        # "Delete for me": hide messages the user removed
        if user_id is not None:
            messages = [
                message for message in messages if str(user_id) not in (message.deleted_for or [])
            ]

        return messages

    # ==========================================================
    # LAST MESSAGE
    # ==========================================================

    async def get_last_message(
        self,
        conversation_id: UUID,
        user_id: UUID | None = None,
    ) -> Message | None:

        await self.purge_expired()

        result = await self.execute(
            select(Message)
            .options(*_message_options())
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.created_at.desc())
            .limit(200)
        )

        messages = result.scalars().all()

        # "Delete for me": hide messages the user removed
        if user_id is not None:
            messages = [
                message for message in messages if str(user_id) not in (message.deleted_for or [])
            ]

        return messages[0] if messages else None

    # ==========================================================
    # DELIVERY
    # ==========================================================

    async def get_last_messages_for_user(
        self,
        conversation_ids: list[UUID],
        user_id: UUID,
    ) -> dict[UUID, Message | None]:
        """Newest message per conversation, one query.

        Same semantics as get_last_message: skips messages the
        user deleted-for-themselves. The skip is re-applied here
        instead of in SQL (the "deleted_for" list lives in a JSON
        column with no portable contains-operator), so only
        conversations whose NEWEST message is deleted-for-me take
        the per-conversation fallback query -- rare in practice.
        """

        if not conversation_ids:
            return {}

        await self.purge_expired()

        newest_row = (
            select(
                Message.id.label("message_id"),
                func.row_number()
                .over(
                    partition_by=Message.conversation_id,
                    order_by=Message.created_at.desc(),
                )
                .label("rank"),
            )
            .where(Message.conversation_id.in_(conversation_ids))
            .subquery()
        )

        result = await self.execute(
            select(Message)
            .options(*_message_options())
            .where(Message.id.in_(select(newest_row.c.message_id).where(newest_row.c.rank == 1)))
        )

        by_conversation = {message.conversation_id: message for message in result.scalars().all()}

        for conversation_id, message in list(by_conversation.items()):
            if message is not None and str(user_id) in (message.deleted_for or []):
                # ponytail: exact-match fallback, rare (only when
                # the newest message was deleted-for-me); batch it
                # if sidebars ever serve users who delete a lot.
                by_conversation[conversation_id] = await self.get_last_message(
                    conversation_id,
                    user_id,
                )

        return {
            conversation_id: by_conversation.get(conversation_id)
            for conversation_id in conversation_ids
        }

    # ==========================================================
    # DELIVERY
    # ==========================================================

    async def mark_delivered(
        self,
        message: Message,
    ):

        if message.delivered_at is None:
            message.delivered_at = datetime.now(UTC)

            await self.update()

    # ==========================================================
    # READ
    # ==========================================================

    async def mark_read(
        self,
        message: Message,
    ):

        message.is_read = True

        if message.delivered_at is None:
            message.delivered_at = datetime.now(UTC)

        if message.read_at is None:
            message.read_at = datetime.now(UTC)

        await self.update()

    async def mark_all_read(
        self,
        conversation_id: UUID,
        user_id: UUID,
    ):
        now = datetime.now(UTC)
        await self.db.execute(
            update(Message)
            .where(
                Message.conversation_id == conversation_id,
                Message.sender_id != user_id,
                Message.is_read.is_(False),
            )
            .values(
                is_read=True,
                delivered_at=func.coalesce(Message.delivered_at, now),
                read_at=func.coalesce(Message.read_at, now),
            )
        )
        await self.update()

    # ==========================================================
    # UNREAD COUNT
    # ==========================================================

    async def count_unread(
        self,
        conversation_id: UUID,
        user_id: UUID,
    ) -> int:
        """Count messages sent by others that the user hasn't read."""

        await self.purge_expired()

        result = await self.db.execute(
            select(func.count(Message.id)).where(
                Message.conversation_id == conversation_id,
                Message.sender_id != user_id,
                Message.is_read.is_(False),
            )
        )

        return int(result.scalar_one() or 0)

    # ==========================================================
    # DELIVERY
    # ==========================================================

    async def count_unread_by_conversation(
        self,
        conversation_ids: list[UUID],
        user_id: UUID,
    ) -> dict[UUID, int]:
        """Map conversation_id -> unread count (same filter as
        count_unread, batched with one GROUP BY query)."""

        if not conversation_ids:
            return {}

        await self.purge_expired()

        result = await self.execute(
            select(
                Message.conversation_id,
                func.count(Message.id),
            )
            .where(
                Message.conversation_id.in_(conversation_ids),
                Message.sender_id != user_id,
                Message.is_read.is_(False),
            )
            .group_by(Message.conversation_id)
        )

        return dict(result.all())

    # ==========================================================
    # DELETE
    # ==========================================================

    async def get_conversation_attachments(
        self,
        conversation_id: UUID,
    ) -> list[Attachment]:
        """
        Every attachment row whose message belongs to this
        conversation. Used before the full wipe so the physical
        files can be unlinked from disk.
        """
        result = await self.execute(
            select(Attachment)
            .join(
                Message,
                Attachment.message_id == Message.id,
            )
            .where(Message.conversation_id == conversation_id)
        )
        return list(result.scalars().all())

    async def delete_conversation_content(
        self,
        conversation_id: UUID,
    ) -> None:
        """
        Hard-delete every message of a conversation and all
        children (reactions, per-recipient wrapped keys,
        attachments, signal sessions).

        Child rows are removed explicitly so the wipe works on
        dialects without FK cascades (e.g. SQLite in tests).
        """

        message_ids = select(Message.id).where(Message.conversation_id == conversation_id)

        await self.db.execute(
            delete(MessageReaction).where(MessageReaction.message_id.in_(message_ids))
        )

        await self.db.execute(delete(MessageStar).where(MessageStar.message_id.in_(message_ids)))

        await self.db.execute(
            delete(MessageRecipientKey).where(MessageRecipientKey.message_id.in_(message_ids))
        )

        await self.db.execute(delete(Attachment).where(Attachment.message_id.in_(message_ids)))

        await self.db.execute(
            delete(SignalSession).where(SignalSession.conversation_id == conversation_id)
        )

        await self.db.execute(delete(Message).where(Message.conversation_id == conversation_id))

        await self.db.flush()

    # ==========================================================
    # DELETE (message-level)
    # ==========================================================

    async def delete_for_everyone(
        self,
        message: Message,
    ) -> Message:

        message.deleted_for_everyone = True

        await self.update()

        return message

    async def delete_for_me(
        self,
        message: Message,
        user_id: UUID,
    ) -> Message:

        user_id = str(user_id)

        if user_id not in message.deleted_for:
            message.deleted_for.append(user_id)

            await self.update()

        return message

    # ==========================================================
    # PER-RECIPIENT KEYS (group E2EE)
    # ==========================================================

    async def purge_removed_user_keys(
        self,
        conversation_id: UUID,
        user_id: UUID,
    ) -> int:
        """Remove per-recipient wrapped keys for a removed user.

        This ensures the removed user can no longer decrypt
        new group messages. Remaining members will have their
        keys re-wrapped during message re-encryption.
        """

        result = await self.db.execute(
            delete(MessageRecipientKey).where(
                MessageRecipientKey.message_id.in_(
                    select(Message.id).where(Message.conversation_id == conversation_id)
                ),
                MessageRecipientKey.user_id == user_id,
            )
        )
        await self.db.flush()
        return result.rowcount

    async def replace_recipient_keys(
        self,
        message_id: UUID,
        keys: list[tuple[UUID, str]],
    ) -> None:

        await self.db.execute(
            delete(MessageRecipientKey).where(MessageRecipientKey.message_id == message_id)
        )

        for user_id, encrypted_key in keys:
            row = MessageRecipientKey(
                message_id=message_id,
                user_id=user_id,
                encrypted_key=encrypted_key,
            )

            await self.create(row)

        await self.db.flush()

    # ==========================================================
    # REPLY
    # ==========================================================

    async def get_reply_message(
        self,
        reply_to_id: UUID,
    ) -> Message | None:

        await self.purge_expired()

        result = await self.execute(select(Message).where(Message.id == reply_to_id))

        return result.scalar_one_or_none()

    # ==========================================================
    # EDIT
    # ==========================================================

    async def reload_with_relations(
        self,
        message_id: UUID,
    ) -> Message | None:
        """
        Re-fetch a message with all relationships eagerly loaded,
        overwriting the identity-map version (populate_existing).

        Useful after a commit that expired attributes: a partial
        refresh leaves the remaining columns expired, and async
        sessions cannot lazy-load them.
        """

        result = await self.execute(
            select(Message)
            .options(*_message_options())
            .where(Message.id == message_id)
            .execution_options(populate_existing=True)
        )

        return result.scalar_one_or_none()

    async def edit_payload(
        self,
        message: Message,
        ciphertext: str,
        encrypted_key_sender: str,
        encrypted_key_receiver: str,
        nonce: str,
    ) -> Message:
        """
        Replace the encrypted payload of an edited message.

        The server only swaps ciphertext + wrapped keys; the
        edited plaintext never reaches the backend.
        """

        message.ciphertext = ciphertext
        message.encrypted_key_sender = encrypted_key_sender
        message.encrypted_key_receiver = encrypted_key_receiver
        message.nonce = nonce
        message.edited = True

        await self.update()

        return message

    # ==========================================================
    # REACTIONS
    # ==========================================================

    async def get_reaction(
        self,
        message_id: UUID,
        user_id: UUID,
    ) -> MessageReaction | None:

        result = await self.execute(
            select(MessageReaction).where(
                MessageReaction.message_id == message_id,
                MessageReaction.user_id == user_id,
            )
        )

        return result.scalar_one_or_none()

    async def add_reaction(
        self,
        message_id: UUID,
        user_id: UUID,
        emoji: str,
    ) -> MessageReaction:

        reaction = MessageReaction(
            message_id=message_id,
            user_id=user_id,
            emoji=emoji,
        )

        return await self.create(reaction)

    async def remove_reaction(
        self,
        reaction: MessageReaction,
    ):

        await self.delete(reaction)

    # ==========================================================
    # STARS (per-user, personal)
    # ==========================================================

    async def get_star(
        self,
        message_id: UUID,
        user_id: UUID,
    ) -> MessageStar | None:

        result = await self.execute(
            select(MessageStar).where(
                MessageStar.message_id == message_id,
                MessageStar.user_id == user_id,
            )
        )

        return result.scalar_one_or_none()

    async def add_star(
        self,
        message_id: UUID,
        user_id: UUID,
    ) -> MessageStar:

        star = MessageStar(
            message_id=message_id,
            user_id=user_id,
        )

        return await self.create(star)

    async def remove_star(
        self,
        star: MessageStar,
    ):

        await self.delete(star)

    async def get_starred_message_ids(
        self,
        conversation_id: UUID,
        user_id: UUID,
    ) -> set[UUID]:

        result = await self.execute(
            select(MessageStar.message_id)
            .join(
                Message,
                MessageStar.message_id == Message.id,
            )
            .where(
                Message.conversation_id == conversation_id,
                MessageStar.user_id == user_id,
            )
        )

        return {row[0] for row in result.all()}

    async def get_starred_messages(
        self,
        user_id: UUID,
        conversation_id: UUID | None = None,
    ) -> list[Message]:

        await self.purge_expired()

        query = (
            select(Message)
            .join(
                MessageStar,
                MessageStar.message_id == Message.id,
            )
            .options(*_message_options())
            .where(
                MessageStar.user_id == user_id,
            )
        )

        if conversation_id is not None:
            query = query.where(Message.conversation_id == conversation_id)

        result = await self.execute(query.order_by(MessageStar.created_at.desc()))

        return list(result.scalars().all())

    # ==========================================================
    # SAVE
    # ==========================================================

    async def save(
        self,
        message: Message,
    ) -> Message:

        await self.update()

        return message
