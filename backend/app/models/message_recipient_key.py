from uuid import uuid4

from app.database.base import Base
from sqlalchemy import DateTime, ForeignKey, Index, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship


class MessageRecipientKey(Base):
    """
    Per-recipient wrapped message key (group chat E2EE).

    Group messages are encrypted with a fresh AES-256-GCM key
    that is wrapped to EVERY member's public key. This row
    stores one wrapped copy per recipient; the server stores
    ciphertext + wrapped keys only, never plaintext.
    """

    __tablename__ = "message_recipient_keys"

    __table_args__ = (
        UniqueConstraint(
            "message_id",
            "user_id",
            name="uq_message_recipient_key",
        ),
        Index(
            "ix_message_recipient_key_message_id",
            "message_id",
        ),
    )

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    message_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "messages.id",
            ondelete="CASCADE",
        ),
        nullable=False,
    )

    user_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "users.id",
            ondelete="CASCADE",
        ),
        nullable=False,
    )

    encrypted_key: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    message: Mapped["Message"] = relationship(  # noqa: F821 - SQLAlchemy forward ref
        backref="recipient_keys",
    )
