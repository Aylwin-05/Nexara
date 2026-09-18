"""Grant USAGE on the secure schema to the app role.

The RLS migrations created the `secure` helper functions and granted
EXECUTE on them, but never granted USAGE on the schema. Under the
least-privilege `nexara_app` role every RLS policy that calls
secure.is_conversation_member / secure.is_accepted_friend aborts with
"permission denied for schema secure" (surfacing as an RLS rejection),
so creating conversations and reading messages fail at runtime.
"""

import sqlalchemy as sa
from alembic import op

revision = "h3i4j5k6l7m8"
down_revision = "g1h2i3j4k5l6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            "GRANT USAGE ON SCHEMA secure TO nexara_app"
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            "REVOKE USAGE ON SCHEMA secure FROM nexara_app"
        )
    )
