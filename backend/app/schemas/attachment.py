from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

# ==========================================================
# Attachment Response
# ==========================================================


class AttachmentResponse(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
    )

    id: UUID

    message_id: UUID

    original_name: str

    filename: str

    mime_type: str

    extension: str

    attachment_type: str

    size: int

    storage_path: str

    encrypted: bool = False

    encrypted_key_sender: str | None = None

    encrypted_key_receiver: str | None = None

    nonce: str | None = None

    wrapped_keys: list | None = None

    # Account-key copy of the decrypted file bytes (cross-browser
    # history): opaque to the server, readable only by browsers
    # that unlocked the account sync secret with the recovery code.
    sync_blob: dict | None = None

    # WhatsApp-style "view once": media is deleted from the
    # server after the recipient opens it once.
    view_once: bool = False

    created_at: datetime

    updated_at: datetime | None = None


# ==========================================================
# Upload Response
# ==========================================================


class UploadResponse(BaseModel):
    success: bool

    message: str

    attachment: AttachmentResponse
