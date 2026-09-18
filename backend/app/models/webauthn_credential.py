import uuid
from datetime import datetime

from app.database.base import Base
from app.database.mixins import TimestampMixin
from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column


class WebauthnCredential(Base, TimestampMixin):
    __tablename__ = "webauthn_credentials"

    __table_args__ = (
        Index("ix_webauthn_user_id", "user_id"),
        Index("ix_webauthn_credential_id", "credential_id", unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        primary_key=True,
        default=uuid.uuid4,
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    credential_id: Mapped[str] = mapped_column(
        String(512),
        nullable=False,
        comment="Base64url-encoded credential ID.",
    )

    public_key: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        comment="JSON-encoded public key and algorithm info.",
    )

    sign_count: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
        comment="Last known signature counter for replay protection.",
    )

    device_name: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
        comment="User-assigned label (e.g. 'YubiKey 5').",
    )

    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="Timestamp of last successful assertion.",
    )

    def __repr__(self) -> str:
        return (
            f"<WebauthnCredential(id={self.id}, "
            f"user_id={self.user_id}, "
            f"device_name='{self.device_name}')>"
        )
