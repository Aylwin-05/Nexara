import json
import logging
import shutil
from pathlib import Path
from uuid import UUID

from app.database.session import get_db
from app.dependencies.auth import get_current_user
from app.dependencies.rate_limit import rate_limit
from app.models.user import User
from app.repositories.attachment_repository import AttachmentRepository
from app.repositories.conversation_repository import (
    ConversationRepository,
)
from app.repositories.message_repository import (
    MessageRepository,
)
from app.schemas.attachment import (
    AttachmentResponse,
    UploadResponse,
)
from app.schemas.message import SyncCopyUpsert
from app.services.attachment_service import AttachmentService
from app.websocket.connection_manager import manager
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
)
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/attachments",
    tags=["Attachments"],
)


# ==========================================================
# Upload Attachment
# ==========================================================


@router.post(
    "/upload/{message_id}",
    response_model=UploadResponse,
    dependencies=[
        rate_limit("attachments.upload", 10, 60),
    ],
)
async def upload_attachment(
    message_id: UUID,
    file: UploadFile = File(...),
    encrypted: bool = Form(False),
    encrypted_key_sender: str | None = Form(None),
    encrypted_key_receiver: str | None = Form(None),
    nonce: str | None = Form(None),
    wrapped_keys: str | None = Form(None),
    view_once: bool = Form(False),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):

    attachment_repository = AttachmentRepository(db)

    message_repository = MessageRepository(db)

    conversation_repository = ConversationRepository(db)

    attachment_service = AttachmentService(
        attachment_repository,
    )

    message = await message_repository.get_by_id(message_id)

    if message is None:
        raise HTTPException(
            status_code=404,
            detail="Message not found.",
        )

    participants = await conversation_repository.get_participants(message.conversation_id)

    allowed = any(participant.user_id == current_user.id for participant in participants)

    if not allowed:
        raise HTTPException(
            status_code=403,
            detail="You are not a member of this conversation.",
        )

    if encrypted:
        if not encrypted_key_sender:
            raise HTTPException(
                status_code=400,
                detail="Missing sender encrypted key.",
            )

        if not encrypted_key_receiver:
            raise HTTPException(
                status_code=400,
                detail="Missing receiver encrypted key.",
            )

        if not nonce:
            raise HTTPException(
                status_code=400,
                detail="Missing encryption nonce.",
            )
    try:
        parsed_wrapped_keys = json.loads(wrapped_keys) if wrapped_keys else None

        attachment = await attachment_service.upload_attachment(
            message.id,
            file,
            encrypted=encrypted,
            encrypted_key_sender=encrypted_key_sender,
            encrypted_key_receiver=encrypted_key_receiver,
            nonce=nonce,
            wrapped_keys=parsed_wrapped_keys,
            view_once=view_once,
        )

    except Exception:
        logger.exception("Attachment upload failed")
        raise

    await db.commit()

    await db.refresh(attachment)

    # ==========================================================
    # Broadcast Attachment
    # ==========================================================

    await manager.broadcast(
        message.conversation_id,
        {
            "event": "attachment",
            "message_id": str(message.id),
            "conversation_id": str(message.conversation_id),
            "sender_id": str(current_user.id),
            "attachment": {
                "id": str(attachment.id),
                "original_name": attachment.original_name,
                "filename": attachment.filename,
                "attachment_type": attachment.attachment_type,
                "mime_type": attachment.mime_type,
                "extension": attachment.extension,
                "view_once": attachment.view_once,
                "size": attachment.size,
                "encrypted": attachment.encrypted,
                "encrypted_key_sender": attachment.encrypted_key_sender,
                "encrypted_key_receiver": attachment.encrypted_key_receiver,
                "nonce": attachment.nonce,
                "wrapped_keys": attachment.wrapped_keys or [],
                "sync_blob": attachment.sync_blob,
                "download_url": f"/api/v1/attachments/{attachment.id}",
                "created_at": attachment.created_at.isoformat(),
            },
        },
    )

    return {
        "success": True,
        "message": "Attachment uploaded successfully.",
        "attachment": attachment,
    }


