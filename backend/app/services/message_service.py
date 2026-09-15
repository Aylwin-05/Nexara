from datetime import UTC, datetime, timedelta
from uuid import UUID

from app.models.message import Message
from app.models.user import User
from app.repositories.conversation_repository import (
    ConversationRepository,
)
from app.repositories.device_repository import (
    DeviceRepository,
)
from app.repositories.message_repository import (
    MessageRepository,
)
from app.services.attachment_service import (
    AttachmentService,
)
from sqlalchemy.exc import IntegrityError


class MessageService:
    """
    End-to-End Encrypted Message Service.

    The backend NEVER encrypts or decrypts messages.

    Responsibilities:

    • Validate conversation membership
    • Decode Base64 payloads
    • Store encrypted payloads
    • Manage metadata
    """

    def __init__(
        self,
        message_repository: MessageRepository,
        conversation_repository: ConversationRepository,
        attachment_service: AttachmentService,
        device_repository: DeviceRepository,
    ):
        self.message_repository = message_repository
        self.conversation_repository = conversation_repository
        self.attachment_service = attachment_service
        self.device_repository = device_repository

    # ==========================================================
    # INTERNAL
    # ==========================================================

    async def _validate_participant(
        self,
        current_user: User,
        conversation_id: UUID,
    ):

        participants = await self.conversation_repository.get_participants(conversation_id)

        participant_ids = {participant.user_id for participant in participants}

        if current_user.id not in participant_ids:
            raise ValueError("You are not a participant of this conversation.")

    # ==========================================================
    # GROUP KEY ROTATION
    #
    # Every group message uses a FRESH AES key wrapped for the
    # CURRENT members. If the sender's membership view is stale
    # (e.g. an admin removed a member elsewhere), a removed
    # member's devices must NOT receive the key for any message
    # sent after their removal. The server is authoritative:
    # each wrapped copy must target a current member.
    # ==========================================================

    async def _validate_group_recipients(
        self,
        conversation_id: UUID,
        recipient_keys: list[tuple[UUID, str]] | None,
        envelopes: list[dict] | None,
    ) -> None:

        if not recipient_keys and not envelopes:
            return

        conversation = await self.conversation_repository.get_by_id(conversation_id)

        if conversation is None or conversation.conversation_type != "group":
            return

        member_ids = {
            participant.user_id
            for participant in await self.conversation_repository.get_participants(conversation_id)
        }

        if recipient_keys:
            for user_id, _ in recipient_keys:
                if user_id not in member_ids:
                    raise ValueError("Group membership changed: refresh the group and re-send.")

        if envelopes:
            owners = await self.device_repository.get_owners_by_device_ids(
                [entry["device_id"] for entry in envelopes]
            )

            for entry in envelopes:
                owner = owners.get(entry["device_id"])

                if owner is None or owner not in member_ids:
                    raise ValueError("Group membership changed: refresh the group and re-send.")

    # ==========================================================
    # SEND ENCRYPTED MESSAGE
    # ==========================================================

    async def send_message(
        self,
        current_user: User,
        conversation_id: UUID,
        ciphertext: str,
        encrypted_key_sender: str,
        encrypted_key_receiver: str,
        nonce: str,
        message_type: str = "text",
        reply_to_id: UUID | None = None,
        is_forwarded: bool = False,
        forwarded_count: int = 0,
        attachment_ids: list[UUID] | None = None,
        recipient_keys: list[tuple[UUID, str]] | None = None,
        envelopes: list[dict] | None = None,
        client_message_id: str | None = None,
    ) -> Message:

        # Idempotent replay: a client retry of a send that already
        # committed returns the ORIGINAL message instead of a
        # duplicate. Any later body is ignored.
        if client_message_id:
            existing = await self.message_repository.find_by_client_message_id(
                conversation_id,
                current_user.id,
                client_message_id,
            )

            if existing is not None:
                return existing

        await self._validate_participant(
            current_user,
            conversation_id,
        )

        await self._validate_group_recipients(
            conversation_id,
            recipient_keys,
            envelopes,
        )

        if reply_to_id:
            reply = await self.message_repository.get_reply_message(reply_to_id)

            if reply is None:
                raise ValueError("Reply target does not exist.")

        expires_at = None

        conversation = await self.conversation_repository.get_by_id(conversation_id)

        if conversation and conversation.disappear_after_seconds:
            expires_at = datetime.now(UTC) + timedelta(seconds=conversation.disappear_after_seconds)

        message = Message(
            conversation_id=conversation_id,
            sender_id=current_user.id,
            ciphertext=ciphertext,
            encrypted_key_sender=encrypted_key_sender,
            encrypted_key_receiver=encrypted_key_receiver,
            nonce=nonce,
            crypto_version=1,
            message_type=message_type,
            reply_to_id=reply_to_id,
            is_forwarded=is_forwarded,
            forwarded_count=forwarded_count,
            expires_at=expires_at,
            client_message_id=client_message_id,
            envelopes=envelopes,
        )

        try:
            message = await self.message_repository.create_message(message)

        except IntegrityError:
            # Two racing retries of the same send: the dedupe
            # index won the race. Replay the winner.
            await self.message_repository.db.rollback()

            existing = await self.message_repository.find_by_client_message_id(
                conversation_id,
                current_user.id,
                client_message_id,
            )

            if existing is None:
                raise

            message = existing

        # Group E2EE: the fresh AES key was wrapped for EVERY
        # member at send time; store each wrapped copy.
        if recipient_keys:
            await self.message_repository.replace_recipient_keys(
                message.id,
                recipient_keys,
            )

        # Attach uploaded files to this message
        if attachment_ids:
            for attachment_id in attachment_ids:
                attachment = await self.attachment_service.get_attachment(attachment_id)

                if attachment:
                    attachment.message_id = message.id

        return message

    # ==========================================================
    # UPSERT SYNC ENVELOPE (cross-browser history)
    # ==========================================================

    async def upsert_sync_envelope(
        self,
        current_user: User,
        message_id: UUID,
        sync_envelope: dict,
    ) -> Message:
        """
        Store (or replace) the account-key copy of a message's
        plaintext. Only conversation participants may write; the
        blob is opaque to the server.
        """

        message = await self.get_message(
            current_user,
            message_id,
        )

        message.sync_envelope = sync_envelope

        return message

    # ==========================================================
    # GET MESSAGES
    # ==========================================================

    async def get_messages(
        self,
        current_user: User,
        conversation_id: UUID,
        limit: int | None = None,
        before: UUID | None = None,
    ):

        await self._validate_participant(
            current_user,
            conversation_id,
        )

        messages = await self.message_repository.get_conversation_messages(
            conversation_id,
            current_user.id,
            limit=limit,
            before=before,
        )

        # Personal star flags for this user
        starred_ids = await self.message_repository.get_starred_message_ids(
            conversation_id,
            current_user.id,
        )

        for message in messages:
            message.is_starred = message.id in starred_ids

        return messages

    # ==========================================================
    # GET SINGLE MESSAGE
    # ==========================================================

    async def get_message(
        self,
        current_user: User,
        message_id: UUID,
    ):

        message = await self.message_repository.get_by_id(message_id)

        if message is None:
            raise ValueError("Message not found.")

        await self._validate_participant(
            current_user,
            message.conversation_id,
        )

        message.is_starred = (
            await self.message_repository.get_star(
                message_id,
                current_user.id,
            )
            is not None
        )

        return message

    # ==========================================================
    # MARK READ
    # ==========================================================

    async def mark_read(
        self,
        current_user: User,
        message_id: UUID,
    ):

        message = await self.get_message(
            current_user,
            message_id,
        )

        return await self.message_repository.mark_read(message)

    # ==========================================================
    # EDIT MESSAGE
    # ==========================================================

    async def edit_message(
        self,
        current_user: User,
        message_id: UUID,
        ciphertext: str,
        encrypted_key_sender: str,
        encrypted_key_receiver: str,
        nonce: str,
        recipient_keys: list[tuple[UUID, str]] | None = None,
        envelopes: list[dict] | None = None,
        sync_envelope: dict | None = None,
    ) -> Message:

        message = await self.get_message(
            current_user,
            message_id,
        )

        if message.sender_id != current_user.id:
            raise ValueError("Only sender can edit message.")

        if message.deleted_for_everyone:
            raise ValueError("Message has already been deleted.")

        await self._validate_group_recipients(
            message.conversation_id,
            recipient_keys,
            envelopes,
        )

        edited = await self.message_repository.edit_payload(
            message,
            ciphertext,
            encrypted_key_sender,
            encrypted_key_receiver,
            nonce,
        )

        # Group edits re-wrap the key for every current member.
        if recipient_keys:
            await self.message_repository.replace_recipient_keys(
                message.id,
                recipient_keys,
            )

        # Multi-device edits re-wrap for every device.
        if envelopes is not None:
            edited.envelopes = envelopes or None

        # Edited content is a fresh plaintext: the account-key
        # copy must follow, or other browsers keep the stale text.
        if sync_envelope is not None:
            edited.sync_envelope = sync_envelope

        return edited

    # ==========================================================
    # REACTIONS
    # ==========================================================

    async def toggle_reaction(
        self,
        current_user: User,
        message_id: UUID,
        emoji: str,
    ) -> dict:
        """
        WhatsApp-style toggle:
        - same emoji again  -> reaction removed
        - different emoji   -> reaction replaced
        - new emoji         -> reaction added
        """

        message = await self.get_message(
            current_user,
            message_id,
        )

        existing = await self.message_repository.get_reaction(
            message_id,
            current_user.id,
        )

        action = "add"
        created_at = None

        if existing is not None and existing.emoji == emoji:
            await self.message_repository.remove_reaction(existing)

            action = "remove"

        else:
            if existing is not None:
                await self.message_repository.remove_reaction(existing)

            reaction = await self.message_repository.add_reaction(
                message_id,
                current_user.id,
                emoji,
            )

            created_at = reaction.created_at

        return {
            "message_id": str(message.id),
            "user_id": str(current_user.id),
            "emoji": emoji,
            "action": action,
            "created_at": (created_at.isoformat() if created_at is not None else None),
        }

    # ==========================================================
    # STARS (per-user, personal)
    # ==========================================================

    async def set_star(
        self,
        current_user: User,
        message_id: UUID,
        starred: bool,
    ) -> dict:

        message = await self.get_message(
            current_user,
            message_id,
        )

        if message.deleted_for_everyone:
            raise ValueError("Message has been deleted.")

        star = await self.message_repository.get_star(
            message_id,
            current_user.id,
        )

        if starred and star is None:
            await self.message_repository.add_star(
                message_id,
                current_user.id,
            )

        elif not starred and star is not None:
            await self.message_repository.remove_star(star)

        return {
            "message_id": str(message.id),
            "starred": starred,
        }

    async def get_starred_messages(
        self,
        current_user: User,
        conversation_id: UUID | None = None,
    ):

        if conversation_id is not None:
            await self._validate_participant(
                current_user,
                conversation_id,
            )

        messages = await self.message_repository.get_starred_messages(
            current_user.id,
            conversation_id,
        )

        for message in messages:
            message.is_starred = True

        return messages

    # ==========================================================
    # VIEW ONCE MEDIA
    #
    # WhatsApp-style: the recipient can open the media exactly
    # one time. Reporting "opened" makes the server delete the
    # file + attachment rows and flag the message, so nothing
    # survives on the backend afterwards.
    # ==========================================================

    async def mark_view_once_opened(
        self,
        current_user: User,
        message_id: UUID,
    ) -> dict:

        message = await self.get_message(
            current_user,
            message_id,
        )

        if message.sender_id == current_user.id:
            raise ValueError("Only the recipient can open view-once media.")

        already_opened = message.view_once_opened

        if not already_opened:
            view_once_attachments = [
                attachment for attachment in (message.attachments or []) if attachment.view_once
            ]

            if not view_once_attachments:
                raise ValueError("This message has no view-once media.")

            for attachment in view_once_attachments:
                await self.attachment_service.delete_attachment(attachment.id)

            message.view_once_opened = True

        return {
            "message_id": str(message.id),
            "conversation_id": str(message.conversation_id),
            "view_once_opened": True,
            "already_opened": already_opened,
        }

    # ==========================================================
    # DELETE
    # ==========================================================

    async def delete_for_everyone(
        self,
        current_user: User,
        message_id: UUID,
    ):

        message = await self.get_message(
            current_user,
            message_id,
        )

        if message.sender_id != current_user.id:
            # WhatsApp-style group moderation: a group admin may
            # delete any member's message.
            conversation = await self.conversation_repository.get_by_id(message.conversation_id)

            participant = await self.conversation_repository.get_participant(
                message.conversation_id,
                current_user.id,
            )

            is_group_admin = (
                conversation is not None
                and conversation.conversation_type == "group"
                and participant is not None
                and bool(participant.is_admin)
            )

            if not is_group_admin:
                raise ValueError("Only the sender or a group admin can delete this message.")

        # A deleted message must not leave an account-readable
        # sync copy behind.
        message.sync_envelope = None

        # Attachment rows die with the message in this same
        # transaction; the physical files are unlinked by the caller
        # only after the commit.
        attachment_paths = await self.attachment_service.delete_attachments_for_message(message.id)

        deleted = await self.message_repository.delete_for_everyone(message)

        return deleted, attachment_paths

    # ==========================================================
    # DELETE FOR ME
    # ==========================================================

    async def delete_for_me(
        self,
        current_user: User,
        message_id: UUID,
    ):

        message = await self.get_message(
            current_user,
            message_id,
        )

        return await self.message_repository.delete_for_me(
            message,
            current_user.id,
        )
