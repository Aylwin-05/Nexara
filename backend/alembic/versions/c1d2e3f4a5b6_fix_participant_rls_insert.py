"""Allow conversation creation under row-level security.

The conversation_participants policy shipped with WITH CHECK
(secure.is_conversation_member(conversation_id, current_user)), which
requires the CURRENT user to already be a member of the conversation to
insert a participant row. Inserting the FIRST participant row of a brand
- new conversation -- or the partner row of a private chat -- therefore
always failed from the app role: no private chat could be started, the
participants table stayed empty, and message INSERT (whose WITH CHECK
also requires membership) 500ed on every send. (SQLite tests never
exercised this because they run without RLS.)

Admit the two legitimate creation paths:
  * a user inserting their own participant row,
  * a member of the conversation adding another participant
    (the partner row of a private chat / group creation).

The USING (SELECT) clause must ALSO admit the rower's own participant row:
SQLAlchemy's create() always emits INSERT ... RETURNING (then refresh), and
PostgreSQL re-checks the SELECT policy against the returned row. For the
first participant is_conversation_member() is still false at that instant,
so the insert was rejected with "new row violates row-level security policy"
even though WITH CHECK passed.

Revision ID: c1d2e3f4a5b6
Revises: h3i4j5k6l7m8
Create Date: 2026-09-18 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c1d2e3f4a5b6"
down_revision: str | Sequence[str] | None = "h3i4j5k6l7m8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_UID = "COALESCE(current_setting('app.current_user_id', true), '')"
_MEMBER = "secure.is_conversation_member"


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "DROP POLICY IF EXISTS np_conversation_participants_scope ON conversation_participants"
        )
    )
    bind.execute(
        sa.text(
            f"""CREATE POLICY np_conversation_participants_scope
                ON conversation_participants
                FOR ALL
                USING ({_UID} = 'system' OR {_MEMBER}(conversation_id::text, {_UID})
                       OR user_id::text = {_UID})
                WITH CHECK ({_MEMBER}(conversation_id::text, {_UID})
                            OR user_id::text = {_UID})"""
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "DROP POLICY IF EXISTS np_conversation_participants_scope ON conversation_participants"
        )
    )
    bind.execute(
        sa.text(
            f"""CREATE POLICY np_conversation_participants_scope
                ON conversation_participants
                FOR ALL
                USING ({_UID} = 'system' OR {_MEMBER}(conversation_id::text, {_UID}))
                WITH CHECK ({_MEMBER}(conversation_id::text, {_UID}))"""
        )
    )
