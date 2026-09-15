from datetime import datetime
from enum import Enum as PyEnum
from uuid import uuid4

from app.database.base import Base
from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship


class DevicePlatform(PyEnum):
    IOS = "ios"
    ANDROID = "android"
    WEB = "web"
    DESKTOP = "desktop"
    OTHER = "other"


class Device(Base):
    """
    Represents a user's device with independent Signal Protocol identity.

    Each device has its own:
    - Identity Key Pair (Ed25519) - long-term, used for X3DH
    - Signed PreKey Pair (X25519) - medium-term, signed by identity key
    - One-Time PreKeys (X25519) - ephemeral, consumed on session init
    """

    __tablename__ = "devices"

    __table_args__ = (
        Index("ix_devices_user_id", "user_id"),
        Index("ix_devices_device_id", "device_id"),
        Index(
            "ix_devices_user_primary",
            "user_id",
            "is_primary",
            unique=True,
            postgresql_where="is_primary = true",
        ),
    )

    # ==========================================================
    # Identity
    # ==========================================================

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    device_id: Mapped[str] = mapped_column(
        String(64),
        unique=True,
        nullable=False,
        comment="Client-generated device identifier (e.g., UUID v4)",
    )

    # ==========================================================
    # Owner
    # ==========================================================

    user_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # ==========================================================
    # Device Info
    # ==========================================================

    platform: Mapped[str] = mapped_column(
        Enum(
            DevicePlatform,
            native_enum=False,
            values_callable=lambda cls: [m.value for m in cls],
        ),
        default=DevicePlatform.OTHER.value,
        nullable=False,
    )

    platform_version: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
    )

    app_version: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
    )

    device_name: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
        comment="User-friendly name (e.g., 'John's iPhone')",
    )

    push_token: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
        comment="FCM/APNs/Web Push token for notifications",
    )

    # ==========================================================
    # Status
    # ==========================================================

    is_primary: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        comment="Primary device receives all messages first, manages linking",
    )

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )

    last_seen: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    last_ip: Mapped[str | None] = mapped_column(
        String(45),
        nullable=True,
    )

    # ==========================================================
    # Identity Key (Ed25519) - Long-term
    # ==========================================================

    identity_key_public: Mapped[str] = mapped_column(
        String,
        nullable=False,
        comment="Ed25519 public key (base64), 32 bytes raw",
    )

    identity_key_x25519: Mapped[str] = mapped_column(
        String,
        nullable=False,
        comment="X25519 public key derived from identity key (base64), 32 bytes raw",
    )

    # Private key columns are NOT stored on the server.
    # The client holds all private key material in IndexedDB.
    # These columns are kept for reference only if a migration
    # ever adds them; a future migration will drop them.

    # ==========================================================
    # Registration
    # ==========================================================

    registered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    unregistered_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # ==========================================================
    # Relationships
    # ==========================================================

    user = relationship(
        "User",
        back_populates="devices",
    )

    signed_prekeys = relationship(
        "SignedPreKey",
        back_populates="device",
        cascade="all, delete-orphan",
        lazy="dynamic",
    )

    one_time_prekeys = relationship(
        "OneTimePreKey",
        back_populates="device",
        cascade="all, delete-orphan",
        lazy="dynamic",
        foreign_keys="OneTimePreKey.device_id",
    )

    sessions = relationship(
        "SignalSession",
        back_populates="device",
        cascade="all, delete-orphan",
        lazy="dynamic",
        foreign_keys="SignalSession.device_id",
    )

    def __repr__(self) -> str:
        return f"<Device(id={self.id}, device_id='{self.device_id}', user_id={self.user_id}, primary={self.is_primary})>"


class SignedPreKey(Base):
    """
    Medium-term X25519 prekey signed by the device's identity key.

    Used in X3DH to provide forward secrecy for the initial key agreement.
    Rotated periodically (e.g., weekly).
    """

    __tablename__ = "signed_prekeys"

    __table_args__ = (
        UniqueConstraint("device_id", "key_id", name="uq_signed_prekey_device_key"),
        Index("ix_signed_prekeys_device_id", "device_id"),
    )

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    device_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=False,
    )

    key_id: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="Monotonically increasing key ID",
    )

    public_key: Mapped[str] = mapped_column(
        String,
        nullable=False,
        comment="X25519 public key (base64), 32 bytes raw",
    )

    signature: Mapped[str] = mapped_column(
        String,
        nullable=False,
        comment="Ed25519 signature of public_key by device identity key (base64), 64 bytes",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="When this prekey should be rotated",
    )

    # ==========================================================
    # Relationships
    # ==========================================================

    device = relationship(
        "Device",
        back_populates="signed_prekeys",
    )

    def __repr__(self) -> str:
        return f"<SignedPreKey(device_id={self.device_id}, key_id={self.key_id})>"


class OneTimePreKey(Base):
    """
    Ephemeral X25519 prekey, consumed once during X3DH session initialization.

    Provides additional forward secrecy. Should be replenished regularly.
    """

    __tablename__ = "one_time_prekeys"

    __table_args__ = (
        UniqueConstraint("device_id", "key_id", name="uq_otpk_device_key"),
        Index("ix_otpks_device_id", "device_id"),
        Index("ix_otpks_device_consumed", "device_id", "consumed"),
    )

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    device_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=False,
    )

    key_id: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="Monotonically increasing key ID",
    )

    public_key: Mapped[str] = mapped_column(
        String,
        nullable=False,
        comment="X25519 public key (base64), 32 bytes raw",
    )

    consumed: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )

    consumed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    consumed_by_device_id: Mapped[UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="SET NULL"),
        nullable=True,
        comment="Device that consumed this prekey (initiator of session)",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # ==========================================================
    # Relationships
    # ==========================================================

    device = relationship(
        "Device",
        back_populates="one_time_prekeys",
        foreign_keys=[device_id],
    )

    def __repr__(self) -> str:
        return f"<OneTimePreKey(device_id={self.device_id}, key_id={self.key_id}, consumed={self.consumed})>"


# ==========================================================
# Device Trust (TOFU)
# ==========================================================


class DeviceTrustLevel(PyEnum):
    unknown = "unknown"
    trusted = "trusted"
    verified = "verified"


class DeviceTrust(Base):
    """
    Trust-on-first-use (TOFU) record for a remote device.

    When a user first sees a peer's device, the trust level is
    ``unknown``.  After the user confirms the device (e.g. by
    scanning a safety-number QR code), the level moves to
    ``trusted`` or ``verified``.  If the device's identity key
    changes the record can be reset to ``unknown`` so the user
    is warned.
    """

    __tablename__ = "device_trust"

    __table_args__ = (
        UniqueConstraint(
            "owner_id",
            "device_id",
            name="uq_device_trust_owner_device",
        ),
        Index("ix_device_trust_owner", "owner_id"),
    )

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    owner_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        comment="The user who owns this trust record",
    )

    device_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=False,
        comment="The remote device being trusted",
    )

    trust_level: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=DeviceTrustLevel.unknown.value,
        comment="unknown | trusted | verified",
    )

    identity_key_fingerprint: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        comment="SHA-256 of the device identity key at trust time",
    )

    trusted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="When trust was established",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
