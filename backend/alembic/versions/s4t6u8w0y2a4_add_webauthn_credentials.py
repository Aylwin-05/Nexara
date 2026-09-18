"""add webauthn credentials

Revision ID: s4t6u8w0y2a4
Revises: q2r4s6t8u0v2
Create Date: 2026-09-03 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "s4t6u8w0y2a4"
down_revision: str | Sequence[str] | None = "q2r4s6t8u0v2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade():

    op.create_table(
        "webauthn_credentials",
        sa.Column(
            "id",
            sa.Uuid(),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "credential_id",
            sa.String(512),
            nullable=False,
        ),
        sa.Column(
            "public_key",
            sa.Text(),
            nullable=False,
        ),
        sa.Column(
            "sign_count",
            sa.Integer(),
            server_default="0",
            nullable=False,
        ),
        sa.Column(
            "device_name",
            sa.String(128),
            nullable=True,
        ),
        sa.Column(
            "last_used_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )

    op.create_index(
        "ix_webauthn_user_id",
        "webauthn_credentials",
        ["user_id"],
    )

    op.create_index(
        "ix_webauthn_credential_id",
        "webauthn_credentials",
        ["credential_id"],
        unique=True,
    )


def downgrade():

    op.drop_index(
        "ix_webauthn_credential_id",
        table_name="webauthn_credentials",
    )

    op.drop_index(
        "ix_webauthn_user_id",
        table_name="webauthn_credentials",
    )

    op.drop_table("webauthn_credentials")
