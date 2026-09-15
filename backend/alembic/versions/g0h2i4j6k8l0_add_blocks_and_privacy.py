"""add blocks and user privacy settings

Revision ID: g0h2i4j6k8l0
Revises: e6f8a0b2c4d6
Create Date: 2026-08-19 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "g0h2i4j6k8l0"
down_revision: str | Sequence[str] | None = "e6f8a0b2c4d6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade():

    op.create_table(
        "blocks",
        sa.Column("id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("blocker_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("blocked_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["blocker_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["blocked_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("blocker_id", "blocked_id", name="uq_block_pair"),
    )

    op.create_index(
        "ix_blocks_blocker_id",
        "blocks",
        ["blocker_id"],
    )
    op.create_index(
        "ix_blocks_blocked_id",
        "blocks",
        ["blocked_id"],
    )

    op.create_table(
        "user_privacy_settings",
        sa.Column("id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("last_seen", sa.String(length=20), nullable=False),
        sa.Column("profile_photo", sa.String(length=20), nullable=False),
        sa.Column("story", sa.String(length=20), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="uq_user_privacy_user"),
    )


def downgrade():

    op.drop_table("user_privacy_settings")
    op.drop_index("ix_blocks_blocked_id", table_name="blocks")
    op.drop_index("ix_blocks_blocker_id", table_name="blocks")
    op.drop_table("blocks")
