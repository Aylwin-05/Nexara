"""add delete for me

Revision ID: 9d6e5f4a1c2b
Revises: c3d4f2a1b9e8
Create Date: 2026-08-10 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "9d6e5f4a1c2b"
down_revision: str | Sequence[str] | None = "7f2a9c41d6e0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade():

    # User IDs for whom the message has been deleted
    # ("delete for me"). Messages hidden from a user's
    # history but still visible to other participants.
    op.add_column(
        "messages",
        sa.Column(
            "deleted_for",
            postgresql.ARRAY(
                postgresql.UUID(as_uuid=True),
            ),
            nullable=False,
            server_default="{}",
        ),
    )

    # remove default for future inserts
    op.alter_column(
        "messages",
        "deleted_for",
        server_default=None,
    )


def downgrade():

    op.drop_column("messages", "deleted_for")