# ==========================================================
# Upload Thumbnail (client-side generated, uploaded separately)
#
# Thumbnails are generated client-side before E2EE so the
# server never sees plaintext. This endpoint stores the
# small, low-quality JPEG alongside the encrypted file.
# ==========================================================


@router.post(
    "/{attachment_id}/thumbnail",
    dependencies=[rate_limit("attachments.thumbnail", 20, 60)],
)
async def upload_thumbnail(
    attachment_id: UUID,
    thumbnail: UploadFile = File(...),
    width: int | None = Form(None),
    height: int | None = Form(None),
    duration: float | None = Form(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    attachment_repository = AttachmentRepository(db)
    message_repository = MessageRepository(db)
    conversation_repository = ConversationRepository(db)

    attachment = await attachment_repository.get_by_id(attachment_id)
    if attachment is None:
        raise HTTPException(status_code=404, detail="Attachment not found.")

    message = await message_repository.get_by_id(attachment.message_id)
    if message is None:
        raise HTTPException(status_code=404, detail="Message not found.")

    participants = await conversation_repository.get_participants(message.conversation_id)
    if not any(p.user_id == current_user.id for p in participants):
        raise HTTPException(status_code=403, detail="Access denied.")

    thumb_dir = Path(attachment.storage_path).parent / "thumbnails"
    thumb_dir.mkdir(parents=True, exist_ok=True)
    thumb_filename = f"thumb_{attachment_id.hex}.jpg"
    thumb_path = thumb_dir / thumb_filename

    with thumb_path.open("wb") as buf:
        shutil.copyfileobj(thumbnail.file, buf)

    attachment.thumbnail_path = str(thumb_path)
    if width is not None:
        attachment.width = width
    if height is not None:
        attachment.height = height
    if duration is not None:
        attachment.duration = duration

    await db.commit()

    return {"success": True, "thumbnail_url": f"/api/v1/attachments/{attachment_id}/thumbnail"}


# ==========================================================
# Get Thumbnail
# ==========================================================


@router.get(
    "/{attachment_id}/thumbnail",
    dependencies=[rate_limit("attachments.thumbnail", 60, 60)],
)
async def get_thumbnail(
    attachment_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    attachment_repository = AttachmentRepository(db)
    attachment = await attachment_repository.get_by_id(attachment_id)
    if attachment is None or not attachment.thumbnail_path:
        raise HTTPException(status_code=404, detail="Thumbnail not found.")

    message = await MessageRepository(db).get_by_id(attachment.message_id)
    if message is None:
        raise HTTPException(status_code=404, detail="Thumbnail not found.")

    participants = await ConversationRepository(db).get_participants(message.conversation_id)
    allowed = any(participant.user_id == current_user.id for participant in participants)
    if not allowed:
        raise HTTPException(
            status_code=403,
            detail="Access denied.",
        )

    thumb_path = Path(attachment.thumbnail_path)
    if not thumb_path.exists():
        raise HTTPException(status_code=404, detail="Thumbnail file not found.")

    return FileResponse(
        path=thumb_path,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )


# ==========================================================
# Download Attachment
# ==========================================================


@router.get(
    "/{attachment_id}",
    dependencies=[rate_limit("attachments.download", 60, 60)],
)
async def download_attachment(
    attachment_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):

    attachment_repository = AttachmentRepository(db)

    message_repository = MessageRepository(db)

    conversation_repository = ConversationRepository(db)

    attachment_service = AttachmentService(
        attachment_repository,
    )

    attachment = await attachment_service.get_attachment(attachment_id)

    if attachment is None:
        raise HTTPException(
            status_code=404,
            detail="Attachment not found.",
        )

    message = await message_repository.get_by_id(attachment.message_id)

    if message is None:
        raise HTTPException(
            status_code=404,
            detail="Message not found.",
        )

    participants = await conversation_repository.get_participants(message.conversation_id)

    allowed = any(participant.user_id == current_user.id for participant in participants)

    if not allowed:
        raise HTTPException(
            status_code=403,
            detail="Access denied.",
        )

    # View-once media stays downloadable until the RECIPIENT
    # reports it opened (POST /messages/{id}/view-once-opened),
    # which deletes the file server-side. Consuming on first GET
    # here would break the sender's preview after a refresh and
    # pre-destroy the media before the recipient taps.

    file_path = Path(attachment.storage_path)

    if not file_path.exists():
        raise HTTPException(
            status_code=404,
            detail="Attachment file not found.",
        )

    safe_name = (
        "".join(
            c for c in (attachment.original_name or "file") if c.isprintable() and c not in "\r\n"
        )
        or "file"
    )

    return FileResponse(
        path=file_path,
        filename=safe_name,
        media_type=attachment.mime_type,
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )


# ==========================================================
# Upsert Sync Blob (cross-browser history)
#
# Any device that successfully decrypts a file stores an
# account-key copy of the raw bytes here, so browsers that
# register later can read it after unlocking the sync secret.
# ==========================================================


@router.put(
    "/{attachment_id}/sync-blob",
    response_model=AttachmentResponse,
    dependencies=[
        rate_limit("attachments.sync", 300, 60),
    ],
)
async def upsert_sync_blob(
    attachment_id: UUID,
    request: SyncCopyUpsert,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):

    attachment_repository = AttachmentRepository(db)
    message_repository = MessageRepository(db)
    conversation_repository = ConversationRepository(db)

    attachment_service = AttachmentService(
        attachment_repository,
    )

    attachment = await attachment_service.get_attachment(attachment_id)

    if attachment is None:
        raise HTTPException(
            status_code=404,
            detail="Attachment not found.",
        )

    message = await message_repository.get_by_id(attachment.message_id)

    if message is None:
        raise HTTPException(
            status_code=404,
            detail="Message not found.",
        )

    participants = await conversation_repository.get_participants(message.conversation_id)

    allowed = any(participant.user_id == current_user.id for participant in participants)

    if not allowed:
        raise HTTPException(
            status_code=403,
            detail="Access denied.",
        )

    attachment.sync_blob = {
        "nonce": request.sync_copy.nonce,
        "data": request.sync_copy.data,
    }

    await db.commit()

    await db.refresh(attachment)

    return attachment


# ==========================================================
# Delete Attachment
# ==========================================================


@router.delete(
    "/{attachment_id}",
    dependencies=[rate_limit("attachments.delete", 30, 60)],
)
async def delete_attachment(
    attachment_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):

    attachment_repository = AttachmentRepository(db)

    message_repository = MessageRepository(db)

    conversation_repository = ConversationRepository(db)

    attachment_service = AttachmentService(
        attachment_repository,
    )

    attachment = await attachment_service.get_attachment(attachment_id)

    if attachment is None:
        raise HTTPException(
            status_code=404,
            detail="Attachment not found.",
        )

    message = await message_repository.get_by_id(attachment.message_id)

    if message is None:
        raise HTTPException(
            status_code=404,
            detail="Message not found.",
        )

    participants = await conversation_repository.get_participants(message.conversation_id)

    allowed = any(participant.user_id == current_user.id for participant in participants)

    if not allowed:
        raise HTTPException(
            status_code=403,
            detail="Access denied.",
        )

    # Delete-for-everyone requires ownership (WhatsApp-style group
    # moderation: a group admin may delete any member's attachment).
    if message.sender_id != current_user.id:
        conversation = await conversation_repository.get_by_id(message.conversation_id)

        participant = await conversation_repository.get_participant(
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
            raise HTTPException(
                status_code=403,
                detail="Only the sender or a group admin can delete this attachment.",
            )

    deleted = await attachment_service.delete_attachment(attachment_id)

    if not deleted:
        raise HTTPException(
            status_code=404,
            detail="Attachment not found.",
        )
    await db.commit()
    # ==========================================================
    # Broadcast Delete
    # ==========================================================

    await manager.broadcast(
        message.conversation_id,
        {
            "event": "attachment_deleted",
            "attachment_id": str(attachment.id),
            "message_id": str(message.id),
        },
    )

    return {
        "success": True,
        "message": "Attachment deleted successfully.",
    }
