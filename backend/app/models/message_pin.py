from uuid import uuid4

from app.database.base import Base
from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship


class MessagePin(Base):
    """
    Per-user pinned message.

    Pinning is personal (WhatsApp/Telegram-style): only the user who
    pinned a message sees it as pinned. Replaces the old global
    messages.is_pinned bool, which made one participant's pin appear
    for everyone in the conversation.
    """

    __tablename__ = "message_pins"

    __table_args__ = (
        UniqueConstraint(
            "message_id",
            "user_id",
            name="uq_message_pin_user",
        ),
        Index("ix_message_pin_message_id", "message_id"),
    )

    # ==========================================================
    # Identity
    # ==========================================================

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
        backref="pins",
    )
