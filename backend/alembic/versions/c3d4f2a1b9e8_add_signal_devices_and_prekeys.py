"""Add Signal devices, prekeys and ratchet sessions

Revision ID: c3d4f2a1b9e8
Revises: 5aad8dd25c18
Create Date: 2026-08-08 23:10:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision: str = "c3d4f2a1b9e8"
down_revision: str | Sequence[str] | None = "5aad8dd25c18"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(name: str) -> bool:
    """Check table existence before dropping legacy tables.

    The legacy prekey tables were removed in this revision but are
    never created by any migration in the chain, so a greenfield
    `alembic upgrade head` must not fail on them.
    """
    bind = op.get_bind()
    return inspect(bind).has_table(name)


def upgrade() -> None:
    """Upgrade schema: replace legacy prekey tables with device model."""

    # ==========================================================
    # Drop legacy design tables (pre-device architecture)
    # ==========================================================

    for legacy_table in (
        "ratchet_sessions",
        "signed_prekeys",
        "one_time_prekeys",
        "prekey_bundles",
    ):
        if _has_table(legacy_table):
            op.drop_table(legacy_table)

    # ==========================================================
    # Devices
    # ==========================================================

    op.create_table(
        "devices",
        sa.Column(
            "id",
            sa.UUID(),
            primary_key=True,
            nullable=False,
            comment="Device primary key.",
        ),
        sa.Column(
            "device_id",
            sa.String(length=64),
            nullable=False,
            comment="Client-generated device identifier (e.g., UUID v4)",
        ),
        sa.Column(
            "user_id",
            sa.UUID(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("platform", sa.String(length=10), nullable=False),
        sa.Column("platform_version", sa.String(length=50), nullable=True),
        sa.Column("app_version", sa.String(length=50), nullable=True),
        sa.Column(
            "device_name",
            sa.String(length=100),
            nullable=True,
            comment="User-friendly name (e.g., 'John's iPhone')",
        ),
        sa.Column(
            "push_token",
            sa.String(length=500),
            nullable=True,
            comment="FCM/APNs/Web Push token for notifications",
        ),
        sa.Column("is_primary", sa.Boolean(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column(
            "last_seen",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column("last_ip", sa.String(length=45), nullable=True),
        sa.Column(
            "identity_key_public",
            sa.String(),
            nullable=False,
            comment="Ed25519 public key (base64), 32 bytes raw",
        ),
        sa.Column(
            "identity_key_x25519",
            sa.String(),
            nullable=False,
            comment="X25519 public key derived from identity key (base64)",
        ),
        sa.Column(
            "identity_key_private_encrypted",
            sa.String(),
            nullable=False,
            comment="Ed25519 private key encrypted with user master key (base64)",
        ),
        sa.Column(
            "registered_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "unregistered_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("device_id"),
    )
    op.create_index("ix_devices_user_id", "devices", ["user_id"], unique=False)
    op.create_index("ix_devices_device_id", "devices", ["device_id"], unique=False)
    op.create_index(
        "ix_devices_user_primary",
        "devices",
        ["user_id", "is_primary"],
        unique=True,
        postgresql_where=sa.text("is_primary = true"),
    )

    # ==========================================================
    # Signed PreKeys
    # ==========================================================

    op.create_table(
        "signed_prekeys",
        sa.Column("id", sa.UUID(), primary_key=True, nullable=False),
        sa.Column(
            "device_id",
            sa.UUID(),
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "key_id",
            sa.Integer(),
            nullable=False,
            comment="Monotonically increasing key ID",
        ),
        sa.Column(
            "public_key",
            sa.String(),
            nullable=False,
            comment="X25519 public key (base64), 32 bytes raw",
        ),
        sa.Column(
            "private_key_encrypted",
            sa.String(),
            nullable=False,
            comment="X25519 private key encrypted with device identity key (base64)",
        ),
        sa.Column(
            "signature",
            sa.String(),
            nullable=False,
            comment="Ed25519 signature of public_key by device identity key (base64)",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "expires_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="When this prekey should be rotated",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("device_id", "key_id", name="uq_signed_prekey_key"),
    )
    op.create_index(
        "ix_signed_prekeys_device_id",
        "signed_prekeys",
        ["device_id"],
        unique=False,
    )

    # ==========================================================
    # One-Time PreKeys
    # ==========================================================

    op.create_table(
        "one_time_prekeys",
        sa.Column("id", sa.UUID(), primary_key=True, nullable=False),
        sa.Column(
            "device_id",
            sa.UUID(),
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "key_id",
            sa.Integer(),
            nullable=False,
            comment="Monotonically increasing key ID",
        ),
        sa.Column(
            "public_key",
            sa.String(),
            nullable=False,
            comment="X25519 public key (base64), 32 bytes raw",
        ),
        sa.Column(
            "private_key_encrypted",
            sa.String(),
            nullable=False,
            comment="X25519 private key encrypted with device identity key (base64)",
        ),
        sa.Column("consumed", sa.Boolean(), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "consumed_by_device_id",
            sa.UUID(),
            sa.ForeignKey("devices.id", ondelete="SET NULL"),
            nullable=True,
            comment="Device that consumed this prekey (initiator of session)",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("device_id", "key_id", name="uq_otpk_device_key"),
    )
    op.create_index("ix_otpks_device_id", "one_time_prekeys", ["device_id"], unique=False)
    op.create_index(
        "ix_otpks_device_consumed",
        "one_time_prekeys",
        ["device_id", "consumed"],
        unique=False,
    )

    # ==========================================================
    # Signal Sessions (Double Ratchet state)
    # ==========================================================

    op.create_table(
        "signal_sessions",
        sa.Column("id", sa.UUID(), primary_key=True, nullable=False),
        sa.Column(
            "device_id",
            sa.UUID(),
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            nullable=False,
            comment="Our device (the one storing this session)",
        ),
        sa.Column(
            "remote_device_id",
            sa.UUID(),
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            nullable=False,
            comment="Remote device we have a session with",
        ),
        sa.Column(
            "conversation_id",
            sa.UUID(),
            sa.ForeignKey("conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "remote_identity_key",
            sa.String(),
            nullable=False,
            comment="Remote device's Ed25519 identity public key (base64)",
        ),
        sa.Column(
            "our_ephemeral_key_private",
            sa.String(),
            nullable=True,
            comment="Our X25519 ephemeral private key (base64, encrypted)",
        ),
        sa.Column("signed_prekey_id", sa.Integer(), nullable=True),
        sa.Column("one_time_prekey_id", sa.Integer(), nullable=True),
        sa.Column(
            "root_key",
            sa.String(),
            nullable=False,
            comment="Current root key (base64, 32 bytes)",
        ),
        sa.Column(
            "sending_chain_key",
            sa.String(),
            nullable=True,
            comment="Current sending chain key (base64, 32 bytes)",
        ),
        sa.Column(
            "sending_message_number",
            sa.Integer(),
            nullable=False,
            comment="Next message number to use for sending",
        ),
        sa.Column(
            "receiving_chain_key",
            sa.String(),
            nullable=True,
            comment="Current receiving chain key (base64, 32 bytes)",
        ),
        sa.Column(
            "receiving_message_number",
            sa.Integer(),
            nullable=False,
            comment="Next message number expected for receiving",
        ),
        sa.Column(
            "our_ratchet_key_private",
            sa.String(),
            nullable=False,
            comment="Our current DH ratchet private key (X25519, base64, encrypted)",
        ),
        sa.Column(
            "our_ratchet_key_public",
            sa.String(),
            nullable=False,
            comment="Our current DH ratchet public key (X25519, base64)",
        ),
        sa.Column(
            "their_ratchet_key_public",
            sa.String(),
            nullable=True,
            comment="Their current DH ratchet public key (X25519, base64)",
        ),
        sa.Column(
            "skipped_message_keys",
            sa.String(),
            nullable=False,
            comment="JSON map of skipped message numbers to chain keys",
        ),
        sa.Column("max_skip", sa.Integer(), nullable=False),
        sa.Column(
            "ratchet_state",
            sa.Text(),
            nullable=False,
            comment="Full serialized ratchet state (root key, chains, skipped keys)",
        ),
        sa.Column("our_identity_key", sa.String(), nullable=False),
        sa.Column("their_identity_key", sa.String(), nullable=False),
        sa.Column("state", sa.String(length=20), nullable=False),
        sa.Column(
            "alice_base_key",
            sa.String(),
            nullable=True,
            comment="Alice's base key for Sesame (if we are Alice)",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "last_used_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "device_id",
            "remote_device_id",
            "conversation_id",
            name="uq_session_device_remote_conversation",
        ),
    )
    op.create_index("ix_sessions_device_id", "signal_sessions", ["device_id"], unique=False)
    op.create_index(
        "ix_sessions_remote_device_id",
        "signal_sessions",
        ["remote_device_id"],
        unique=False,
    )
    op.create_index(
        "ix_sessions_conversation_id",
        "signal_sessions",
        ["conversation_id"],
        unique=False,
    )
    op.create_index(
        "ix_sessions_state",
        "signal_sessions",
        ["state"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema (drop signal tables, restore legacy prekeys)."""
    op.drop_index("ix_sessions_state", table_name="signal_sessions")
    op.drop_index("ix_sessions_conversation_id", table_name="signal_sessions")
    op.drop_index("ix_sessions_remote_device_id", table_name="signal_sessions")
    op.drop_index("ix_sessions_device_id", table_name="signal_sessions")
    op.drop_table("signal_sessions")

    op.drop_index("ix_otpks_device_consumed", table_name="one_time_prekeys")
    op.drop_index("ix_otpks_device_id", table_name="one_time_prekeys")
    op.drop_table("one_time_prekeys")

    op.drop_index("ix_signed_prekeys_device_id", table_name="signed_prekeys")
    op.drop_table("signed_prekeys")

    op.drop_index(
        "ix_devices_user_primary",
        table_name="devices",
        postgresql_where=sa.text("is_primary = true"),
    )
    op.drop_index("ix_devices_device_id", table_name="devices")
    op.drop_index("ix_devices_user_id", table_name="devices")
    op.drop_table("devices")

    # NOTE: legacy tables are not restored on downgrade (removed design).
