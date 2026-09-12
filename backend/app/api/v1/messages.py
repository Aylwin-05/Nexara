from pathlib import Path
from uuid import UUID

from app.database.session import get_db
from app.dependencies.auth import get_current_user
from app.dependencies.rate_limit import rate_limit
from app.models.message import Message
from app.models.user import User
from app.repositories.attachment_repository import AttachmentRepository
from app.repositories.block_repository import BlockRepository
from app.repositories.conversation_repository import ConversationRepository
from app.repositories.device_repository import DeviceRepository
from app.repositories.message_repository import MessageRepository, _message_options
from app.schemas.attachment import AttachmentResponse
from app.schemas.message import (
    EditMessageRequest,
    MessageResponse,
    ReactionRequest,
    ReactionResponse,
    SendMessageRequest,
    StarRequest,
    SyncCopyUpsert,
)
from app.services.attachment_service import AttachmentService
from app.services.message_service import MessageService
from app.websocket.connection_manager import manager
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
)
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(
    prefix="/messages",
    tags=["Messages"],
)

# ==========================================================
# Convert DB model -> API response
# ==========================================================
def serialize_message(message):

    attachments = [    {
        "id": attachment.id,
        "original_name": attachment.original_name,
        "filename": attachment.filename,
        "mime_type": attachment.mime_type,
        "attachment_type": attachment.attachment_type,
        "extension": attachment.extension,
        "size": attachment.size,
        "download_url": f"/api/v1/attachments/{attachment.id}",
        "created_at": attachment.created_at,
        "encrypted": attachment.encrypted,
        "encrypted_key_sender": attachment.encrypted_key_sender,
        "encrypted_key_receiver": attachment.encrypted_key_receiver,
        "nonce": attachment.nonce,
        "wrapped_keys": attachment.wrapped_keys or [],
        "sync_blob": attachment.sync_blob,
        "view_once": attachment.view_once,
    }
    for attachment in message.attachments]

    # Only serialize if SQLAlchemy has already loaded them
    if "attachments" in message.__dict__:
        attachments = [
            AttachmentResponse.model_validate(a)
            for a in message.attachments
        ]

    return MessageResponse(
        id=message.id,
        conversation_id=message.conversation_id,
        sender_id=message.sender_id,

        ciphertext=message.ciphertext,
        encrypted_key_sender=message.encrypted_key_sender,
        encrypted_key_receiver=message.encrypted_key_receiver,
        nonce=message.nonce,
        crypto_version=message.crypto_version,

        message_type=message.message_type,
        reply_to_id=message.reply_to_id,

        edited=message.edited,
        is_forwarded=message.is_forwarded,
        forwarded_count=message.forwarded_count,
        deleted_for_everyone=message.deleted_for_everyone,
        is_starred=getattr(message, "is_starred", False),

        is_read=message.is_read,
        delivered_at=message.delivered_at,
        read_at=message.read_at,
        expires_at=message.expires_at,

        view_once_opened=message.view_once_opened,

        created_at=message.created_at,
        updated_at=message.updated_at,

        attachments=attachments,

        reactions=[
            ReactionResponse(
                user_id=reaction.user_id,
                emoji=reaction.emoji,
                created_at=reaction.created_at,
            )
            for reaction in message.reactions
        ],

        recipient_keys=[
            {
                "user_id": key.user_id,
                "encrypted_key": key.encrypted_key,
            }
            for key in message.recipient_keys
        ]
        if "recipient_keys" in message.__dict__
        else [],

        envelopes=message.envelopes or [],

        sync_envelope=message.sync_envelope,
    )


# ==========================================================
# SEND ENCRYPTED MESSAGE
# ==========================================================

