"""add message forwarded count

Revision ID: h1j3k5l7m9n1
Revises: g0h2i4j6k8l0
Create Date: 2026-08-21 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "h1j3k5l7m9n1"
down_revision: str | Sequence[str] | None = "g0h2i4j6k8l0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade():

    op.add_column(
        "messages",
        sa.Column(
            "forwarded_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )

    # Backfill: messages already flagged as forwarded get count 1
    op.execute(
        "UPDATE messages SET forwarded_count = 1 WHERE is_forwarded = true AND forwarded_count = 0"
    )

    # remove default for future inserts
    op.alter_column(
        "messages",
        "forwarded_count",
        server_default=None,
    )


def downgrade():

    op.drop_column("messages", "forwarded_count")
