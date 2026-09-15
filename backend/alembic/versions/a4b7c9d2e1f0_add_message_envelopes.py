"""Add per-device envelopes to messages

Revision ID: a4b7c9d2e1f0
Revises: d8e7f6a5b4c3
Create Date: 2026-08-13 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a4b7c9d2e1f0"
down_revision: str | Sequence[str] | None = "d8e7f6a5b4c3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add per-device Signal envelopes (multi-device support).

    Each message may carry one envelope per device of every
    participant; a device decrypts only its own copy. The column
    is nullable — legacy messages keep single-envelope behavior.
    """

    op.add_column(
        "messages",
        sa.Column(
            "envelopes",
            sa.JSON(),
            nullable=True,
            comment=('Per-device Signal envelopes: [{"device_id": str, "data": envelopeJson}]'),
        ),
    )


def downgrade() -> None:
    """Drop the envelopes column."""

    op.drop_column("messages", "envelopes")
