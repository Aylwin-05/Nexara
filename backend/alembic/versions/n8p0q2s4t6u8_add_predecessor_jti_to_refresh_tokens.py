"""add predecessor_jti to refresh_tokens

Allows tracing a replayed (rotated-away) token back to its family
even after its own row has been pruned: the successor row records
the jti it replaced.

Revision ID: n8p0q2s4t6u8
Revises: m7o9p1r3t5v7
Create Date: 2026-08-21 14:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "n8p0q2s4t6u8"
down_revision: str | Sequence[str] | None = "m7o9p1r3t5v7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade():

    op.add_column(
        "refresh_tokens",
        sa.Column(
            "predecessor_jti",
            sa.String(64),
            nullable=True,
        ),
    )


def downgrade():

    op.drop_column("refresh_tokens", "predecessor_jti")
