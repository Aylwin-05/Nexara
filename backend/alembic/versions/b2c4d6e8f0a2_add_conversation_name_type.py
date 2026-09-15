"""add conversation name and type columns

Revision ID: b2c4d6e8f0a2
Revises: f8b3c6d2a9e1
Create Date: 2026-08-12 14:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2c4d6e8f0a2"
down_revision: str | Sequence[str] | None = "f8b3c6d2a9e1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade():

    op.add_column(
        "conversations",
        sa.Column(
            "name",
            sa.String(length=100),
            nullable=True,
        ),
    )

    op.add_column(
        "conversations",
        sa.Column(
            "conversation_type",
            sa.String(length=20),
            nullable=False,
            server_default="private",
        ),
    )

    # remove default for future inserts
    op.alter_column(
        "conversations",
        "conversation_type",
        server_default=None,
    )


def downgrade():

    op.drop_column("conversations", "conversation_type")

    op.drop_column("conversations", "name")
