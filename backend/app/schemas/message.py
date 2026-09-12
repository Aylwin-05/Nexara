from datetime import datetime
from uuid import UUID

from app.schemas.attachment import AttachmentResponse
from pydantic import BaseModel, ConfigDict, Field

# ==========================================================
# SEND MESSAGE
# ==========================================================

class SendMessageRequest(BaseModel):
    """
    Encrypted message request.

    The backend never receives plaintext.
    """

    conversation_id: UUID

    # Client-generated key shared across retries of the SAME send
    # attempt: a retry replays the original message instead of
    # inserting a duplicate.
    client_message_id: str | None = Field(
        default=None,
        max_length=64,
    )

    ciphertext: str = Field(
        min_length=1,
        max_length=100000,
    )

    encrypted_key_sender: str = Field(
        min_length=1,
        max_length=1000,
    )

    encrypted_key_receiver: str = Field(
        min_length=1,
        max_length=1000,
    )

    nonce: str = Field(
        min_length=1,
        max_length=256,
    )

    message_type: str = Field(
        default="text",
        max_length=30,
    )

    reply_to_id: UUID | None = None

    is_forwarded: bool = False

    # Total times this chain has been forwarded; client increments
    # it when re-forwarding an already-forwarded message.
    forwarded_count: int = 0

    # NEW
    attachment_ids: list[UUID] = []

    # Per-recipient wrapped AES key copies (group chats).
    # One entry per member, keyed by public key at creation time.
    recipient_keys: list["RecipientKeyInput"] = []

    # Per-device Signal envelopes (multi-device E2EE).
    # One entry per device of every participant; a device can
    # only decrypt its own copy.
    envelopes: list["MessageEnvelopeInput"] = []


# ==========================================================
# PER-DEVICE ENVELOPE (multi-device E2EE)
# ==========================================================

class MessageEnvelopeInput(BaseModel):

    device_id: str = Field(
        min_length=8,
        max_length=64,
    )

    data: str = Field(
        min_length=1,
        max_length=100000,
    )


# ==========================================================
# PER-RECIPIENT MESSAGE KEY (group E2EE)
# ==========================================================

class RecipientKeyInput(BaseModel):

    user_id: UUID

    encrypted_key: str = Field(
        min_length=1,
        max_length=1000,
    )


# ==========================================================
# EDIT MESSAGE
# ==========================================================

class EditMessageRequest(BaseModel):
    """
    Edit an existing message.

    End-to-end encrypted: like a fresh send, the edited content
    is encrypted client-side and the server only receives the
    new ciphertext + wrapped keys. The server never sees the
    edited plaintext.
    """

    ciphertext: str = Field(
        min_length=1,
        max_length=100000,
    )

    encrypted_key_sender: str = Field(
        min_length=1,
        max_length=1000,
    )

    encrypted_key_receiver: str = Field(
        min_length=1,
        max_length=1000,
    )

    nonce: str = Field(
        min_length=1,
        max_length=256,
    )

    recipient_keys: list["RecipientKeyInput"] = []

    envelopes: list["MessageEnvelopeInput"] = []

    # Fresh account-key copy of the edited plaintext (replaces any
    # stale copy whose ciphertext no longer matches).
    sync_envelope: "SyncCopyInput | None" = None


# ==========================================================
# REACTION
# ==========================================================

class ReactionRequest(BaseModel):
    """
    Toggle an emoji reaction on a message.
    """

    emoji: str = Field(
        min_length=1,
        max_length=32,
    )


# ==========================================================
# STAR (per-user, personal)
# ==========================================================

class StarRequest(BaseModel):
    """
    Star or unstar a message for the current user.
    """

    starred: bool


class ReactionResponse(BaseModel):

    model_config = ConfigDict(
        from_attributes=True,
    )

    user_id: UUID

    emoji: str

    created_at: datetime


# ==========================================================
# PER-RECIPIENT KEY RESPONSE
# ==========================================================

class RecipientKeyResponse(BaseModel):

    user_id: UUID

    encrypted_key: str


# ==========================================================
# PER-DEVICE ENVELOPE RESPONSE
# ==========================================================

class MessageEnvelopeResponse(BaseModel):

    device_id: str

    data: str


# ==========================================================
# SYNC COPY (cross-browser history)
#
# Shared by messages (sync_envelope) and attachments
# (sync_blob): an account-key AES-256-GCM blob the server
# stores opaquely.
# ==========================================================

class SyncCopyInput(BaseModel):
    """
    Account-key AES-GCM copy of plaintext (messages) or raw file
    bytes (attachments). Only clients holding the account sync
    secret (recovered via the recovery code) can read it.
    `ciphertext` lets clients detect edited messages whose sync
    copy is stale.
    """

    nonce: str = Field(min_length=1, max_length=256)

    data: str = Field(min_length=1, max_length=100000)

    ciphertext: str | None = None


class SyncCopyUpsert(BaseModel):

    sync_copy: SyncCopyInput


# ==========================================================
# DELETE MESSAGE
# ==========================================================

class DeleteMessageRequest(BaseModel):
    """
    Delete message for everyone.
    """

    message_id: UUID


# ==========================================================
# MESSAGE RESPONSE
# ==========================================================

class MessageResponse(BaseModel):

    model_config = ConfigDict(
        from_attributes=True,
    )

    id: UUID

    conversation_id: UUID

    sender_id: UUID

    # ======================================================
    # Encrypted Payload
    # ======================================================

    ciphertext: str

    encrypted_key_sender: str
    encrypted_key_receiver: str

    nonce: str

    crypto_version: int

    # ======================================================
    # Metadata
    # ======================================================

    message_type: str

    reply_to_id: UUID | None

    edited: bool

    is_forwarded: bool

    forwarded_count: int = 0

    deleted_for_everyone: bool

    is_starred: bool = False

    is_read: bool

    delivered_at: datetime | None

    read_at: datetime | None

    expires_at: datetime | None

    view_once_opened: bool = False

    created_at: datetime

    updated_at: datetime

    attachments: list[AttachmentResponse] = []

    reactions: list[ReactionResponse] = []

    recipient_keys: list[RecipientKeyResponse] = []

    envelopes: list[MessageEnvelopeResponse] = []

    # Account-key copy of the plaintext: lets a browser that
    # registered later (and has no per-device envelope) read the
    # message after unlocking the account sync secret. Null for
    # messages nobody has decrypted since this feature shipped.
    sync_envelope: dict | None = None


# ==========================================================
# MESSAGE LIST
# ==========================================================

class MessageListResponse(BaseModel):

    messages: list[MessageResponse]
