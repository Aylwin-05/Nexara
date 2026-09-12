"""Fix infinite recursion in the conversation-membership policies.

The policies shipped in b4d6f8h0j2l4 scoped rows to
`conversation_id IN (SELECT conversation_id FROM conversation_participants ...)`
inside the policy on `conversation_participants` ITSELF. Under FORCE RLS
Postgres re-applies the policy to that inner query, which re-triggers the
policy, and rejects the whole thing:

    infinite recursion detected in policy for relation
    "conversation_participants"

Every messages / participants / attachments query failed at runtime and the
disappearing-message purge loop died on each tick.

Fix: a `SECURITY DEFINER` membership function (`secure.is_conversation_member`).
It runs as its owner (the migration superuser), which bypasses RLS, so the
policy has no reason to re-enter itself. All three policies call the function
instead of embedding self-referencing subqueries. This is the standard Supabase
pattern for membership-style policies.

The function compares the uuid COLUMNS as text against text arguments, so it
is callable with the raw GUC value ('system' or '') without a `::uuid` cast
that Postgres may evaluate even when the `'system'` OR-branch holds.
"""

import sqlalchemy as sa

from alembic import op

revision = "d6f8h0j2l4"
down_revision = "b4d6f8h0j2l4"
branch_labels = None
depends_on = None


_UID = "COALESCE(current_setting('app.current_user_id', true), '')"
_MEMBER = "secure.is_conversation_member"


def _function() -> sa.text:
    return sa.text(
        """
        CREATE SCHEMA IF NOT EXISTS secure;

        CREATE OR REPLACE FUNCTION secure.is_conversation_member(
            cid text,
            uid text
        )
        RETURNS boolean
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        SET search_path = public
        AS $$
            SELECT EXISTS (
                SELECT 1
                FROM public.conversation_participants
                WHERE conversation_id::text = $1
                  AND user_id::text = $2
            )
        $$;

        REVOKE ALL ON FUNCTION secure.is_conversation_member(text, text)
            FROM PUBLIC;
        GRANT EXECUTE ON FUNCTION secure.is_conversation_member(text, text)
            TO nexara_app;
        """
    )


def _messages_scope() -> sa.text:
    return sa.text(
        f"""
        CREATE POLICY np_messages_scope ON messages
        FOR ALL
        USING ({_UID} = 'system' OR {_MEMBER}(conversation_id::text, {_UID}))
        WITH CHECK ({_MEMBER}(conversation_id::text, {_UID}))
        """
    )


def _participants_scope() -> sa.text:
    return sa.text(
        f"""
        CREATE POLICY np_conversation_participants_scope
        ON conversation_participants
        FOR ALL
        USING ({_UID} = 'system' OR {_MEMBER}(conversation_id::text, {_UID}))
        WITH CHECK ({_MEMBER}(conversation_id::text, {_UID}))
        """
    )


def _attachments_scope() -> sa.text:
    # Attachments have no sender_id; membership is determined through the
    # parent message's conversation.
    return sa.text(
        f"""
        CREATE POLICY np_attachments_scope ON attachments
        FOR ALL
        USING ({_UID} = 'system' OR EXISTS (
            SELECT 1 FROM messages m
            WHERE m.id = attachments.message_id
              AND {_MEMBER}(m.conversation_id::text, {_UID})
        ))
        WITH CHECK (EXISTS (
            SELECT 1 FROM messages m
            WHERE m.id = attachments.message_id
              AND {_MEMBER}(m.conversation_id::text, {_UID})
        ))
        """
    )


def upgrade() -> None:
    bind = op.get_bind()

    for table in ("messages", "conversation_participants", "attachments"):
        bind.execute(
            sa.text(f"DROP POLICY IF EXISTS np_{table}_scope ON {table}")
        )

    bind.execute(_function())

    for stmt in (
        _messages_scope(),
        _participants_scope(),
        _attachments_scope(),
    ):
        bind.execute(stmt)


def downgrade() -> None:
    # Restore the recursive b4d6f8h0j2l4 policies (broken state, kept only
    # to make the chain reversible). NOT recommended while nexara_app is live.
    bind = op.get_bind()
    uid = "COALESCE(current_setting('app.current_user_id', true), '')"

    for table in ("messages", "conversation_participants", "attachments"):
        bind.execute(
            sa.text(f"DROP POLICY IF EXISTS np_{table}_scope ON {table}")
        )

    bind.execute(
        sa.text(
            f"""CREATE POLICY np_messages_scope ON messages
                FOR ALL
                USING ({uid} = 'system' OR conversation_id IN (
                    SELECT conversation_id FROM conversation_participants
                    WHERE user_id::text = {uid}
                ))
                WITH CHECK (conversation_id IN (
                    SELECT conversation_id FROM conversation_participants
                    WHERE user_id::text = {uid}
                ))"""
        )
    )
    bind.execute(
        sa.text(
            f"""CREATE POLICY np_conversation_participants_scope
                ON conversation_participants
                FOR ALL
                USING ({uid} = 'system' OR conversation_id IN (
                    SELECT conversation_id FROM conversation_participants
                    WHERE user_id::text = {uid}
                ))
                WITH CHECK (conversation_id IN (
                    SELECT conversation_id FROM conversation_participants
                    WHERE user_id::text = {uid}
                ))"""
        )
    )
    bind.execute(
        sa.text(
            f"""CREATE POLICY np_attachments_scope ON attachments
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
                ))"""
        )
    )

    bind.execute(sa.text("DROP SCHEMA IF EXISTS secure CASCADE"))