@router.post(
    "/send",
    response_model=MessageResponse,
    dependencies=[
        rate_limit("messages.send", 60, 60),
    ],
)
async def send_message(
    request: SendMessageRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):

    message_repository = MessageRepository(db)
    conversation_repository = ConversationRepository(db)
    attachment_repository = AttachmentRepository(db)

    conversation = await conversation_repository.get_by_id(
        request.conversation_id
    )

    if conversation is None:
        raise HTTPException(
            status_code=404,
            detail="Conversation not found.",
        )

    if not await conversation_repository.is_participant(
        request.conversation_id,
        current_user.id,
    ):
        raise HTTPException(
            status_code=403,
            detail="Not a participant of this conversation.",
        )

    if conversation.conversation_type == "private":

        block_repository = BlockRepository(db)

        participants = (
            await conversation_repository.get_participants(
                request.conversation_id
            )
        )

        for participant in participants:

            other_id = participant.user_id

            if other_id == current_user.id:
                continue

            if await block_repository.is_blocked(
                current_user.id,
                other_id,
            ):
                raise HTTPException(
                    status_code=403,
                    detail="You cannot send messages to this user.",
                )

    attachment_service = AttachmentService(
        attachment_repository
    )

    service = MessageService(
        message_repository,
        conversation_repository,
        attachment_service,
        DeviceRepository(db),
    )

    try:

        message = await service.send_message(
                current_user=current_user,
                conversation_id=request.conversation_id,
                ciphertext=request.ciphertext,
                encrypted_key_sender=request.encrypted_key_sender,
                encrypted_key_receiver=request.encrypted_key_receiver,
                nonce=request.nonce,
                message_type=request.message_type,
                reply_to_id=request.reply_to_id,
                is_forwarded=request.is_forwarded,
                forwarded_count=request.forwarded_count,
                client_message_id=request.client_message_id,
                recipient_keys=[
                (key.user_id, key.encrypted_key)
                for key in request.recipient_keys
            ]
            if request.recipient_keys
            else None,
            envelopes=[
                {
                    "device_id": env.device_id,
                    "data": env.data,
                }
                for env in request.envelopes
            ]
            if request.envelopes
            else None,
        )

        await db.commit()

        await db.refresh(
        message,
        [
            "attachments",
            "reactions",
            "recipient_keys",
        ]
        )

        return serialize_message(message)

    except ValueError as e:

        await db.rollback()

        raise HTTPException(
            status_code=400,
            detail=str(e),
        )


# ==========================================================
# EDIT ENCRYPTED MESSAGE
#
# The edited plaintext never reaches the backend: the client
# re-encrypts it (Signal ratchet) and sends the new ciphertext
# + wrapped keys, exactly like a fresh send.
# ==========================================================

@router.put(
    "/{message_id}/edit",
    response_model=MessageResponse,
    dependencies=[
        rate_limit("messages.edit", 30, 60),
    ],
)
async def edit_message(
    message_id: UUID,
    request: EditMessageRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):

    message_repository = MessageRepository(db)
    conversation_repository = ConversationRepository(db)
    attachment_repository = AttachmentRepository(db)

    attachment_service = AttachmentService(
        attachment_repository
    )

    service = MessageService(
        message_repository,
        conversation_repository,
        attachment_service,
        DeviceRepository(db),
    )

    try:

        message = await service.edit_message(
            current_user=current_user,
            message_id=message_id,
            ciphertext=request.ciphertext,
            encrypted_key_sender=request.encrypted_key_sender,
            encrypted_key_receiver=request.encrypted_key_receiver,
            nonce=request.nonce,
            recipient_keys=[
                (key.user_id, key.encrypted_key)
                for key in request.recipient_keys
            ]
            if request.recipient_keys
            else None,
            envelopes=[
                {
                    "device_id": env.device_id,
                    "data": env.data,
                }
                for env in request.envelopes
            ]
            if request.envelopes
            else None,
            sync_envelope={
                "nonce": request.sync_envelope.nonce,
                "data": request.sync_envelope.data,
                "ciphertext": request.sync_envelope.ciphertext,
            }
            if request.sync_envelope
            else None,
        )

        await db.commit()

        # Full reload: a partial refresh would expire the other
        # columns (updated_at is DB-computed by onupdate) and
        # serialize_message would then trigger an async lazy load.
        message = await message_repository.reload_with_relations(
            message.id
        )

        await manager.broadcast(
            message.conversation_id,
            {
                "event": "edit",
                "message_id": str(message.id),
                "sender_id": str(message.sender_id),
                "ciphertext": message.ciphertext,
                "encrypted_key_sender": message.encrypted_key_sender,
                "encrypted_key_receiver": message.encrypted_key_receiver,
                "nonce": message.nonce,
                "edited": True,
                "updated_at": message.updated_at.isoformat()
                if message.updated_at
                else None,
                "envelopes": message.envelopes or [],
            },
        )

        return serialize_message(message)

    except ValueError as e:

        await db.rollback()

        raise HTTPException(
            status_code=400,
            detail=str(e),
        )


