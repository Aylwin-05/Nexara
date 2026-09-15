"""add per-participant pin, archive and mute settings

Revision ID: e7d4a9b2c1f0
Revises: c3d4f2a1b9e8
Create Date: 2026-08-12 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e7d4a9b2c1f0"
down_revision: str | Sequence[str] | None = "c3d4f2a1b9e8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade():

    op.add_column(
        "conversation_participants",
        sa.Column(
            "is_pinned",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )

    op.add_column(
        "conversation_participants",
        sa.Column(
            "is_archived",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )

    op.add_column(
        "conversation_participants",
        sa.Column(
            "muted_until",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )

    # remove defaults for future inserts
    op.alter_column(
        "conversation_participants",
        "is_pinned",
        server_default=None,
    )

    op.alter_column(
        "conversation_participants",
        "is_archived",
        server_default=None,
    )


def downgrade():

    op.drop_column("conversation_participants", "muted_until")

    op.drop_column("conversation_participants", "is_archived")

    op.drop_column("conversation_participants", "is_pinned")
