"""add message reactions and forwarded flag

Revision ID: a1b2c3d4e5f6
Revises: 9d6e5f4a1c2b
Create Date: 2026-08-12 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: str | Sequence[str] | None = "9d6e5f4a1c2b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade():

    # ----------------------------------------------------------
    # Forwarded flag on messages
    # ----------------------------------------------------------

    op.add_column(
        "messages",
        sa.Column(
            "is_forwarded",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )

    # remove default for future inserts
    op.alter_column(
        "messages",
        "is_forwarded",
        server_default=None,
    )

    # ----------------------------------------------------------
    # Emoji reactions (one per user per message)
    # ----------------------------------------------------------

    op.create_table(
        "message_reactions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "message_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "emoji",
            sa.String(length=32),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["message_id"],
            ["messages.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "message_id",
            "user_id",
            name="uq_message_reaction_user",
        ),
    )


def downgrade():

    op.drop_table("message_reactions")

    op.drop_column("messages", "is_forwarded")