# ==========================================================
# TOGGLE EMOJI REACTION
#
# WhatsApp behaviour: tapping the same emoji again removes
# the reaction; a different emoji replaces it.
# ==========================================================

@router.put(
    "/{message_id}/reaction",
    dependencies=[
        rate_limit("messages.reaction", 60, 60),
    ],
)
async def toggle_reaction(
    message_id: UUID,
    request: ReactionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):

    message_repository = MessageRepository(db)
    conversation_repository = ConversationRepository(db)
    attachment_repository = AttachmentRepository(db)

    attachment_service = AttachmentService(
        attachment_repository
    )

    service = MessageService(
        message_repository,
        conversation_repository,
        attachment_service,
        DeviceRepository(db),
    )

    try:

        result = await service.toggle_reaction(
            current_user=current_user,
            message_id=message_id,
            emoji=request.emoji,
        )

        await db.commit()

        message = await service.get_message(
            current_user,
            message_id,
        )

        await manager.broadcast(
            message.conversation_id,
            {
                "event": "reaction",
                **result,
            },
        )

        return result

    except ValueError as e:

        await db.rollback()

        raise HTTPException(
            status_code=400,
            detail=str(e),
        )


# ==========================================================
# STAR / UNSTAR MESSAGE (per-user, personal)
# ==========================================================

@router.put(
    "/{message_id}/star",
    dependencies=[
        rate_limit("messages.star", 120, 60),
    ],
)
async def set_star(
    message_id: UUID,
    request: StarRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):

    message_repository = MessageRepository(db)
    conversation_repository = ConversationRepository(db)
    attachment_repository = AttachmentRepository(db)

    attachment_service = AttachmentService(
        attachment_repository
    )

    service = MessageService(
        message_repository,
        conversation_repository,
        attachment_service,
        DeviceRepository(db),
    )

    try:

        result = await service.set_star(
            current_user=current_user,
            message_id=message_id,
            starred=request.starred,
        )

        await db.commit()

        return result

    except ValueError as e:

        await db.rollback()

        raise HTTPException(
            status_code=400,
            detail=str(e),
        )


# ==========================================================
# GET STARRED MESSAGES (optionally filtered by conversation)
# ==========================================================

@router.get(
    "/starred",
    response_model=list[MessageResponse],
    dependencies=[
        rate_limit("messages.starred", 60, 60),
    ],
)
async def get_starred_messages(
    conversation_id: UUID | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):

    message_repository = MessageRepository(db)
    conversation_repository = ConversationRepository(db)
    attachment_repository = AttachmentRepository(db)

    attachment_service = AttachmentService(
        attachment_repository
    )

    service = MessageService(
        message_repository,
        conversation_repository,
        attachment_service,
        DeviceRepository(db),
    )

    try:

        messages = await service.get_starred_messages(
            current_user=current_user,
            conversation_id=conversation_id,
        )

        return [
            serialize_message(message)
            for message in messages
        ]

    except ValueError as e:

        raise HTTPException(
            status_code=400,
            detail=str(e),
        )


# ==========================================================
# VIEW ONCE MEDIA: recipient reports the media as opened
# ==========================================================

@router.post(
    "/{message_id}/view-once-opened",
    dependencies=[
        rate_limit("messages.viewonce", 30, 60),
    ],
)
async def mark_view_once_opened(
    message_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):

    message_repository = MessageRepository(db)
    conversation_repository = ConversationRepository(db)
    attachment_repository = AttachmentRepository(db)

    attachment_service = AttachmentService(
        attachment_repository
    )

    service = MessageService(
        message_repository,
        conversation_repository,
        attachment_service,
        DeviceRepository(db),
    )

    try:

        result = await service.mark_view_once_opened(
            current_user=current_user,
            message_id=message_id,
        )

        await db.commit()

        # Both sides must swap the media for the "Opened"
        # placeholder in real time.
        await manager.broadcast(
            UUID(result["conversation_id"]),
            {
                "event": "view_once_opened",
                **result,
            },
        )

        return result

    except ValueError as e:

        await db.rollback()

        raise HTTPException(
            status_code=400,
            detail=str(e),
        )


