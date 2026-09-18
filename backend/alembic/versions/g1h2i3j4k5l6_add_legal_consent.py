"""Record Privacy/Terms consent at registration.

Two nullable timestamps on users, set only when a brand-new
account is created (both must be accepted). Existing accounts
never re-consent, so their rows keep NULL here.
"""

import sqlalchemy as sa
from alembic import op

revision = "g1h2i3j4k5l6"
down_revision = "f2h4j6l8n0p2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "privacy_consent_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "terms_consent_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "terms_consent_at")
    op.drop_column("users", "privacy_consent_at")
