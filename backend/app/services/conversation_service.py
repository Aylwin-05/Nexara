import secrets
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from app.core.enums import FriendRequestStatus
from app.models.conversation import Conversation
from app.models.conversation_participant import (
    ConversationParticipant,
)
from app.models.group_invite_link import GroupInviteLink
from app.models.message import Message
from app.models.user import User
from app.repositories.conversation_repository import (
    ConversationRepository,
)
from app.repositories.friend_repository import (
    FriendRepository,
)
from app.repositories.message_repository import (
    MessageRepository,
)
from app.websocket.connection_manager import manager

# Sentinel distinguishing "field not sent" from "field sent as null".
_UNSET: object = object()


MAX_GROUP_MEMBERS = 50


class ConversationService:
    """
    Business logic for conversations.
    """

    def __init__(
        self,
        conversation_repository: ConversationRepository,
        message_repository: MessageRepository,
        friend_repository: FriendRepository | None = None,
    ):
        self.conversation_repository = conversation_repository
        self.message_repository = message_repository
        self.friend_repository = friend_repository

    # ==========================================================
    # Get or Create Private Conversation
    # ==========================================================

    async def get_or_create_private_conversation(
        self,
        current_user: User,
        other_user_id: UUID,
    ) -> Conversation:

        # Deterministic key unique per unordered user pair, so the
        # DB unique index is the ultimate source of truth.
        a, b = sorted((current_user.id, other_user_id))
        conversation_key = f"{a}:{b}"

        conversation = (
            await self.conversation_repository.get_by_conversation_key(
                conversation_key
            )
        )

        if conversation:
            return conversation

        try:

            conversation = Conversation(
                conversation_key=conversation_key,
                created_by=current_user.id,
            )

            conversation = (
                await self.conversation_repository.create_conversation(
                    conversation
                )
            )

            participant1 = ConversationParticipant(
                conversation_id=conversation.id,
                user_id=current_user.id,
            )

            participant2 = ConversationParticipant(
                conversation_id=conversation.id,
                user_id=other_user_id,
            )

            await self.conversation_repository.add_participant(
                participant1
            )

            await self.conversation_repository.add_participant(
                participant2
            )

            # --------------------------------------
            # SAVE EVERYTHING
            # --------------------------------------

            await self.conversation_repository.commit()

            return conversation

        except Exception:

            await self.conversation_repository.rollback()

            # Two users racing to create the same private chat: one
            # insert wins, the other hits the unique conversation_key
            # constraint. Return the winner's conversation instead of
            # failing or leaving an orphan.
            winner = (
                await self.conversation_repository
                .get_by_conversation_key(conversation_key)
            )

            if winner is not None:
                return winner

            raise

    # ==========================================================
    # Create Group
    # ==========================================================

    async def create_group(
        self,
        current_user: User,
        name: str,
        member_ids: list[UUID],
    ) -> Conversation:

        cleaned_name = (name or "").strip()

        if not cleaned_name:
            raise ValueError("Group name is required.")

        if len(cleaned_name) > 100:
            raise ValueError(
                "Group name must be at most 100 characters."
            )

        # Dedupe preserving order and drop the creator — they are
        # added separately as the group's first admin.
        seen: set[UUID] = set()
        unique_members: list[UUID] = []

        for member_id in member_ids:
            if (
                member_id == current_user.id
                or member_id in seen
            ):
                continue
            seen.add(member_id)
            unique_members.append(member_id)

        if len(unique_members) + 1 > MAX_GROUP_MEMBERS:
            raise ValueError(
                f"A group can have at most "
                f"{MAX_GROUP_MEMBERS} members."
            )

        # A group of only the creator makes no sense.
        if not unique_members:
            raise ValueError(
                "Add at least one other member to the group."
            )

        # Members must be accepted friends of the creator.
        if self.friend_repository is not None:
            for member_id in unique_members:
                friendship = (
                    await self.friend_repository.get_existing_friendship(
                        current_user.id,
                        member_id,
                    )
                )
                if (
                    friendship is None
                    or friendship.status
                    != FriendRequestStatus.ACCEPTED.value
                ):
                    raise ValueError(
                        "All members must be your friends."
                    )

        conversation = Conversation(
            name=cleaned_name,
            conversation_type="group",
            created_by=current_user.id,
        )

        conversation = (
            await self.conversation_repository.create_conversation(
                conversation
            )
        )

        creator_participant = ConversationParticipant(
            conversation_id=conversation.id,
            user_id=current_user.id,
            is_admin=True,
        )
        await self.conversation_repository.add_participant(
            creator_participant
        )

        for member_id in unique_members:
            participant = ConversationParticipant(
                conversation_id=conversation.id,
                user_id=member_id,
            )
            await self.conversation_repository.add_participant(
                participant
            )

        # Plaintext membership notice visible to every member.
        await self.message_repository.create_message(
            self._system_message(
                current_user,
                conversation.id,
                f"{current_user.display_name} created "
                f"the group",
            )
        )

        return conversation

    # ==========================================================
    # My Conversations
    # ==========================================================

    async def my_conversations(
        self,
        current_user: User,
    ):

        conversations = (
            await self.conversation_repository.get_user_conversations(
                current_user.id
            )
        )

        conversation_ids = [
            conversation.id
            for conversation in conversations
        ]

        # Batched lookups: a fixed handful of queries instead of
        # 3-5 per conversation (N+1 on the hot sidebar path).
        participants_by_conversation = (
            await self.conversation_repository.get_participants_for_user(
                conversation_ids,
                current_user.id,
            )
        )
        last_messages_by_conversation = (
            await self.message_repository.get_last_messages_for_user(
                conversation_ids,
                current_user.id,
            )
        )
        unread_by_conversation = (
            await self.message_repository.count_unread_by_conversation(
                conversation_ids,
                current_user.id,
            )
        )
        participant_counts_by_conversation = (
            await self.conversation_repository.get_participant_counts(
                [
                    conversation.id
                    for conversation in conversations
                    if conversation.conversation_type == "group"
                ]
            )
        )
        other_users_by_conversation = (
            await self.conversation_repository.get_other_users(
                conversation_ids,
                current_user.id,
            )
        )

        response = []

        for conversation in conversations:

            participant = participants_by_conversation.get(
                conversation.id
            )

            last_message = last_messages_by_conversation.get(
                conversation.id
            )

            unread_count = unread_by_conversation.get(
                conversation.id,
                0,
            )

            muted = False

            if participant is not None and participant.muted_until:

                muted_until = participant.muted_until

                if muted_until.tzinfo is None:
                    muted_until = muted_until.replace(
                        tzinfo=timezone.utc
                    )

                muted = muted_until > datetime.now(timezone.utc)

            payload = {
                "id": conversation.id,
                "updated_at": conversation.updated_at,
                "conversation_type": conversation.conversation_type,
                "name": conversation.name,
                "avatar_url": conversation.avatar_url,
                "description": conversation.description,
                "participant_count": None,
                "other_user": None,
                "last_message": (
                    {
                        "ciphertext": last_message.ciphertext,
                        "created_at": last_message.created_at,
                        "message_type": last_message.message_type,
                    }
                    if last_message
                    else None
                ),
                "unread_count": unread_count or 0,
                "is_pinned": (
                    participant.is_pinned
                    if participant is not None
                    else False
                ),
                "is_archived": (
                    participant.is_archived
                    if participant is not None
                    else False
                ),
                "muted": muted,
                "disappear_after_seconds": (
                    conversation.disappear_after_seconds
                ),
                "delete_requested_by": conversation.delete_requested_by,
                "delete_requested_at": conversation.delete_requested_at,
            }

            if conversation.conversation_type == "group":
                payload["participant_count"] = (
                    participant_counts_by_conversation.get(
                        conversation.id
                    )
                )

            else:
                other_user = other_users_by_conversation.get(
                    conversation.id
                )

                if other_user is not None:

                    other_user.online_status = (
                        "online"
                        if await manager.is_online(other_user.id)
                        else "offline"
                    )

                    payload["other_user"] = other_user

            response.append(payload)

        # Pinned conversations first, then most recently active.
        response.sort(
            key=lambda item: (
                bool(item["is_pinned"]),
                item["updated_at"]
                if item["updated_at"].tzinfo
                else item["updated_at"].replace(
                    tzinfo=timezone.utc
                ),
            ),
            reverse=True,
        )

        return response

    # ==========================================================
    # Participants
    # ==========================================================

    async def participants(
        self,
        conversation_id: UUID,
    ):
        return await self.conversation_repository.get_participants(
            conversation_id
        )

    # ==========================================================
    # Internal Helpers (groups / deletion / settings)
    # ==========================================================

    async def _group_conversation(
        self,
        conversation_id: UUID,
    ) -> Conversation:

        conversation = (
            await self.conversation_repository.get_by_id(
                conversation_id
            )
        )

        if conversation is None:
            raise ValueError("Conversation not found.")

        if conversation.conversation_type != "group":
            raise ValueError(
                "This action applies only to group "
                "conversations."
            )

        return conversation

    async def _require_participant(
        self,
        conversation_id: UUID,
        user_id: UUID,
    ) -> ConversationParticipant:

        participant = (
            await self.conversation_repository.get_participant(
                conversation_id,
                user_id,
            )
        )

        if participant is None:
            raise PermissionError(
                "You are not a member of this group."
            )

        return participant

    def _system_message(
        self,
        actor: User,
        conversation_id: UUID,
        text: str,
    ) -> Message:
        """Plaintext membership notices (message_type="system")."""

        return Message(
            conversation_id=conversation_id,
            sender_id=actor.id,
            ciphertext=text,
            encrypted_key_sender="system",
            encrypted_key_receiver="system",
            nonce="system",
            crypto_version=1,
            message_type="system",
        )

    @staticmethod
    def _link_payload(link: GroupInviteLink) -> dict:
        return {
            "token": link.token,
            "conversation_id": str(link.conversation_id),
            "revoked": link.revoked,
            "expires_at": (
                link.expires_at.isoformat()
                if link.expires_at
                else None
            ),
        }

    async def _purge_conversation(
        self,
        conversation_id: UUID,
    ) -> None:
        """Full wipe used by two-party consent deletion."""

        attachments = (
            await self.message_repository
            .get_conversation_attachments(conversation_id)
        )

        for attachment in attachments:

            if attachment.storage_path:

                path = Path(attachment.storage_path)

                path.unlink(missing_ok=True)

        await self.message_repository.delete_conversation_content(
            conversation_id
        )

        await self.conversation_repository.delete_conversation_record(
            conversation_id
        )

    # ==========================================================
    # Group Detail
    # ==========================================================

    async def get_group_detail(
        self,
        current_user: User,
        conversation_id: UUID,
    ) -> dict:

        conversation = await self._group_conversation(
            conversation_id
        )

        me = await self._require_participant(
            conversation_id,
            current_user.id,
        )

        rows = (
            await self.conversation_repository
            .get_participants_with_users(conversation_id)
        )

        participants = []

        for participant, user, public_key in rows:

            participants.append({
                "user_id": str(user.id),
                "display_name": user.display_name,
                "username": user.username,
                "public_key": public_key,
                "is_admin": participant.is_admin,
                "online_status": (
                    "online"
                    if await manager.is_online(user.id)
                    else "offline"
                ),
            })

        return {
            "id": str(conversation.id),
            "name": conversation.name,
            "description": conversation.description,
            "avatar_url": conversation.avatar_url,
            "created_by": (
                str(conversation.created_by)
                if conversation.created_by
                else None
            ),
            "is_admin": me.is_admin,
            "participant_count": len(participants),
            "participants": participants,
        }

    # ==========================================================
    # Group Avatar helpers (upload / fetch routes)
    # ==========================================================

    async def get_group_for_avatar(
        self,
        current_user: User,
        conversation_id: UUID,
        admin_only: bool = True,
    ) -> Conversation:

        conversation = await self._group_conversation(
            conversation_id
        )

        participant = await self._require_participant(
            conversation_id,
            current_user.id,
        )

        if admin_only and not participant.is_admin:
            raise PermissionError(
                "Only group admins can change the group avatar."
            )

        return conversation

    async def broadcast_group_avatar_changed(
        self,
        conversation: Conversation,
        actor: User,
    ) -> None:

        # Membership-visible system notice about the new photo.
        await self.message_repository.create_message(
            self._system_message(
                actor,
                conversation.id,
                f"{actor.display_name} changed "
                f"the group photo",
            )
        )

        await self.conversation_repository.commit()

        await manager.broadcast(
            conversation.id,
            {
                "event": "group_avatar_changed",
                "conversation_id": str(conversation.id),
                "avatar_url": conversation.avatar_url,
                "changed_by": str(actor.id),
            },
        )

    # ==========================================================
    # Add Group Members (admin only)
    # ==========================================================

    async def add_group_members(
        self,
        current_user: User,
        conversation_id: UUID,
        member_ids: list[UUID],
    ) -> dict:

        conversation = await self._group_conversation(
            conversation_id
        )

        await self._require_participant(
            conversation_id,
            current_user.id,
        )

        if not await self._is_admin(conversation, current_user.id):
            raise PermissionError(
                "Only group admins can add members."
            )

        if self.friend_repository is not None:

            for member_id in member_ids:

                if member_id == current_user.id:
                    continue

                friendship = (
                    await self.friend_repository.get_existing_friendship(
                        current_user.id,
                        member_id,
                    )
                )

                if (
                    friendship is None
                    or friendship.status
                    != FriendRequestStatus.ACCEPTED.value
                ):
                    raise ValueError(
                        "All members must be your friends."
                    )

        existing = {
            row.user_id
            for row in await self.conversation_repository.get_participants(
                conversation_id
            )
        }

        added_ids: list[UUID] = []

        seen: set[UUID] = set()

        for member_id in member_ids:

            if (
                member_id == current_user.id
                or member_id in existing
                or member_id in seen
            ):
                continue

            seen.add(member_id)
            added_ids.append(member_id)

        count = len(existing)

        if count + len(added_ids) > MAX_GROUP_MEMBERS:
            raise ValueError(
                f"A group can have at most "
                f"{MAX_GROUP_MEMBERS} members."
            )

        added_users: list[User] = []

        for member_id in added_ids:

            user = await self._get_user(member_id)

            if user is None:
                raise ValueError("Unknown member.")

            await self.conversation_repository.add_participant(
                ConversationParticipant(
                    conversation_id=conversation_id,
                    user_id=member_id,
                )
            )

            added_users.append(user)

        if added_users:

            names = ", ".join(
                user.display_name or user.email
                for user in added_users
            )

            message = self._system_message(
                current_user,
                conversation_id,
                f"{current_user.display_name} added {names}",
            )

            await self.message_repository.create_message(message)

        count += len(added_ids)

        await self.conversation_repository.commit()

        if added_users:
            # Cached peer sets are stale now - refresh them
            # everywhere so presence fan-out reaches the new
            # member without waiting for reconnects.
            members = (
                await self.conversation_repository.get_participants(
                    conversation_id
                )
            )

            await manager.invalidate_members(
                [row.user_id for row in members]
            )

        return {
            "status": "added",
            "participant_count": count,
        }

    async def _is_admin(
        self,
        conversation: Conversation,
        user_id: UUID,
    ) -> bool:

        participant = (
            await self.conversation_repository.get_participant(
                conversation.id,
                user_id,
            )
        )

        return bool(
            participant is not None and participant.is_admin
        )

    async def _get_user(self, user_id: UUID) -> User | None:

        from app.repositories.user_repository import (
            UserRepository,
        )

        repository = UserRepository(
            self.conversation_repository.db
        )

        return await repository.get_by_id(user_id)

    # ==========================================================
    # Leave Group
    # ==========================================================

    async def leave_group(
        self,
        current_user: User,
        conversation_id: UUID,
    ) -> dict:

        await self._group_conversation(
            conversation_id
        )

        leaver = await self._require_participant(
            conversation_id,
            current_user.id,
        )

        was_admin = leaver.is_admin

        await self.conversation_repository.remove_participant(
            conversation_id,
            current_user.id,
        )

        remaining_rows = (
            await self.conversation_repository
            .get_participants_with_users(conversation_id)
        )

        if not remaining_rows:

            await self.conversation_repository.revoke_invite_links(
                conversation_id
            )

            await self.message_repository.delete_conversation_content(
                conversation_id
            )

            await self.conversation_repository.delete_conversation_record(
                conversation_id
            )

            await self.conversation_repository.commit()

            return {"status": "deleted"}

        if was_admin:

            remaining_rows.sort(
                key=lambda row: row[0].joined_at
            )

            successor = remaining_rows[0][0]

            successor.is_admin = True

        message = self._system_message(
            current_user,
            conversation_id,
            f"{current_user.display_name} left the group",
        )

        await self.message_repository.create_message(message)

        await self.conversation_repository.commit()

        await manager.invalidate_members(
            [row[0].user_id for row in remaining_rows]
        )

        return {"status": "left"}

    # ==========================================================
    # Update Group Info (admin only)
    # ==========================================================

    async def update_group(
        self,
        current_user: User,
        conversation_id: UUID,
        name: str | None = None,
        description: str | None = None,
    ) -> dict:

        conversation = await self._group_conversation(
            conversation_id
        )

        if not await self._is_admin(conversation, current_user.id):
            raise PermissionError(
                "Only group admins can update the group."
            )

        if name is not None:

            cleaned = name.strip()

            if not cleaned:
                raise ValueError("Group name is required.")

            if len(cleaned) > 100:
                raise ValueError(
                    "Group name must be at most 100 characters."
                )

            if cleaned != conversation.name:

                conversation.name = cleaned

                message = self._system_message(
                    current_user,
                    conversation_id,
                    f"{current_user.display_name} changed "
                    f"the group name to \"{cleaned}\"",
                )

                await self.message_repository.create_message(
                    message
                )

        if description is not None:

            cleaned_description = description.strip() or None

            if cleaned_description != conversation.description:

                conversation.description = cleaned_description

                message = self._system_message(
                    current_user,
                    conversation_id,
                    f"{current_user.display_name} changed "
                    f"the group description",
                )

                await self.message_repository.create_message(
                    message
                )

        await self.conversation_repository.save()

        await self.conversation_repository.commit()

        return {
            "name": conversation.name,
            "description": conversation.description,
            "avatar_url": conversation.avatar_url,
        }

    # ==========================================================
    # Remove Group Member (admin only)
    # ==========================================================

    async def remove_group_member(
        self,
        current_user: User,
        conversation_id: UUID,
        user_id: UUID,
    ) -> dict:

        conversation = await self._group_conversation(
            conversation_id
        )

        if not await self._is_admin(conversation, current_user.id):
            raise PermissionError(
                "Only group admins can remove members."
            )

        if user_id == conversation.created_by:
            raise ValueError(
                "The group creator cannot be removed."
            )

        target = await self._require_participant(
            conversation_id,
            user_id,
        )
        _ = target

        target_user = await self._get_user(user_id)

        await self.conversation_repository.remove_participant(
            conversation_id,
            user_id,
        )

        target_name = (
            target_user.display_name
            or target_user.email
            if target_user is not None
            else "a member"
        )

        message = self._system_message(
            current_user,
            conversation_id,
            f"{current_user.display_name} removed "
            f"{target_name}",
        )

        await self.message_repository.create_message(message)

        await self.conversation_repository.commit()

        members = (
            await self.conversation_repository.get_participants(
                conversation_id
            )
        )

        await manager.invalidate_members(
            [row.user_id for row in members] + [user_id]
        )

        return {"status": "removed"}

    # ==========================================================
    # Promote / Demote Admin (admin only)
    # ==========================================================

    async def set_group_admin(
        self,
        current_user: User,
        conversation_id: UUID,
        user_id: UUID,
        is_admin: bool,
    ) -> dict:

        conversation = await self._group_conversation(
            conversation_id
        )

        if not await self._is_admin(conversation, current_user.id):
            raise PermissionError(
                "Only group admins can change roles."
            )

        target = await self._require_participant(
            conversation_id,
            user_id,
        )

        target_user = await self._get_user(user_id)

        target_name = (
            target_user.display_name
            or target_user.email
            if target_user is not None
            else "a member"
        )

        if not is_admin:

            if user_id == conversation.created_by:
                raise ValueError(
                    "The group creator cannot be demoted."
                )

            if user_id == current_user.id:
                raise ValueError(
                    "You cannot demote yourself."
                )

        target.is_admin = is_admin

        action = (
            f"made {target_name} an admin"
            if is_admin
            else f"demoted {target_name}"
        )

        message = self._system_message(
            current_user,
            conversation_id,
            f"{current_user.display_name} {action}",
        )

        await self.message_repository.create_message(message)

        await self.conversation_repository.commit()

        return {
            "user_id": str(user_id),
            "is_admin": is_admin,
        }

    # ==========================================================
    # Invite Links (admin only)
    # ==========================================================

    async def create_invite_link(
        self,
        current_user: User,
        conversation_id: UUID,
    ) -> dict:

        conversation = await self._group_conversation(
            conversation_id
        )

        if not await self._is_admin(conversation, current_user.id):
            raise PermissionError(
                "Only group admins can manage invite links."
            )

        # Generating a new link invalidates every previous one.
        await self.conversation_repository.revoke_invite_links(
            conversation_id
        )

        link = GroupInviteLink(
            conversation_id=conversation_id,
            token=secrets.token_urlsafe(32),
            created_by=current_user.id,
            expires_at=None,
            revoked=False,
        )

        link = await self.conversation_repository.add_invite_link(
            link
        )

        await self.conversation_repository.commit()

        return self._link_payload(link)

    async def get_invite_link(
        self,
        current_user: User,
        conversation_id: UUID,
    ) -> dict | None:

        conversation = await self._group_conversation(
            conversation_id
        )

        if not await self._is_admin(conversation, current_user.id):
            raise PermissionError(
                "Only group admins can view invite links."
            )

        link = (
            await self.conversation_repository.get_active_invite_link(
                conversation_id
            )
        )

        if link is None:
            return None

        return self._link_payload(link)

    async def revoke_invite_link(
        self,
        current_user: User,
        conversation_id: UUID,
    ) -> dict:

        conversation = await self._group_conversation(
            conversation_id
        )

        if not await self._is_admin(conversation, current_user.id):
            raise PermissionError(
                "Only group admins can revoke invite links."
            )

        await self.conversation_repository.revoke_invite_links(
            conversation_id
        )

        await self.conversation_repository.commit()

        return {"revoked": True}

    # ==========================================================
    # Join Group via Invite Link
    # ==========================================================

    async def join_group_with_link(
        self,
        current_user: User,
        token: str,
    ) -> dict:

        raw_token = (token or "").strip()

        # Accept a full URL form as well as the bare token.
        if "/" in raw_token:
            raw_token = raw_token.rstrip("/").rsplit("/", 1)[-1]

        link = (
            await self.conversation_repository.get_invite_link_by_token(
                raw_token
            )
        )

        invalid = PermissionError(
            "This invite link is invalid or has been revoked."
        )

        if link is None:
            raise invalid

        active = (
            await self.conversation_repository.get_active_invite_link(
                link.conversation_id
            )
        )

        if active is None or active.id != link.id:
            raise invalid

        conversation = (
            await self.conversation_repository.get_by_id(
                link.conversation_id
            )
        )

        if (
            conversation is None
            or conversation.conversation_type != "group"
        ):
            raise invalid

        existing = (
            await self.conversation_repository.get_participant(
                conversation.id,
                current_user.id,
            )
        )

        participant_count = (
            await self.conversation_repository.get_participant_count(
                conversation.id
            )
        )

        if existing is not None:

            return {
                "status": "already_member",
                "conversation_id": str(conversation.id),
                "participant_count": participant_count,
            }

        await self.conversation_repository.add_participant(
            ConversationParticipant(
                conversation_id=conversation.id,
                user_id=current_user.id,
            )
        )

        message = self._system_message(
            current_user,
            conversation.id,
            f"{current_user.display_name} joined the group",
        )

        await self.message_repository.create_message(message)

        await self.conversation_repository.commit()

        members = (
            await self.conversation_repository.get_participants(
                conversation.id
            )
        )

        await manager.invalidate_members(
            [row.user_id for row in members]
        )

        return {
            "status": "joined",
            "conversation_id": str(conversation.id),
            "participant_count": participant_count + 1,
        }

    # ==========================================================
    # Two-Party Conversation Deletion (private chats)
    # ==========================================================

    async def _private_conversation_for(
        self,
        current_user: User,
        conversation_id: UUID,
    ) -> Conversation:

        conversation = (
            await self.conversation_repository.get_by_id(
                conversation_id
            )
        )

        if conversation is None:
            raise ValueError("Conversation not found.")

        if conversation.conversation_type != "private":
            raise ValueError(
                "Two-party deletion applies only to private "
                "conversations."
            )

        await self._require_participant(
            conversation_id,
            current_user.id,
        )

        return conversation

    async def request_conversation_delete(
        self,
        current_user: User,
        conversation_id: UUID,
    ) -> dict:

        conversation = await self._private_conversation_for(
            current_user,
            conversation_id,
        )

        already_requested = (
            conversation.delete_requested_by is not None
        )

        if already_requested and (
            conversation.delete_requested_by != current_user.id
        ):

            # The other party already asked: this request IS the
            # mutual consent. Wipe everything immediately.
            await self._purge_conversation(conversation_id)

            await self.conversation_repository.commit()

            await manager.broadcast(
                conversation_id,
                {
                    "event": "conversation_deleted",
                    "conversation_id": str(conversation_id),
                },
            )

            return {"status": "deleted"}

        if not already_requested:

            conversation.delete_requested_by = current_user.id

            conversation.delete_requested_at = datetime.now(
                timezone.utc
            )

            other_user = (
                await self.conversation_repository.get_other_user(
                    conversation_id,
                    current_user.id,
                )
            )

            exclude = (
                {other_user.id}
                if other_user is not None
                else None
            )

            # Persist BEFORE broadcasting: a broadcast opens its
            # own DB session and would discard an open flush.
            await self.conversation_repository.commit()

            await manager.broadcast(
                conversation_id,
                {
                    "event": "conversation_delete_request",
                    "conversation_id": str(conversation_id),
                    "requested_by": str(current_user.id),
                    "requested_at": (
                        conversation.delete_requested_at.isoformat()
                        if conversation.delete_requested_at
                        else None
                    ),
                    "requested_by_name": (
                        current_user.display_name
                        or current_user.email
                    ),
                },
                exclude_user_ids=exclude,
            )

        else:
            await self.conversation_repository.commit()

        return {
            "status": "requested",
            "delete_requested_by": str(current_user.id),
        }

    async def confirm_conversation_delete(
        self,
        current_user: User,
        conversation_id: UUID,
    ) -> dict:

        conversation = await self._private_conversation_for(
            current_user,
            conversation_id,
        )

        if (
            conversation.delete_requested_by is None
            or conversation.delete_requested_by
            == current_user.id
        ):
            raise ValueError(
                "No pending deletion request to confirm."
            )

        await self._purge_conversation(conversation_id)

        await self.conversation_repository.commit()

        await manager.broadcast(
            conversation_id,
            {
                "event": "conversation_deleted",
                "conversation_id": str(conversation_id),
            },
        )

        return {"status": "deleted"}

    async def cancel_conversation_delete(
        self,
        current_user: User,
        conversation_id: UUID,
    ) -> dict:

        conversation = await self._private_conversation_for(
            current_user,
            conversation_id,
        )

        if conversation.delete_requested_by is None:
            raise ValueError("No pending deletion request.")

        conversation.delete_requested_by = None

        conversation.delete_requested_at = None

        await self.conversation_repository.save()

        await self.conversation_repository.commit()

        # Tell the other participant the wipe was cancelled so
        # their "X wants to delete this chat" banner clears.
        await manager.broadcast(
            conversation_id,
            {
                "event": "conversation_delete_cancelled",
                "conversation_id": str(conversation_id),
            },
        )

        return {"status": "cancelled"}

    # ==========================================================
    # Per-User Settings (pin / archive / mute / disappearing)
    # ==========================================================

    async def update_settings(
        self,
        current_user: User,
        conversation_id: UUID,
        is_pinned: bool | None = None,
        is_archived: bool | None = None,
        muted_until: datetime | object | None = _UNSET,
        disappear_after_seconds: int | object | None = _UNSET,
    ) -> dict:

        conversation = (
            await self.conversation_repository.get_by_id(
                conversation_id
            )
        )

        if conversation is None:
            raise ValueError("Invalid conversation id.")

        participant = (
            await self.conversation_repository.get_participant(
                conversation_id,
                current_user.id,
            )
        )

        if participant is None:
            raise PermissionError(
                "You are not a participant of this conversation."
            )

        if is_pinned is not None:
            participant.is_pinned = bool(is_pinned)

        if is_archived is not None:
            participant.is_archived = bool(is_archived)

        if muted_until is not _UNSET:
            participant.muted_until = muted_until

        if disappear_after_seconds is not _UNSET:

            if (
                conversation.conversation_type == "group"
                and not await self._is_admin(
                    conversation, current_user.id
                )
            ):
                raise PermissionError(
                    "Only group admins can change disappearing "
                    "messages."
                )

            conversation.disappear_after_seconds = (
                disappear_after_seconds
                or None
            )

        await self.conversation_repository.save()

        muted = False

        if participant.muted_until:

            effective_until = participant.muted_until

            if effective_until.tzinfo is None:
                effective_until = effective_until.replace(
                    tzinfo=timezone.utc
                )

            muted = (
                effective_until > datetime.now(timezone.utc)
            )

        return {
            "is_pinned": participant.is_pinned,
            "is_archived": participant.is_archived,
            "muted": muted,
            "disappear_after_seconds": (
                conversation.disappear_after_seconds
            ),
        }
