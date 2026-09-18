from uuid import uuid4

from app.database.base import Base
from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship


class MessageReaction(Base):
    """
    Emoji reaction on a message.

    One reaction per user per message (WhatsApp-style): a new
    emoji replaces the previous one, and toggling the same
    emoji removes it. Emojis are not secret — every participant
    of the conversation can read them.
    """

    __tablename__ = "message_reactions"

    __table_args__ = (
        UniqueConstraint(
            "message_id",
            "user_id",
            name="uq_message_reaction_user",
        ),
        Index("ix_message_reaction_message_id", "message_id"),
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

    emoji: Mapped[str] = mapped_column(
        String(32),
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
        backref="reactions",
    )
