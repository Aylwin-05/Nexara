"""add two-step verification (2FA PIN)

Revision ID: m7o9p1r3t5v7
Revises: k4m6o8q0s2u4
Create Date: 2026-08-21 13:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "m7o9p1r3t5v7"
down_revision: str | Sequence[str] | None = "k4m6o8q0s2u4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade():

    op.add_column(
        "users",
        sa.Column(
            "two_fa_enabled",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )

    op.add_column(
        "users",
        sa.Column(
            "two_fa_secret",
            sa.String(512),
            nullable=True,
        ),
    )

    op.alter_column(
        "users",
        "two_fa_enabled",
        server_default=None,
    )


def downgrade():

    op.drop_column("users", "two_fa_secret")

    op.drop_column("users", "two_fa_enabled")
