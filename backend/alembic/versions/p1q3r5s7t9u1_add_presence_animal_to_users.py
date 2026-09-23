"""Add presence_animal column to users.

Per-user choice for the Snapchat-style "in chat" presence pet
(default username avatar, or an animated cat/dog/owl/rabbit) that
appears on peers' screens while the user is viewing a conversation.

Revision ID: p1q3r5s7t9u1
Revises: d3e4f5a6b7c8
Create Date: 2026-09-19

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "p1q3r5s7t9u1"
down_revision: str | Sequence[str] | None = "d3e4f5a6b7c8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "presence_animal",
            sa.String(length=32),
            nullable=False,
            server_default="default",
            comment="Animated pet shown as the in-chat presence indicator (default | cat | dog | owl | rabbit).",
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "presence_animal")
