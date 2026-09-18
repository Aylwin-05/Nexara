"""add group avatar, description, created_by

Revision ID: a3b5c7d9e1f2
Revises: f1e2d3c4b5a6
Create Date: 2026-08-19 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a3b5c7d9e1f2"
down_revision: str | Sequence[str] | None = "f1e2d3c4b5a6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade():

    op.add_column(
        "conversations",
        sa.Column(
            "avatar_url",
            sa.String(length=500),
            nullable=True,
        ),
    )

    op.add_column(
        "conversations",
        sa.Column(
            "description",
            sa.String(length=500),
            nullable=True,
        ),
    )

    op.add_column(
        "conversations",
        sa.Column(
            "created_by",
            sa.UUID(as_uuid=True),
            sa.ForeignKey(
                "users.id",
                ondelete="SET NULL",
            ),
            nullable=True,
        ),
    )


def downgrade():

    op.drop_column("conversations", "created_by")
    op.drop_column("conversations", "description")
    op.drop_column("conversations", "avatar_url")
