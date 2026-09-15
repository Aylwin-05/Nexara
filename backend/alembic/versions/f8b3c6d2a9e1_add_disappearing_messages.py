"""add disappearing messages (conversation timer + message expiry)

Revision ID: f8b3c6d2a9e1
Revises: e7d4a9b2c1f0
Create Date: 2026-08-12 13:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f8b3c6d2a9e1"
down_revision: str | Sequence[str] | None = "e7d4a9b2c1f0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade():

    op.add_column(
        "conversations",
        sa.Column(
            "disappear_after_seconds",
            sa.Integer(),
            nullable=True,
        ),
    )

    op.add_column(
        "messages",
        sa.Column(
            "expires_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )

    op.create_index(
        "ix_messages_expires_at",
        "messages",
        ["expires_at"],
    )


def downgrade():

    op.drop_index("ix_messages_expires_at", table_name="messages")

    op.drop_column("messages", "expires_at")

    op.drop_column("conversations", "disappear_after_seconds")
