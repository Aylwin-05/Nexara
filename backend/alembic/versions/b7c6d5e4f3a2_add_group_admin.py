"""add is_admin to conversation participants for group chats

Revision ID: b7c6d5e4f3a2
Revises: a6c5b4d3e2f1
Create Date: 2026-08-13 11:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7c6d5e4f3a2"
down_revision: str | Sequence[str] | None = "a6c5b4d3e2f1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade():

    op.add_column(
        "conversation_participants",
        sa.Column(
            "is_admin",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )


def downgrade():

    op.drop_column(
        "conversation_participants",
        "is_admin",
    )
