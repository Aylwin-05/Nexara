from uuid import uuid4

from app.database.base import Base
from sqlalchemy import (
    JSON,
    BigInteger,
    DateTime,
    ForeignKey,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import (
    Mapped,
    mapped_column,
    relationship,
)


class Attachment(Base):
    """
    Stores metadata for uploaded files.

    A single message may contain multiple attachments.

    Supported:
    - Images
    - Videos
    - Documents
    - Audio
    - Voice Notes
    - Archives

    Future:
    - Cloud Storage (AWS S3 / MinIO)
    - Encrypted Files
    - Image Compression
    - Video Compression
    - Thumbnail Generation
    """

    __tablename__ = "attachments"

    # ==========================================================
    # Identity
    # ==========================================================

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    # ==========================================================
    # Relationships
    # ==========================================================

    message_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "messages.id",
            ondelete="CASCADE",
        ),
        nullable=True,
    )

    # ==========================================================
    # File Information
    # ==========================================================

    original_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    filename: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        nullable=False,
    )

    mime_type: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    extension: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )

    attachment_type: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
    )

    size: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
    )

    storage_path: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
    )

    # ==========================================================
    # Encryption Metadata
    # ==========================================================

    encrypted: Mapped[bool] = mapped_column(
        default=False,
        nullable=False,
    )

    encrypted_key_sender: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
    )

    encrypted_key_receiver: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
    )

    nonce: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
    )

    # Per-device Signal envelopes wrapping the file's AES key
    # (mirrors message envelopes): one entry per recipient
    # device, so every device of the account can decrypt
    # received attachments. Legacy RSA fields above remain as
    # the fallback for the original device + own sends.
    wrapped_keys: Mapped[list | None] = mapped_column(
        JSON,
        nullable=True,
    )

    # Account-key copy of the decrypted file bytes (cross-browser
    # history): written by any device that successfully decrypts
    # the file, readable by every browser that unlocked the
    # account sync secret with the recovery code.
    sync_blob: Mapped[dict | None] = mapped_column(
        JSON,
        nullable=True,
    )

    # WhatsApp-style "view once" media: the recipient can open
    # the file exactly one time. When the recipient reports the
    # media as opened, the server deletes the file and this row,
    # so no copy survives on the backend.
    view_once: Mapped[bool] = mapped_column(
        default=False,
        nullable=False,
    )

    # View-once consumption tracker: set to True after the
    # recipient has successfully opened the file. When True,
    # subsequent downloads are rejected.
    view_once_consumed: Mapped[bool] = mapped_column(
        default=False,
        nullable=False,
    )

    # ==========================================================
    # Optional Media Metadata
    # ==========================================================

    thumbnail_path: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
    )

    width: Mapped[int | None] = mapped_column(
        nullable=True,
    )

    height: Mapped[int | None] = mapped_column(
        nullable=True,
    )

    duration: Mapped[float | None] = mapped_column(
        nullable=True,
    )

    # ==========================================================
    # Audit
    # ==========================================================

    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # ==========================================================
    # SQLAlchemy Relationships
    # ==========================================================

    message: Mapped["Message"] = relationship(  # noqa: F821 - SQLAlchemy forward ref
        "Message",
        backref="attachments",
    )

    # ==========================================================
    # Representation
    # ==========================================================

    def __repr__(self) -> str:
        return (
            f"<Attachment(id={self.id}, type={self.attachment_type}, filename='{self.filename}')>"
        )
