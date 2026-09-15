"""add two-party conversation deletion request columns

Revision ID: a6c5b4d3e2f1
Revises: c9f0e1d2a3b4
Create Date: 2026-08-13 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a6c5b4d3e2f1"
down_revision: str | Sequence[str] | None = "c9f0e1d2a3b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade():

    op.add_column(
        "conversations",
        sa.Column(
            "delete_requested_by",
            sa.UUID(as_uuid=True),
            nullable=True,
        ),
    )

    op.add_column(
        "conversations",
        sa.Column(
            "delete_requested_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )

    op.create_foreign_key(
        "fk_conversations_delete_requested_by",
        "conversations",
        "users",
        ["delete_requested_by"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade():

    op.drop_constraint(
        "fk_conversations_delete_requested_by",
        "conversations",
        type_="foreignkey",
    )

    op.drop_column("conversations", "delete_requested_at")

    op.drop_column("conversations", "delete_requested_by")
