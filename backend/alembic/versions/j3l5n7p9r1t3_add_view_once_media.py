"""add view-once media support

Revision ID: j3l5n7p9r1t3
Revises: i2k4m6o8q0r2
Create Date: 2026-08-21 11:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "j3l5n7p9r1t3"
down_revision: str | Sequence[str] | None = "i2k4m6o8q0r2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade():

    op.add_column(
        "attachments",
        sa.Column(
            "view_once",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )

    op.add_column(
        "messages",
        sa.Column(
            "view_once_opened",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )

    op.alter_column(
        "attachments",
        "view_once",
        server_default=None,
    )

    op.alter_column(
        "messages",
        "view_once_opened",
        server_default=None,
    )


def downgrade():

    op.drop_column("messages", "view_once_opened")

    op.drop_column("attachments", "view_once")
