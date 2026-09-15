"""RLS policy refinements required for actually switching the app
role to `nexara_app`.

Two gaps in the initial policies made activation unsafe:

1. `conversation_participants` scoped strictly to `user_id = self`.
   Presence / broadcast fan-out enumerates PEERS in a conversation
   ("who else is in this room"), so self-scoped rows made every
   conversation look empty to membership-cache logic. Policies are
   now conversation-membership scoped: you see participant rows of
   any conversation you belong to.

2. No scope for system maintenance. The disappearing-message purge
   loop and the startup orphan-file sweep run on dedicated sessions
   with NO authenticated user and must operate across all rows.
   Those sessions set `app.current_user_id = 'system'`; a `'system'`
   clause in each USING branch admits them while every real user
   still requires membership. `'system'` is never reachable by a
   client (the GUC is only set from server code paths).

All GUC comparisons are TEXT-vs-text: Postgres does not guarantee
OR short-circuiting, so a `::uuid` cast on the 'system' or empty
value would error. Comparing `user_id::text` to the raw GUC text is
always safe (a uuid string never equals 'system' or '').
"""

import sqlalchemy as sa
from alembic import op

revision = "b4d6f8h0j2l4"
down_revision = "a2b4c6d8e0f1"
branch_labels = None
depends_on = None


def _uid():
    return "COALESCE(current_setting('app.current_user_id', true), '')"


def _messages_scope():
    uid = _uid()
    return sa.text(
        f"""
        CREATE POLICY np_messages_scope ON messages
        FOR ALL
        USING ({uid} = 'system' OR conversation_id IN (
            SELECT conversation_id FROM conversation_participants
            WHERE user_id::text = {uid}
        ))
        WITH CHECK (conversation_id IN (
            SELECT conversation_id FROM conversation_participants
            WHERE user_id::text = {uid}
        ))
        """
    )


def _participants_scope():
    uid = _uid()
    return sa.text(
        f"""
        CREATE POLICY np_conversation_participants_scope
        ON conversation_participants
        FOR ALL
        USING ({uid} = 'system' OR conversation_id IN (
            SELECT conversation_id FROM conversation_participants
            WHERE user_id::text = {uid}
        ))
        WITH CHECK (conversation_id IN (
            SELECT conversation_id FROM conversation_participants
            WHERE user_id::text = {uid}
        ))
        """
    )


def _attachments_scope():
    uid = _uid()
    return sa.text(
        f"""
        CREATE POLICY np_attachments_scope ON attachments
        FOR ALL
        USING ({uid} = 'system' OR message_id IN (
            SELECT m.id FROM messages m
            JOIN conversation_participants cp
              ON cp.conversation_id = m.conversation_id
            WHERE cp.user_id::text = {uid}
        ))
        WITH CHECK (message_id IN (
            SELECT m.id FROM messages m
            JOIN conversation_participants cp
              ON cp.conversation_id = m.conversation_id
            WHERE cp.user_id::text = {uid}
        ))
        """
    )


def _policies():
    return {
        "messages": _messages_scope(),
        "conversation_participants": _participants_scope(),
        "attachments": _attachments_scope(),
    }


def upgrade() -> None:
    bind = op.get_bind()

    for table in ("messages", "conversation_participants", "attachments"):
        bind.execute(sa.text(f"DROP POLICY IF EXISTS np_{table}_scope ON {table}"))

    for stmt in _policies().values():
        bind.execute(stmt)


def downgrade() -> None:
    # Restore the strict self-scoped policies from the first migration.
    # NOTE: these are the OLD semantics; not recommended to run while
    # nexara_app is live.
    bind = op.get_bind()
    uid = "current_setting('app.current_user_id', true)::uuid"

    for table in ("messages", "conversation_participants", "attachments"):
        bind.execute(sa.text(f"DROP POLICY IF EXISTS np_{table}_scope ON {table}"))

    bind.execute(
        sa.text(
            f"""CREATE POLICY np_messages_scope ON messages
                FOR ALL
                USING (conversation_id IN (
                    SELECT conversation_id FROM conversation_participants
                    WHERE user_id = {uid}
                ))
                WITH CHECK (conversation_id IN (
                    SELECT conversation_id FROM conversation_participants
                    WHERE user_id = {uid}
                ))"""
        )
    )
    bind.execute(
        sa.text(
            f"""CREATE POLICY np_conversation_participants_scope
                ON conversation_participants
                FOR ALL
                USING (user_id = {uid})
                WITH CHECK (user_id = {uid})"""
        )
    )
    bind.execute(
        sa.text(
            f"""CREATE POLICY np_attachments_scope ON attachments
                FOR ALL
                USING (message_id IN (
                    SELECT m.id FROM messages m
                    JOIN conversation_participants cp
                      ON cp.conversation_id = m.conversation_id
                    WHERE cp.user_id = {uid}
                ))
                WITH CHECK (message_id IN (
                    SELECT m.id FROM messages m
                    JOIN conversation_participants cp
                      ON cp.conversation_id = m.conversation_id
                    WHERE cp.user_id = {uid}
                ))"""
        )
    )
