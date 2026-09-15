"""add client_message_id and message dedupe index

Revision ID: t2u4v6w8x0y2
Revises: s4t6u8w0y2a4
Create Date: 2026-09-11 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "t2u4v6w8x0y2"
down_revision: str | Sequence[str] | None = "s4t6u8w0y2a4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade():

    op.add_column(
        "messages",
        sa.Column(
            "client_message_id",
            sa.String(64),
            nullable=True,
        ),
    )

    # A client retry of a POST /messages/send with the same key is
    # a replay, not a new message. Partial index keeps the
    # constraint (and its space) limited to deduped sends.
    op.create_index(
        "uq_messages_client_dedupe",
        "messages",
        ["conversation_id", "sender_id", "client_message_id"],
        unique=True,
        postgresql_where=sa.text("client_message_id IS NOT NULL"),
        sqlite_where=sa.text("client_message_id IS NOT NULL"),
    )


def downgrade():

    op.drop_index(
        "uq_messages_client_dedupe",
        table_name="messages",
    )

    op.drop_column("messages", "client_message_id")
