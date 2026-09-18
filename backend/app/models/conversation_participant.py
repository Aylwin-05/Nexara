from uuid import uuid4

from app.database.base import Base
from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column


class ConversationParticipant(Base):
    """
    Represents a participant in a conversation.

    A conversation can have:
    - 2 participants (private chat)
    - Many participants (group chat)
    """

    __tablename__ = "conversation_participants"

    __table_args__ = (
        UniqueConstraint(
            "conversation_id",
            "user_id",
            name="uq_conversation_user",
        ),
        Index("ix_conv_participant_user_id", "user_id"),
    )

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

    user_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "users.id",
            ondelete="CASCADE",
        ),
        nullable=False,
    )

    joined_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Admin rights in group chats (creator + promoted members).
    # Only admins can add members; the creator cannot be removed.
    is_admin: Mapped[bool] = mapped_column(
        Boolean(),
        default=False,
        server_default="false",
        nullable=False,
    )

    is_pinned: Mapped[bool] = mapped_column(
        Boolean(),
        default=False,
        server_default="false",
        nullable=False,
    )

    is_archived: Mapped[bool] = mapped_column(
        Boolean(),
        default=False,
        server_default="false",
        nullable=False,
    )

    muted_until: Mapped[DateTime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    wallpaper: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
        comment="Per-chat wallpaper URL or data URI.",
    )
