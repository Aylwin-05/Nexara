from uuid import uuid4

from app.database.base import Base
from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column


class Conversation(Base):
    """
    Represents a chat conversation.

    - private: exactly two participants
    - group: many participants, shared by all members
    """

    __tablename__ = "conversations"

    __table_args__ = (
        UniqueConstraint(
            "conversation_key",
            name="uq_conversation_key",
        ),
    )

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    # Deterministic key for exactly-two-participant (private)
    # conversations: "min_user_id:max_user_id". NULL for groups.
    # A unique index here prevents two users racing to create a
    # private conversation from ever forming duplicate chats.
    conversation_key: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
    )

    name: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )

    conversation_type: Mapped[str] = mapped_column(
        String(20),
        default="private",
        nullable=False,
    )

    avatar_url: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
    )

    description: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
    )

    created_by: Mapped[UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "users.id",
            ondelete="SET NULL",
        ),
        nullable=True,
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

    # Disappearing messages: seconds after send before the
    # server erases the ciphertext (None = disabled).
    disappear_after_seconds: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    # Two-party conversation deletion: the user who pressed
    # "delete chat" first, and when. Nothing is erased until
    # the OTHER participant confirms (both must consent).
    # Idempotent/self-request handling lives in the service.
    delete_requested_by: Mapped[UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "users.id",
            ondelete="SET NULL",
        ),
        nullable=True,
    )

    delete_requested_at: Mapped[DateTime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
