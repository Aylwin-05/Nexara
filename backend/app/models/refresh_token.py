import uuid
from datetime import datetime

from app.database.base import Base
from app.database.mixins import TimestampMixin
from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    String,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column


class RefreshToken(Base, TimestampMixin):
    """
    Server-side record for a refresh-token family.

    Every issued refresh token has a unique `jti` and is stored
    here (SHA-256 of the token) so it can be:
      - rotated on every use (old token revoked, new one issued)
      - revoked on logout (whole family)
      - detected on reuse (family gets revoked)
    """

    __tablename__ = "refresh_tokens"

    __table_args__ = (
        Index("ix_refresh_tokens_user", "user_id"),
        Index("ix_refresh_tokens_family", "family_id"),
        Index("ix_refresh_tokens_expires", "expires_at"),
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
        comment="Owner of the refresh token.",
    )

    jti: Mapped[str] = mapped_column(
        String(64),
        unique=True,
        nullable=False,
        comment="Unique JWT ID claim for this token.",
    )

    token_hash: Mapped[str] = mapped_column(
        String(64),
        unique=True,
        nullable=False,
        comment="SHA-256 hex digest of the token itself.",
    )

    family_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        default=uuid.uuid4,
        nullable=False,
        comment="All rotated tokens of one session share this id.",
    )

    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        comment="When the token stops being valid.",
    )

    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="Set when the token is rotated or logged out.",
    )

    replaced_by_jti: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        comment="jti of the successor token (rotation chain).",
    )

    predecessor_jti: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        comment="jti this token replaced (survives pruning of the old row).",
    )

    user_agent: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    ip_address: Mapped[str | None] = mapped_column(
        String(45),
        nullable=True,
    )

    def __repr__(self) -> str:
        return (
            f"<RefreshToken(user_id={self.user_id}, "
            f"jti='{self.jti}', revoked={self.revoked_at is not None})>"
        )