# ==========================================================
# GET CONVERSATION MESSAGES
# ==========================================================

@router.get(
    "/{conversation_id}",
    response_model=list[MessageResponse],
    dependencies=[
        rate_limit("messages.history", 120, 60),
    ],
)
async def get_messages(
    conversation_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    limit: int = 50,
    before: UUID | None = None,
):

    message_repository = MessageRepository(db)
    conversation_repository = ConversationRepository(db)
    attachment_repository = AttachmentRepository(db)

    attachment_service = AttachmentService(
        attachment_repository
    )

    service = MessageService(
        message_repository,
        conversation_repository,
        attachment_service,
        DeviceRepository(db),
    )

    try:

        messages = await service.get_messages(
            current_user=current_user,
            conversation_id=conversation_id,
            limit=min(limit, 200) if limit > 0 else None,
            before=before,
        )

        return [
            serialize_message(message)
            for message in messages
        ]

    except ValueError as e:

        raise HTTPException(
            status_code=400,
            detail=str(e),
        )


# ==========================================================
# UPSERT SYNC ENVELOPE (cross-browser history)
#
# Any device that has decrypted a message — and holds the
# account sync secret — stores an account-key copy of the
# plaintext here, so browsers that register later can read the
# message after unlocking the secret with the recovery code.
# ==========================================================

@router.put(
    "/{message_id}/sync-envelope",
    response_model=MessageResponse,
    dependencies=[
        rate_limit("messages.sync", 300, 60),
    ],
)
async def upsert_sync_envelope(
    message_id: UUID,
    request: SyncCopyUpsert,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):

    message_repository = MessageRepository(db)
    conversation_repository = ConversationRepository(db)
    attachment_repository = AttachmentRepository(db)

    attachment_service = AttachmentService(
        attachment_repository
    )

    service = MessageService(
        message_repository,
        conversation_repository,
        attachment_service,
        DeviceRepository(db),
    )

    try:

        message = await service.upsert_sync_envelope(
            current_user=current_user,
            message_id=message_id,
            sync_envelope={
                "nonce": request.sync_copy.nonce,
                "data": request.sync_copy.data,
                "ciphertext": request.sync_copy.ciphertext,
            },
        )

        await db.commit()

        message = await message_repository.reload_with_relations(
            message.id
        )

        return serialize_message(message)

    except ValueError as e:

        await db.rollback()

        raise HTTPException(
            status_code=400,
            detail=str(e),
        )


# ==========================================================
# DELETE FOR EVERYONE
# ==========================================================

@router.delete(
    "/{message_id}",
    status_code=204,
    dependencies=[
        rate_limit("messages.delete", 30, 60),
    ],
)
async def delete_for_everyone(
    message_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):

    message_repository = MessageRepository(db)
    conversation_repository = ConversationRepository(db)
    attachment_repository = AttachmentRepository(db)

    attachment_service = AttachmentService(
        attachment_repository
    )

    service = MessageService(
        message_repository,
        conversation_repository,
        attachment_service,
        DeviceRepository(db),
    )

    try:

        _, attachment_paths = await service.delete_for_everyone(
            current_user=current_user,
            message_id=message_id,
        )

        await db.commit()

    except ValueError as e:

        await db.rollback()

        raise HTTPException(
            status_code=400,
            detail=str(e),
        )

    # Attachment rows are gone: only the physical files remain.
    # Unlink AFTER the commit so a rolled-back delete keeps its
    # files (and a lost unlink leaves a file, not a broken row).
    for file_path, thumb_path in attachment_paths:

        for path in (file_path, thumb_path):

            if path:
                Path(path).unlink(missing_ok=True)


# ==========================================================
# DELETE FOR ME
# ==========================================================

