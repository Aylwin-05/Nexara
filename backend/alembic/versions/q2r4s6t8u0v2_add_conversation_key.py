"""add conversation_key for private conversation uniqueness

Prevents two users from racing to create the same private
conversation and ending up with duplicate chats: a deterministic
"min_user_id:max_user_id" key on the conversation row backed by a
unique index makes the DB the ultimate source of truth.

Revision ID: q2r4s6t8u0v2
Revises: f1a2b3c4d5e6
Create Date: 2026-08-31 15:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "q2r4s6t8u0v2"
down_revision: str | Sequence[str] | None = "f1a2b3c4d5e6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade():

    op.add_column(
        "conversations",
        sa.Column(
            "conversation_key",
            sa.String(128),
            nullable=True,
        ),
    )

    # Backfill existing private conversations with the deterministic
    # key derived from their two participants (min:max UUIDs).
    op.execute(
        """
        UPDATE conversations AS c
        SET conversation_key = sub.key
        FROM (
            SELECT
                p.conversation_id,
                MIN(p.user_id::text) || ':' || MAX(p.user_id::text) AS key
            FROM conversation_participants AS p
            GROUP BY p.conversation_id
            HAVING COUNT(*) = 2
        ) AS sub
        WHERE c.id = sub.conversation_id
        """
    )

    # Groups and any conversation without exactly two participants
    # keep a NULL key, which the unique constraint permits repeated.
    op.create_unique_constraint(
        "uq_conversation_key",
        "conversations",
        ["conversation_key"],
    )


def downgrade():

    op.drop_constraint(
        "uq_conversation_key",
        "conversations",
        type_="unique",
    )

    op.drop_column("conversations", "conversation_key")
