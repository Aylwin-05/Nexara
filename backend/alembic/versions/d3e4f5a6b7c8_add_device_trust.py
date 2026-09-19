"""Create the device_trust (TOFU trust records) table.

The DeviceTrust model exists (app/models/device.py) and the
DeviceTrustRepository / devices API query it, but no migration ever
created the table: every call to GET /api/v1/devices/trust currently
fails with `relation "device_trust" does not exist`.

Revision ID: d3e4f5a6b7c8
Revises: c1d2e3f4a5b6
Create Date: 2026-09-19

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d3e4f5a6b7c8"
down_revision: str | Sequence[str] | None = "c1d2e3f4a5b6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "device_trust",
        sa.Column("id", sa.UUID(), primary_key=True, nullable=False, comment="Trust record PK."),
        sa.Column(
            "owner_id",
            sa.UUID(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            comment="The user who owns this trust record",
        ),
        sa.Column(
            "device_id",
            sa.UUID(),
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            nullable=False,
            comment="The remote device being trusted",
        ),
        sa.Column(
            "trust_level",
            sa.String(length=20),
            nullable=False,
            server_default="unknown",
            comment="unknown | trusted | verified",
        ),
        sa.Column(
            "identity_key_fingerprint",
            sa.String(length=64),
            nullable=True,
            comment="SHA-256 of the device identity key at trust time",
        ),
        sa.Column(
            "trusted_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="When trust was established",
        ),
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
        sa.UniqueConstraint("owner_id", "device_id", name="uq_device_trust_owner_device"),
    )
    op.create_index("ix_device_trust_owner", "device_trust", ["owner_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_device_trust_owner", table_name="device_trust")
    op.drop_table("device_trust")