@router.delete(
    "/{message_id}/me",
    status_code=204,
    dependencies=[
        rate_limit("messages.delete", 30, 60),
    ],
)
async def delete_for_me(
    message_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):

    message_repository = MessageRepository(db)
    conversation_repository = ConversationRepository(db)
    attachment_repository = AttachmentRepository(db)

    attachment_service = AttachmentService(
        attachment_repository
    )

    service = MessageService(
        message_repository,
        conversation_repository,
        attachment_service,
        DeviceRepository(db),
    )

    try:

        await service.delete_for_me(
            current_user=current_user,
            message_id=message_id,
        )

        await db.commit()

    except ValueError as e:

        await db.rollback()

        raise HTTPException(
            status_code=400,
            detail=str(e),
        )


# ==========================================================
# Server-side message search
# ==========================================================


@router.get("/search/{conversation_id}")
async def search_messages(
    conversation_id: UUID,
    q: str = "",
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    conversation_repo = ConversationRepository(db)
    if not await conversation_repo.is_participant(conversation_id, current_user.id):
        raise HTTPException(status_code=403, detail="Not a participant.")

    MessageRepository(db)

    stmt = (
        select(Message)
        .options(
            *_message_options()
        )
        .where(
            Message.conversation_id == conversation_id,
            Message.deleted_for_everyone.is_(False),
            or_(
                Message.ciphertext.ilike(f"%{q}%"),
                Message.message_type.ilike(f"%{q}%"),
            ),
        )
        .order_by(Message.created_at.desc())
        .limit(min(limit, 100))
    )

    result = await db.execute(stmt)
    messages = result.scalars().all()

    return {
        "results": [serialize_message(m) for m in messages],
        "count": len(messages),
    }


# ==========================================================
# Pin / Unpin message
# ==========================================================

@router.put("/{message_id}/pin")
async def pin_message(
    message_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    message_repo = MessageRepository(db)
    message = await message_repo.get_by_id(message_id)
    if not message:
        raise HTTPException(status_code=404, detail="Message not found.")

    conversation_repo = ConversationRepository(db)
    if not await conversation_repo.is_participant(message.conversation_id, current_user.id):
        raise HTTPException(status_code=403, detail="Not a participant.")

    message.is_pinned = True
    await db.commit()

    await manager.broadcast(
        message.conversation_id,
        {
            "event": "message_pinned",
            "message_id": str(message_id),
            "pinned": True,
        },
    )

    return {"success": True, "message": "Message pinned."}


@router.delete("/{message_id}/pin")
async def unpin_message(
    message_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    message_repo = MessageRepository(db)
    message = await message_repo.get_by_id(message_id)
    if not message:
        raise HTTPException(status_code=404, detail="Message not found.")

    conversation_repo = ConversationRepository(db)
    if not await conversation_repo.is_participant(message.conversation_id, current_user.id):
        raise HTTPException(status_code=403, detail="Not a participant.")

    message.is_pinned = False
    await db.commit()

    await manager.broadcast(
        message.conversation_id,
        {
            "event": "message_pinned",
            "message_id": str(message_id),
            "pinned": False,
        },
    )

    return {"success": True, "message": "Message unpinned."}


@router.get("/pinned/{conversation_id}")
async def get_pinned_messages(
    conversation_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    conversation_repo = ConversationRepository(db)
    if not await conversation_repo.is_participant(conversation_id, current_user.id):
        raise HTTPException(status_code=403, detail="Not a participant.")

    stmt = (
        select(Message)
        .options(
            *_message_options()
        )
        .where(
            Message.conversation_id == conversation_id,
            Message.is_pinned,
            Message.deleted_for_everyone.is_(False),
        )
        .order_by(Message.created_at.desc())
        .limit(50)
    )

    result = await db.execute(stmt)
    messages = result.scalars().all()

    return {
        "messages": [serialize_message(m) for m in messages],
        "count": len(messages),
    }


# ==========================================================
# Mark all messages as read in a conversation
# ==========================================================

@router.post("/read-all/{conversation_id}")
async def mark_all_read(
    conversation_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    conversation_repo = ConversationRepository(db)
    if not await conversation_repo.is_participant(conversation_id, current_user.id):
        raise HTTPException(status_code=403, detail="Not a participant.")

    message_repo = MessageRepository(db)
    await message_repo.mark_all_read(conversation_id, current_user.id)
    await db.commit()

    return {"success": True, "message": "All messages marked as read."}
