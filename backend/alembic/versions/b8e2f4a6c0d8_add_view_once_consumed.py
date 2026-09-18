"""add view_once_consumed to attachments

Revision ID: b8e2f4a6c0d8
Revises: i1b2c3d4e5f6
Create Date: 2026-08-22 08:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b8e2f4a6c0d8"
down_revision: str | Sequence[str] | None = "i1b2c3d4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade():

    op.add_column(
        "attachments",
        sa.Column(
            "view_once_consumed",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )

    op.alter_column(
        "attachments",
        "view_once_consumed",
        server_default=None,
    )


def downgrade():

    op.drop_column("attachments", "view_once_consumed")
