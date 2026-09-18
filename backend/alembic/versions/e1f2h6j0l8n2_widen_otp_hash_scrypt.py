"""widen otp_codes.otp_hash

F4 switched OTP hashing from SHA-256 to scrypt (via hash_pin). The
scrypt digest is ~130 characters, exceeding the original VARCHAR(64)
column, so OTP inserts failed with StringDataRightTruncationError.
Aligns the live column with the model (String(512)).
"""

import sqlalchemy as sa
from alembic import op

revision = "e1f2h6j0l8n2"
down_revision = "d6f8h0j2l4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "otp_codes",
        "otp_hash",
        existing_type=sa.String(64),
        type_=sa.String(512),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "otp_codes",
        "otp_hash",
        existing_type=sa.String(512),
        type_=sa.String(64),
        existing_nullable=False,
    )
