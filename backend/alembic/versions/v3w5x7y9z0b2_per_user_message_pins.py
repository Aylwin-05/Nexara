"""Per-user message pins (replaces the global messages.is_pinned).

Pinning was a single bool on the messages row, so one participant's
pin showed up for everyone in the conversation. Pins are now rows in
message_pins keyed by (message, user) — personal, like stars.

Migration strategy:
  * create message_pins
  * backfill: every message that was globally pinned gets a pin row
    for EACH participant of its conversation (preserves what users
    already saw as pinned; nobody is silently unpinned)
  * drop messages.is_pinned

Revision ID: v3w5x7y9z0b2
Revises: r2s4t6v8w0a3
Create Date: 2026-10-04

"""

import sqlalchemy as sa
from alembic import op

revision = "v3w5x7y9z0b2"
down_revision = "r2s4t6v8w0a3"
branch_labels = None
depends_on = None


def upgrade() -> None:

    op.create_table(
        "message_pins",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "message_id",
            sa.UUID(),
            sa.ForeignKey("messages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.UUID(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("message_id", "user_id", name="uq_message_pin_user"),
    )
    op.create_index("ix_message_pin_message_id", "message_pins", ["message_id"])

    # Backfill global pins as per-user pins on every participant.
    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            INSERT INTO message_pins (id, message_id, user_id, created_at)
            SELECT gen_random_uuid(), m.id, cp.user_id, NOW()
            FROM messages m
            JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id
            WHERE m.is_pinned IS TRUE
            """
        )
    )

    op.drop_column("messages", "is_pinned")


def downgrade() -> None:

    op.add_column(
        "messages",
        sa.Column("is_pinned", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    # Restore a global pin where ANY participant had pinned the message.
    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            UPDATE messages m
            SET is_pinned = TRUE
            WHERE EXISTS (
                SELECT 1 FROM message_pins p WHERE p.message_id = m.id
            )
            """
        )
    )

    op.drop_index("ix_message_pin_message_id", table_name="message_pins")
    op.drop_table("message_pins")
