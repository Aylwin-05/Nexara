from datetime import datetime
from uuid import uuid4

from app.database.base import Base
from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

PRIVACY_LEVELS = ("everyone", "my_contacts", "nobody")


class UserPrivacySetting(Base):
    """
    Per-user privacy preferences (WhatsApp-style).

    - last_seen: who may see my online status
    - profile_photo: who may view my avatar
    - story: who may see my 24h status updates
    """

    __tablename__ = "user_privacy_settings"

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
        unique=True,
    )

    last_seen: Mapped[str] = mapped_column(
        String(20),
        default="everyone",
        nullable=False,
    )

    profile_photo: Mapped[str] = mapped_column(
        String(20),
        default="everyone",
        nullable=False,
    )

    story: Mapped[str] = mapped_column(
        String(20),
        default="my_contacts",
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
