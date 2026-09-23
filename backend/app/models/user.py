import uuid
from datetime import datetime

from app.core.enums import OnlineStatus
from app.database.base import Base
from app.database.mixins import TimestampMixin
from sqlalchemy import (
    Boolean,
    DateTime,
    Index,
    Integer,
    String,
    Text,
    Uuid,
)
from sqlalchemy.orm import (
    Mapped,
    mapped_column,
    relationship,
)
from sqlalchemy.types import JSON


class User(Base, TimestampMixin):
    """
    Primary user model for Nexara.
    """

    __tablename__ = "users"

    __table_args__ = (
        Index("ix_users_email", "email"),
        Index("ix_users_username", "username"),
    )

    # ==========================================================
    # Identity
    # ==========================================================

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        primary_key=True,
        default=uuid.uuid4,
        comment="Primary UUID identifier.",
    )

    # ==========================================================
    # Authentication
    # ==========================================================

    email: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        nullable=False,
        comment="User email used for OTP authentication.",
    )

    username: Mapped[str] = mapped_column(
        String(50),
        unique=True,
        nullable=False,
        comment="Unique public username.",
    )

    display_name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        comment="User display name.",
    )

    # ==========================================================
    # Profile
    # ==========================================================

    bio: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Optional user biography.",
    )

    avatar_url: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
        comment="Profile picture URL.",
    )

    # ==========================================================
    # Account Status
    # ==========================================================

    is_verified: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        comment="Email verification status.",
    )

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        comment="Whether the account is active.",
    )

    # Bumped on logout / deactivation / deletion. The value is
    # embedded in issued access tokens ("ver" claim), so bumping
    # invalidates every previously issued access token instantly
    # instead of leaving it valid until expiry.
    session_version: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
        server_default="0",
        comment="Session generation; access tokens must match it.",
    )

    online_status: Mapped[str] = mapped_column(
        String(20),
        default=OnlineStatus.OFFLINE.value,
        nullable=False,
        comment="Current user presence status.",
    )

    presence_animal: Mapped[str] = mapped_column(
        String(32),
        default="default",
        nullable=False,
        server_default="default",
        comment="Animated pet shown as the in-chat presence indicator (default | cat | dog | owl | rabbit).",
    )

    last_seen: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="Last active timestamp.",
    )

    # ==========================================================
    # Legal consent at registration
    #
    # Timestamps set ONLY when a brand-new account is created via
    # verify-otp (both must be accepted). Existing accounts never
    # re-consent, so these stay NULL for them.
    # ==========================================================

    privacy_consent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="When the Privacy Policy was accepted at registration.",
    )

    terms_consent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="When the Terms of Service were accepted at registration.",
    )

    # ==========================================================
    # Two-step verification (2FA PIN)
    #
    # A 6-digit PIN the user sets in Settings. When enabled, a
    # successful email OTP login does NOT issue tokens: the
    # client must first present the PIN (which travels through a
    # short-lived two_fa JWT issued at OTP time). Only the
    # scrypt hash is stored — never the PIN itself.
    # ==========================================================

    two_fa_enabled: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )

    # Format: "scrypt$<salt_hex>$<hash_hex>".
    two_fa_secret: Mapped[str | None] = mapped_column(
        String(512),
        nullable=True,
    )

    # ==========================================================
    # Account recovery code (cross-browser history sync)
    #
    # The recovery code is shown once (and emailed) when the
    # account's first recovery key is created. The account sync
    # secret it unlocks is NEVER stored server-side: only the
    # code-wrapped AES-GCM blob survives, so a stolen database
    # cannot decrypt the per-message sync copies without the code.
    # ==========================================================

    recovery_salt: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        comment="PBKDF2 salt (hex) for the recovery-code wrap.",
    )

    recovery_wrapped_key: Mapped[dict | None] = mapped_column(
        JSON,
        nullable=True,
        comment="JSON blob: AES-256-GCM(account sync secret, code-derived key).",
    )

    # ==========================================================
    # Relationships
    # ==========================================================

    key = relationship(
        "UserKey",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
    )

    devices = relationship(
        "Device",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="dynamic",
    )

    # ==========================================================
    # Representation
    # ==========================================================

    def __repr__(self) -> str:
        return f"<User(id={self.id}, username='{self.username}', email='{self.email}')>"
