"""add stories and story views

Revision ID: c5d7e9f1a3b5
Revises: a3b5c7d9e1f2
Create Date: 2026-08-19 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c5d7e9f1a3b5"
down_revision: str | Sequence[str] | None = "a3b5c7d9e1f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade():

    op.create_table(
        "stories",
        sa.Column("id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("caption", sa.String(length=500), nullable=True),
        sa.Column("storage_path", sa.String(length=500), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=True),
        sa.Column("mime_type", sa.String(length=100), nullable=False),
        sa.Column("media_type", sa.String(length=20), nullable=False),
        sa.Column("encrypted", sa.Boolean(), nullable=False),
        sa.Column("encrypted_key_sender", sa.String(), nullable=True),
        sa.Column("encrypted_key_receiver", sa.String(), nullable=True),
        sa.Column("nonce", sa.String(), nullable=True),
        sa.Column("wrapped_keys", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_index(
        "ix_stories_expires_at",
        "stories",
        ["expires_at"],
    )

    op.create_table(
        "story_views",
        sa.Column("id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("story_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "viewed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["story_id"], ["stories.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("story_id", "user_id", name="uq_story_viewer"),
    )


def downgrade():

    op.drop_table("story_views")
    op.drop_index("ix_stories_expires_at", table_name="stories")
    op.drop_table("stories")
