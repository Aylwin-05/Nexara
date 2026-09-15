from uuid import uuid4

from app.database.base import Base
from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON


class Story(Base):
    """
    A 24-hour status update (WhatsApp-style story).

    Media is end-to-end encrypted: the client uploads ciphertext
    plus the wrapped AES key (`encrypted_key_sender` for the
    owner's own devices, `wrapped_keys` for each friend). The
    server stores the ciphertext file on disk and never sees
    the plaintext.
    """

    __tablename__ = "stories"

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    user_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "users.id",
            ondelete="CASCADE",
        ),
        nullable=False,
    )

    caption: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
    )

    storage_path: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
    )

    filename: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    mime_type: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    media_type: Mapped[str] = mapped_column(
        String(20),
        default="image",
        nullable=False,
    )

    encrypted: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
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

    wrapped_keys: Mapped[list | None] = mapped_column(
        JSON,
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

    expires_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )


class StoryView(Base):
    """
    One row per (story, viewer) pair — powers the viewer list.
    """

    __tablename__ = "story_views"

    __table_args__ = (UniqueConstraint("story_id", "user_id", name="uq_story_view"),)

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    story_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "stories.id",
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

    viewed_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
