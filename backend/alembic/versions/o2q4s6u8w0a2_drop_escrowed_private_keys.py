"""drop escrowed private key columns

The server never decrypts device prekeys or identity keys (X3DH
responder runs fully client-side), so escrowing them was pure
risk. The client keeps private halves in its local IndexedDB
store; the server only holds public material.

Revision ID: o2q4s6u8w0a2
Revises: n8p0q2s4t6u8
Create Date: 2026-08-21 15:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "o2q4s6u8w0a2"
down_revision: str | Sequence[str] | None = "n8p0q2s4t6u8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade():

    op.drop_column("devices", "identity_key_private_encrypted")
    op.drop_column("signed_prekeys", "private_key_encrypted")
    op.drop_column("one_time_prekeys", "private_key_encrypted")
    op.drop_column("user_keys", "private_key_encrypted")


def downgrade():

    op.add_column(
        "devices",
        sa.Column("identity_key_private_encrypted", sa.String(), nullable=False),
    )
    op.add_column(
        "signed_prekeys",
        sa.Column("private_key_encrypted", sa.String(), nullable=False),
    )
    op.add_column(
        "one_time_prekeys",
        sa.Column("private_key_encrypted", sa.String(), nullable=False),
    )
    op.add_column(
        "user_keys",
        sa.Column("private_key_encrypted", sa.String(), nullable=False),
    )
