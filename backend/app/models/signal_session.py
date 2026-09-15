from datetime import datetime
from enum import Enum as PyEnum
from uuid import uuid4

from app.database.base import Base
from sqlalchemy import (
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship


class SessionState(PyEnum):
    ACTIVE = "active"
    ARCHIVED = "archived"
    COMPROMISED = "compromised"


class SignalSession(Base):
    """
    Stores the Double Ratchet state for a Signal Protocol session.

    Each session is between two devices (Alice's device <-> Bob's device).
    The session state includes:
    - Root chain key (for deriving chain keys)
    - Sending chain (message number, chain key)
    - Receiving chain (message number, chain key)
    - DH ratchet state (our DH key pair, their DH public key)
    - Associated data (identities, for authentication)

    Sessions are per-device-pair per-conversation.
    """

    __tablename__ = "signal_sessions"

    __table_args__ = (
        UniqueConstraint(
            "device_id",
            "remote_device_id",
            "conversation_id",
            name="uq_session_device_remote_conversation",
        ),
        Index("ix_sessions_device_id", "device_id"),
        Index("ix_sessions_remote_device_id", "remote_device_id"),
        Index("ix_sessions_conversation_id", "conversation_id"),
        Index("ix_sessions_state", "state"),
    )

    # ==========================================================
    # Identity
    # ==========================================================

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    # ==========================================================
    # Participants
    # ==========================================================

    device_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=False,
        comment="Our device (the one storing this session)",
    )

    remote_device_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=False,
        comment="Remote device we have a session with",
    )

    conversation_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # ==========================================================
    # X3DH Initialization
    # ==========================================================

    # Our identity key (Ed25519) - already in Device model
    # Their identity key (Ed25519) - for verification
    remote_identity_key: Mapped[str] = mapped_column(
        String,
        nullable=False,
        comment="Remote device's Ed25519 identity public key (base64)",
    )

    # Our ephemeral X25519 key used in X3DH (ephemeral private key)
    # This is only needed if we initiated; if we received, it's in the session
    our_ephemeral_key_private: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
        comment="Our X25519 ephemeral private key (base64, encrypted)",
    )

    # The signed prekey we used (if we initiated) or they used (if we received)
    signed_prekey_id: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    # The one-time prekey we consumed (if any)
    one_time_prekey_id: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    # ==========================================================
    # Double Ratchet State
    # ==========================================================

    # Root Key (32 bytes, base64) - HKDF root chain
    root_key: Mapped[str] = mapped_column(
        String,
        nullable=False,
        comment="Current root key (base64, 32 bytes)",
    )

    # Sending Chain
    sending_chain_key: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
        comment="Current sending chain key (base64, 32 bytes)",
    )

    sending_message_number: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
        comment="Next message number to use for sending",
    )

    # Receiving Chain
    receiving_chain_key: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
        comment="Current receiving chain key (base64, 32 bytes)",
    )

    receiving_message_number: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
        comment="Next message number expected for receiving",
    )

    # DH Ratchet
    our_ratchet_key_private: Mapped[str] = mapped_column(
        String,
        nullable=False,
        comment="Our current DH ratchet private key (X25519, base64, encrypted)",
    )

    our_ratchet_key_public: Mapped[str] = mapped_column(
        String,
        nullable=False,
        comment="Our current DH ratchet public key (X25519, base64)",
    )

    their_ratchet_key_public: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
        comment="Their current DH ratchet public key (X25519, base64)",
    )

    # Previous receiving chain keys (for out-of-order messages)
    # Stored as JSON: {message_number: chain_key_base64}
    skipped_message_keys: Mapped[str] = mapped_column(
        String,
        default="{}",
        nullable=False,
        comment="JSON map of skipped message numbers to chain keys",
    )

    # Maximum skip allowed (prevents DoS)
    max_skip: Mapped[int] = mapped_column(
        Integer,
        default=1000,
        nullable=False,
    )

    # ==========================================================
    # Full Ratchet State (source of truth)
    # ==========================================================

    # Complete serialized DoubleRatchetCore state (JSON)
    ratchet_state: Mapped[str] = mapped_column(
        Text,
        default="{}",
        nullable=False,
        comment="Full serialized ratchet state (root key, chains, skipped keys)",
    )

    # ==========================================================
    # Associated Data (for AEAD authentication)
    # ==========================================================

    # Our identity public key (Ed25519, base64)
    our_identity_key: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    # Their identity public key (Ed25519, base64) - duplicate for convenience
    their_identity_key: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    # ==========================================================
    # State & Metadata
    # ==========================================================

    state: Mapped[str] = mapped_column(
        Enum(SessionState, native_enum=False),
        default=SessionState.ACTIVE.value,
        nullable=False,
    )

    # Alice's base key (from X3DH) - used for Sesame sync
    alice_base_key: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
        comment="Alice's base key for Sesame (if we are Alice)",
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

    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # ==========================================================
    # Relationships
    # ==========================================================

    device = relationship(
        "Device",
        back_populates="sessions",
        foreign_keys=[device_id],
    )

    def __repr__(self) -> str:
        return (
            f"<SignalSession(id={self.id}, "
            f"device={self.device_id}, "
            f"remote={self.remote_device_id}, "
            f"conv={self.conversation_id}, "
            f"send={self.sending_message_number}, "
            f"recv={self.receiving_message_number})>"
        )
