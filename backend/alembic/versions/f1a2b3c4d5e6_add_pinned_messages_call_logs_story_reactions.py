"""add pinned messages, call logs, story reactions

Revision ID: f1a2b3c4d5e6
Revises: b8e2f4a6c0d8
Create Date: 2026-08-25

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "f1a2b3c4d5e6"
down_revision = "b8e2f4a6c0d8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Message.is_pinned
    op.add_column(
        "messages",
        sa.Column("is_pinned", sa.Boolean(), nullable=False, server_default="false"),
    )

    # ConversationParticipant.wallpaper
    op.add_column(
        "conversation_participants",
        sa.Column("wallpaper", sa.String(500), nullable=True),
    )

    # Call logs
    op.create_table(
        "call_logs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "caller_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "receiver_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "conversation_id",
            UUID(as_uuid=True),
            sa.ForeignKey("conversations.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("call_type", sa.String(10), nullable=False, server_default="voice"),
        sa.Column("status", sa.String(20), nullable=False, server_default="missed"),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_call_logs_caller_id", "call_logs", ["caller_id"])
    op.create_index("ix_call_logs_receiver_id", "call_logs", ["receiver_id"])
    op.create_index("ix_call_logs_created_at", "call_logs", ["created_at"])

    # Story reactions
    op.create_table(
        "story_reactions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "story_id",
            UUID(as_uuid=True),
            sa.ForeignKey("stories.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("emoji", sa.String(10), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("story_id", "user_id", name="uq_story_reaction"),
    )


def downgrade() -> None:
    op.drop_table("story_reactions")
    op.drop_table("call_logs")
    op.drop_column("conversation_participants", "wallpaper")
    op.drop_column("messages", "is_pinned")
