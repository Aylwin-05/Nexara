import mimetypes
import traceback
from pathlib import Path
from uuid import UUID

from app.core.file_config import (
    AVATAR_DIR,
    AVATAR_EXTENSIONS,
    MAX_AVATAR_SIZE,
)
from app.core.magic_sniff import (
    HEADER_SIZE,
    sniff_header,
)
from app.database.session import get_db
from app.dependencies.auth import get_current_user
from app.dependencies.rate_limit import rate_limit
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
from app.schemas.conversation import (
    AddGroupMembersRequest,
    ConversationResponse,
    CreateConversationRequest,
    CreateGroupRequest,
    JoinGroupWithLinkRequest,
    RemoveGroupMemberRequest,
    SetGroupAdminRequest,
    UpdateConversationSettingsRequest,
    UpdateGroupRequest,
)
from app.services.conversation_service import (
    ConversationService,
)
from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    UploadFile,
)
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(
    prefix="/conversations",
    tags=["Conversations"],
)


# ==========================================================
# Open/Create Conversation
# ==========================================================


@router.post(
    "/private",
    response_model=ConversationResponse,
    dependencies=[
        rate_limit("conversations.create", 30, 60),
    ],
)
async def create_private_conversation(
    request: CreateConversationRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        conversation_repository = ConversationRepository(db)
        message_repository = MessageRepository(db)

        service = ConversationService(
            conversation_repository,
            message_repository,
        )

        conversation = await service.get_or_create_private_conversation(
            current_user,
            request.user_id,
        )

        await db.commit()

        await db.refresh(conversation)

        other_user = await conversation_repository.get_other_user(
            conversation.id,
            current_user.id,
        )

        last_message = await message_repository.get_last_message(
            conversation.id,
            current_user.id,
        )

        return {
            "id": conversation.id,
            "updated_at": conversation.updated_at,
            "other_user": other_user,
            "last_message": (
                {
                    "ciphertext": last_message.ciphertext,
                    "message_type": last_message.message_type,
                    "created_at": last_message.created_at,
                }
                if last_message
                else None
            ),
            "disappear_after_seconds": conversation.disappear_after_seconds,
            "delete_requested_by": str(conversation.delete_requested_by)
            if conversation.delete_requested_by
            else None,
            "delete_requested_at": conversation.delete_requested_at.isoformat()
            if conversation.delete_requested_at
            else None,
        }

    except Exception:
        traceback.print_exc()
        raise


# ==========================================================
# Update Settings (pin / archive / mute)
# ==========================================================


@router.patch("/{conversation_id}")
async def update_conversation_settings(
    conversation_id: str,
    request: UpdateConversationSettingsRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from uuid import UUID

    try:
        conversation_repository = ConversationRepository(db)
        message_repository = MessageRepository(db)

        service = ConversationService(
            conversation_repository,
            message_repository,
        )

        # Only apply the fields the client actually sent, so an
        # explicit `muted_until: null` can clear an existing mute.
        payload = {}

        if "is_pinned" in request.model_fields_set:
            payload["is_pinned"] = bool(request.is_pinned)

        if "is_archived" in request.model_fields_set:
            payload["is_archived"] = bool(request.is_archived)

        if "muted_until" in request.model_fields_set:
            payload["muted_until"] = request.muted_until

        if "disappear_after_seconds" in request.model_fields_set:
            payload["disappear_after_seconds"] = request.disappear_after_seconds

        settings = await service.update_settings(
            current_user,
            UUID(conversation_id),
            **payload,
        )

        await db.commit()

        return {
            "id": conversation_id,
            **settings,
        }

    except PermissionError as error:
        raise HTTPException(
            status_code=403,
            detail=str(error),
        ) from error

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail="Invalid conversation id.",
        ) from error


# ==========================================================
# My Conversations
# ==========================================================


@router.get("/")
async def my_conversations(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    conversation_repository = ConversationRepository(db)
    message_repository = MessageRepository(db)

    service = ConversationService(
        conversation_repository,
        message_repository,
    )

    return await service.my_conversations(current_user)


# ==========================================================
# Create Group
# ==========================================================


@router.post(
    "/group",
    response_model=ConversationResponse,
    dependencies=[
        rate_limit("conversations.create", 30, 60),
    ],
)
async def create_group(
    request: CreateGroupRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        conversation_repository = ConversationRepository(db)
        message_repository = MessageRepository(db)

        service = ConversationService(
            conversation_repository,
            message_repository,
            FriendRepository(db),
        )

        conversation = await service.create_group(
            current_user,
            request.name,
            request.member_ids,
        )

        await db.commit()

        await db.refresh(conversation)

        participant_count = await conversation_repository.get_participant_count(conversation.id)

        return {
            "id": conversation.id,
            "updated_at": conversation.updated_at,
            "conversation_type": conversation.conversation_type,
            "name": conversation.name,
            "participant_count": participant_count,
            "other_user": None,
            "last_message": None,
            "disappear_after_seconds": conversation.disappear_after_seconds,
            "delete_requested_by": None,
            "delete_requested_at": None,
        }

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        ) from error


# ==========================================================
# Group Detail
# ==========================================================


@router.get(
    "/{conversation_id}",
    dependencies=[
        rate_limit("conversations.detail", 60, 60),
    ],
)
async def group_detail(
    conversation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        conversation_repository = ConversationRepository(db)
        message_repository = MessageRepository(db)

        service = ConversationService(
            conversation_repository,
            message_repository,
        )

        return await service.get_group_detail(
            current_user,
            UUID(conversation_id),
        )

    except PermissionError as error:
        raise HTTPException(
            status_code=403,
            detail=str(error),
        ) from error

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        ) from error


# ==========================================================
# Add Group Members (admin only)
# ==========================================================


@router.post(
    "/{conversation_id}/group/add",
    dependencies=[
        rate_limit("conversations.group", 20, 60),
    ],
)
async def add_group_members(
    conversation_id: str,
    request: AddGroupMembersRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        conversation_repository = ConversationRepository(db)
        message_repository = MessageRepository(db)

        service = ConversationService(
            conversation_repository,
            message_repository,
            FriendRepository(db),
        )

        return await service.add_group_members(
            current_user,
            UUID(conversation_id),
            request.member_ids,
        )

    except PermissionError as error:
        raise HTTPException(
            status_code=403,
            detail=str(error),
        ) from error

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        ) from error


# ==========================================================
# Leave Group
# ==========================================================


@router.post(
    "/{conversation_id}/group/leave",
    dependencies=[
        rate_limit("conversations.group", 20, 60),
    ],
)
async def leave_group(
    conversation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        conversation_repository = ConversationRepository(db)
        message_repository = MessageRepository(db)

        service = ConversationService(
            conversation_repository,
            message_repository,
        )

        return await service.leave_group(
            current_user,
            UUID(conversation_id),
        )

    except PermissionError as error:
        raise HTTPException(
            status_code=403,
            detail=str(error),
        ) from error

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        ) from error


# ==========================================================
# Update Group Info (name / description, admin only)
# ==========================================================


@router.patch(
    "/{conversation_id}/group",
    dependencies=[
        rate_limit("conversations.group", 20, 60),
    ],
)
async def update_group(
    conversation_id: str,
    request: UpdateGroupRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        conversation_repository = ConversationRepository(db)
        message_repository = MessageRepository(db)

        service = ConversationService(
            conversation_repository,
            message_repository,
        )

        return await service.update_group(
            current_user,
            UUID(conversation_id),
            name=request.name,
            description=request.description,
        )

    except PermissionError as error:
        raise HTTPException(
            status_code=403,
            detail=str(error),
        ) from error

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        ) from error


# ==========================================================
# Remove Group Member (admin only)
# ==========================================================


@router.post(
    "/{conversation_id}/group/remove",
    dependencies=[
        rate_limit("conversations.group", 20, 60),
    ],
)
async def remove_group_member(
    conversation_id: str,
    request: RemoveGroupMemberRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        conversation_repository = ConversationRepository(db)
        message_repository = MessageRepository(db)

        service = ConversationService(
            conversation_repository,
            message_repository,
        )

        return await service.remove_group_member(
            current_user,
            UUID(conversation_id),
            request.user_id,
        )

    except PermissionError as error:
        raise HTTPException(
            status_code=403,
            detail=str(error),
        ) from error

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        ) from error


# ==========================================================
# Promote / Demote Admin (admin only)
# ==========================================================


@router.post(
    "/{conversation_id}/group/admin",
    dependencies=[
        rate_limit("conversations.group", 20, 60),
    ],
)
async def set_group_admin(
    conversation_id: str,
    request: SetGroupAdminRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        conversation_repository = ConversationRepository(db)
        message_repository = MessageRepository(db)

        service = ConversationService(
            conversation_repository,
            message_repository,
        )

        return await service.set_group_admin(
            current_user,
            UUID(conversation_id),
            request.user_id,
            request.is_admin,
        )

    except PermissionError as error:
        raise HTTPException(
            status_code=403,
            detail=str(error),
        ) from error

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        ) from error


# ==========================================================
# Join Group via Invite Link
# ==========================================================


@router.post(
    "/join-with-link",
    dependencies=[
        rate_limit("conversations.group", 10, 60),
    ],
)
async def join_group_with_link(
    request: JoinGroupWithLinkRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        conversation_repository = ConversationRepository(db)
        message_repository = MessageRepository(db)

        service = ConversationService(
            conversation_repository,
            message_repository,
        )

        return await service.join_group_with_link(
            current_user,
            request.token,
        )

    except PermissionError as error:
        raise HTTPException(
            status_code=403,
            detail=str(error),
        ) from error

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        ) from error


# ==========================================================
# Get Invite Link (admin only)
# ==========================================================


@router.get(
    "/{conversation_id}/group/invite-link",
    dependencies=[
        rate_limit("conversations.group", 30, 60),
    ],
)
async def get_invite_link(
    conversation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        conversation_repository = ConversationRepository(db)
        message_repository = MessageRepository(db)

        service = ConversationService(
            conversation_repository,
            message_repository,
        )

        return await service.get_invite_link(
            current_user,
            UUID(conversation_id),
        )

    except PermissionError as error:
        raise HTTPException(
            status_code=403,
            detail=str(error),
        ) from error

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        ) from error


# ==========================================================
# Create / Reset Invite Link (admin only)
# ==========================================================


@router.post(
    "/{conversation_id}/group/invite-link",
    dependencies=[
        rate_limit("conversations.group", 10, 60),
    ],
)
async def create_invite_link(
    conversation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        conversation_repository = ConversationRepository(db)
        message_repository = MessageRepository(db)

        service = ConversationService(
            conversation_repository,
            message_repository,
        )

        return await service.create_invite_link(
            current_user,
            UUID(conversation_id),
        )

    except PermissionError as error:
        raise HTTPException(
            status_code=403,
            detail=str(error),
        ) from error

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        ) from error


# ==========================================================
# Revoke Invite Link (admin only)
# ==========================================================


@router.delete(
    "/{conversation_id}/group/invite-link",
    dependencies=[
        rate_limit("conversations.group", 10, 60),
    ],
)
async def revoke_invite_link(
    conversation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        conversation_repository = ConversationRepository(db)
        message_repository = MessageRepository(db)

        service = ConversationService(
            conversation_repository,
            message_repository,
        )

        return await service.revoke_invite_link(
            current_user,
            UUID(conversation_id),
        )

    except PermissionError as error:
        raise HTTPException(
            status_code=403,
            detail=str(error),
        ) from error

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        ) from error


# ==========================================================
# Group Avatar Upload (admin only)
# ==========================================================


@router.post(
    "/{conversation_id}/avatar",
    dependencies=[
        rate_limit("conversations.group", 20, 60),
    ],
)
async def upload_group_avatar(
    conversation_id: str,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    conversation_repository = ConversationRepository(db)
    message_repository = MessageRepository(db)

    service = ConversationService(
        conversation_repository,
        message_repository,
    )

    try:
        conversation = await service.get_group_for_avatar(
            current_user,
            UUID(conversation_id),
        )
    except PermissionError as error:
        raise HTTPException(
            status_code=403,
            detail=str(error),
        ) from error

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        ) from error

    filename = file.filename or ""
    extension = Path(filename).suffix.lower()

    if extension not in AVATAR_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Unsupported image type.",
        )

    content = await file.read()

    if len(content) > MAX_AVATAR_SIZE:
        raise HTTPException(
            status_code=413,
            detail="Avatar image is too large (max 5 MB).",
        )

    if not content:
        raise HTTPException(
            status_code=400,
            detail="Empty file.",
        )

    # The extension is only a claim: the bytes must match.
    if not sniff_header(extension, content[:HEADER_SIZE]):
        raise HTTPException(
            status_code=400,
            detail="File content does not match its declared type.",
        )

    for old_file in AVATAR_DIR.glob(f"{conversation_id}.*"):
        old_file.unlink(missing_ok=True)

    destination = AVATAR_DIR / f"{conversation_id}{extension}"

    destination.write_bytes(content)

    conversation.avatar_url = f"/api/v1/conversations/{conversation_id}/avatar"

    await conversation_repository.save()

    # Persist BEFORE broadcasting: the broadcast opens its own
    # DB session and would discard an open flush.
    await db.commit()

    await service.broadcast_group_avatar_changed(
        conversation,
        current_user,
    )

    return {
        "id": conversation.id,
        "avatar_url": conversation.avatar_url,
    }


# ==========================================================
# Group Avatar Fetch (participants only)
# ==========================================================


@router.get("/{conversation_id}/avatar")
async def get_group_avatar(
    conversation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    conversation_repository = ConversationRepository(db)

    service = ConversationService(
        conversation_repository,
        MessageRepository(db),
    )

    try:
        await service.get_group_for_avatar(
            current_user,
            UUID(conversation_id),
            admin_only=False,
        )
    except PermissionError as error:
        raise HTTPException(
            status_code=404,
            detail=str(error),
        ) from error

    except ValueError as error:
        raise HTTPException(
            status_code=404,
            detail=str(error),
        ) from error

    avatar_files = list(AVATAR_DIR.glob(f"{conversation_id}.*"))

    if not avatar_files:
        raise HTTPException(
            status_code=404,
            detail="Avatar not found.",
        )

    file_path = avatar_files[0]

    media_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"

    return FileResponse(
        path=file_path,
        media_type=media_type,
    )


# ==========================================================
# Two-Party Conversation Deletion
#
# request:  User 1 presses "delete chat" -> pending request,
#           the other participant gets a real-time popup.
# confirm:  User 2 confirms -> BOTH consented, the server
#           purges all messages + attachments (rows and
#           physical files) + the conversation itself.
# cancel:   Either participant aborts a pending request.
# ==========================================================


@router.post(
    "/{conversation_id}/delete-request",
    dependencies=[
        rate_limit("conversations.delete", 10, 60),
    ],
)
async def request_conversation_delete(
    conversation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        conversation_repository = ConversationRepository(db)
        message_repository = MessageRepository(db)

        service = ConversationService(
            conversation_repository,
            message_repository,
        )

        return await service.request_conversation_delete(
            current_user,
            UUID(conversation_id),
        )

    except PermissionError as error:
        raise HTTPException(
            status_code=403,
            detail=str(error),
        ) from error

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        ) from error


@router.post(
    "/{conversation_id}/delete-confirm",
    dependencies=[
        rate_limit("conversations.delete", 10, 60),
    ],
)
async def confirm_conversation_delete(
    conversation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        conversation_repository = ConversationRepository(db)
        message_repository = MessageRepository(db)

        service = ConversationService(
            conversation_repository,
            message_repository,
        )

        return await service.confirm_conversation_delete(
            current_user,
            UUID(conversation_id),
        )

    except PermissionError as error:
        raise HTTPException(
            status_code=403,
            detail=str(error),
        ) from error

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        ) from error


@router.post(
    "/{conversation_id}/delete-cancel",
    dependencies=[
        rate_limit("conversations.delete", 10, 60),
    ],
)
async def cancel_conversation_delete(
    conversation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        conversation_repository = ConversationRepository(db)
        message_repository = MessageRepository(db)

        service = ConversationService(
            conversation_repository,
            message_repository,
        )

        return await service.cancel_conversation_delete(
            current_user,
            UUID(conversation_id),
        )

    except PermissionError as error:
        raise HTTPException(
            status_code=403,
            detail=str(error),
        ) from error

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        ) from error
