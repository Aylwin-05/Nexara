"""add group invite links

Revision ID: k4m6o8q0s2u4
Revises: j3l5n7p9r1t3
Create Date: 2026-08-21 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "k4m6o8q0s2u4"
down_revision: str | Sequence[str] | None = "j3l5n7p9r1t3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade():

    op.create_table(
        "group_invite_links",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
        ),
        sa.Column(
            "conversation_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey(
                "conversations.id",
                ondelete="CASCADE",
            ),
            nullable=False,
        ),
        sa.Column(
            "token",
            sa.String(64),
            nullable=False,
        ),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey(
                "users.id",
                ondelete="SET NULL",
            ),
            nullable=True,
        ),
        sa.Column(
            "expires_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "revoked",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    op.create_index(
        "ix_group_invite_links_conversation_id",
        "group_invite_links",
        ["conversation_id"],
    )

    op.create_index(
        "ix_group_invite_links_token",
        "group_invite_links",
        ["token"],
        unique=True,
    )

    op.alter_column(
        "group_invite_links",
        "revoked",
        server_default=None,
    )


def downgrade():

    op.drop_index(
        "ix_group_invite_links_token",
        table_name="group_invite_links",
    )

    op.drop_index(
        "ix_group_invite_links_conversation_id",
        table_name="group_invite_links",
    )

    op.drop_table("group_invite_links")
