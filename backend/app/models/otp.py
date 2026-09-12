import uuid
from datetime import datetime

from app.database.base import Base
from app.database.mixins import TimestampMixin
from sqlalchemy import (
    Boolean,
    DateTime,
    Index,
    Integer,
    String,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column


class OTPCode(Base, TimestampMixin):
    """
    Stores hashed OTPs used for email authentication.
    """

    __tablename__ = "otp_codes"

    __table_args__ = (
        Index("ix_otp_email_expires", "email", "expires_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        primary_key=True,
        default=uuid.uuid4,
    )

    email: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
        comment="Email address receiving the OTP.",
    )

    otp_hash: Mapped[str] = mapped_column(
        String(512),
        nullable=False,
        comment="scrypt hash of the OTP.",
    )

    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        comment="OTP expiration timestamp.",
    )

    attempts: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
        comment="Number of failed verification attempts.",
    )

    is_used: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        comment="Whether this OTP has already been used.",
    )

    def __repr__(self) -> str:
        return (
            f"<OTPCode(email='{self.email}', "
            f"expires_at='{self.expires_at}', "
            f"is_used={self.is_used})>"
        )
