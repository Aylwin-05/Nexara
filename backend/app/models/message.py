from uuid import uuid4

from app.database.base import Base
from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    TypeDecorator,
    func,
)
from sqlalchemy import (
    text as sa_text,
)
from sqlalchemy.dialects.postgresql import (
    ARRAY,
    UUID,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON


class UUIDStringArray(TypeDecorator):
    """
    Stores a list of user UUIDs (as strings).

    PostgreSQL: native UUID[] column (uuid list, indexed-friendly).
    Other dialects (SQLite in tests): JSON fallback so the type
    still compiles. Values are normalized to list[str] on read.
    """

    cache_ok = True

    impl = JSON

    def load_dialect_impl(self, dialect):

        if dialect.name == "postgresql":
            return dialect.type_descriptor(ARRAY(UUID(as_uuid=True)))

        return dialect.type_descriptor(JSON())

    def process_bind_param(self, value, dialect):

        return value

    def process_result_value(self, value, dialect):

        if value is None:
            return value

        if dialect.name == "postgresql":
            return [str(item) for item in value]

        return value


class Message(Base):
    """
    End-to-End Encrypted Message

    Server NEVER stores plaintext.

    Stored:
        ciphertext
        encrypted AES key
        nonce

    Plaintext exists only on client devices.
    """

    __tablename__ = "messages"

    __table_args__ = (
        Index("ix_messages_conversation_id", "conversation_id"),
        Index("ix_messages_sender_id", "sender_id"),
        Index("ix_messages_expires_at", "expires_at"),
        Index("ix_messages_created_at", "created_at"),
        Index(
            "ix_messages_conv_created",
            "conversation_id",
            "created_at",
        ),
        Index(
            "uq_messages_client_dedupe",
            "conversation_id",
            "sender_id",
            "client_message_id",
            unique=True,
            sqlite_where=sa_text("client_message_id IS NOT NULL"),
            postgresql_where=sa_text("client_message_id IS NOT NULL"),
        ),
    )

    # ==========================================================
    # Identity
    # ==========================================================

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    conversation_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "conversations.id",
            ondelete="CASCADE",
        ),
        nullable=False,
    )

    sender_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "users.id",
            ondelete="CASCADE",
        ),
        nullable=False,
    )

    # ==========================================================
    # Encrypted Payload
    # ==========================================================

    ciphertext: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    encrypted_key_sender: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    encrypted_key_receiver: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    nonce: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    # ==========================================================
    # Multi-device envelopes
    #
    # One Signal envelope per device of every participant
    # ([{device_id, data}] JSON). A client decrypts only its own
    # copy; `ciphertext` above keeps the legacy single-envelope
    # payload for old clients and the pinned device.
    # ==========================================================

    envelopes: Mapped[list | None] = mapped_column(
        JSON,
        nullable=True,
    )

    # ==========================================================
    # Account sync copy (cross-browser history)
    #
    # Any device that decrypts this message stores an AES-256-GCM
    # copy of the plaintext wrapped by the account sync secret
    # ({"nonce": b64, "data": b64, "ciphertext": str}). A browser
    # that registers later — with no per-device envelope of its
    # own — can still read the message after unlocking the sync
    # secret with the recovery code. `ciphertext` lets clients
    # detect edited messages whose sync copy is stale.
    # ==========================================================

    sync_envelope: Mapped[dict | None] = mapped_column(
        JSON,
        nullable=True,
    )

    # ==========================================================
    # Metadata
    # ==========================================================

    message_type: Mapped[str] = mapped_column(
        String(30),
        default="text",
        nullable=False,
    )

    crypto_version: Mapped[int] = mapped_column(
        default=1,
        nullable=False,
    )

    client_message_id: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
    )

    reply_to_id: Mapped[UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "messages.id",
            ondelete="SET NULL",
        ),
        nullable=True,
    )

    edited: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )

    deleted_for_everyone: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )

    deleted_for: Mapped[list[str]] = mapped_column(
        UUIDStringArray,
        default=list,
        nullable=False,
    )

    is_read: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )

    is_forwarded: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )

    # How many times the message has been forwarded in total
    # (WhatsApp-style: 1 = "Forwarded", 5+ = "Forwarded many times").
    forwarded_count: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
    )

    delivered_at: Mapped[DateTime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    read_at: Mapped[DateTime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Disappearing messages: absolute time the server erases this
    # ciphertext (None = message persists).
    expires_at: Mapped[DateTime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # View-once media has been opened by the recipient: the
    # server has already deleted the attachment file + rows.
    view_once_opened: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )

    is_pinned: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )

    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
