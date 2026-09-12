"""add users.session_version

Revision ID: u1v3w5x7y9z1
Revises: t2u4v6w8x0y2
Create Date: 2026-09-12 09:00:00.000000

Adds a per-user session generation counter embedded in access
tokens as the "ver" claim. Bumping it (logout, deactivation,
deletion) invalidates outstanding access tokens immediately.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'u1v3w5x7y9z1'
down_revision: str | Sequence[str] | None = 't2u4v6w8x0y2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade():

    op.add_column(
        "users",
        sa.Column(
            "session_version",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade():

    op.drop_column("users", "session_version")