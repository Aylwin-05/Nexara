"""Add recovery key + sync copies (cross-browser history)

Revision ID: f1e2d3c4b5a6
Revises: f9a8b7c6d5e4
Create Date: 2026-08-18 23:30:00.000000

Feature: the account recovery code lets every browser of an
account decrypt the full history.

  users.recovery_salt         PBKDF2 salt (hex) for the code wrap
  users.recovery_wrapped_key  AES-256-GCM blob: the account sync
                              secret, wrapped by the code (the raw
                              secret is never stored server-side)
  messages.sync_envelope      per-message AES-256-GCM copy of the
                              plaintext, keyed by the account sync
                              secret (written by any device that
                              decrypts the message)
  attachments.sync_blob       same, but for decrypted file bytes
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f1e2d3c4b5a6"
down_revision: str | Sequence[str] | None = "f9a8b7c6d5e4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the recovery-key columns and per-message sync copies."""

    op.add_column(
        "users",
        sa.Column(
            "recovery_salt",
            sa.String(length=64),
            nullable=True,
            comment="PBKDF2 salt (hex) used to wrap the sync secret.",
        ),
    )

    op.add_column(
        "users",
        sa.Column(
            "recovery_wrapped_key",
            sa.JSON(),
            nullable=True,
            comment=(
                "AES-256-GCM blob wrapping the account sync secret "
                "with a key derived from the recovery code."
            ),
        ),
    )

    op.add_column(
        "messages",
        sa.Column(
            "sync_envelope",
            sa.JSON(),
            nullable=True,
            comment=(
                "Account-key copy of the message plaintext "
                '({"nonce": b64, "data": b64, "ciphertext": str}).'
            ),
        ),
    )

    op.add_column(
        "attachments",
        sa.Column(
            "sync_blob",
            sa.JSON(),
            nullable=True,
            comment=('Account-key copy of the decrypted file bytes ({"nonce": b64, "data": b64}).'),
        ),
    )


def downgrade() -> None:
    """Drop the sync/recovery columns."""

    op.drop_column("attachments", "sync_blob")
    op.drop_column("messages", "sync_envelope")
    op.drop_column("users", "recovery_wrapped_key")
    op.drop_column("users", "recovery_salt")
