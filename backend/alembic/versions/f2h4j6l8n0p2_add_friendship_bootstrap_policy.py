"""Authorize participant bootstrap via accepted friendship.

The participants policy created in d6f8h0j2l4 scopes inserts with

    WITH CHECK (secure.is_conversation_member(conversation_id, uid))

That is chicken-and-egg for the CREATE path: the very first rows of a
conversation (the creator's own bootstrap row plus the peer in a private
chat) are inserted when the table has NO rows, so is_conversation_member
is always FALSE and every create fails with an RLS/500. The 'system'
scope cannot blanket this path: create_private_conversation has no
service-side friendship check, so 'system' would let any user open a DM
against any UUID.

Fix: gate the bootstrap on friendship, DB-authoritatively)Skip. Both
friendships and conversations have RLS OFF (relrowsecurity = f), so a
SECURITY DEFINER helper reading them cannot recurse — this is the same
non-recursive trick secure.is_conversation_member already uses. The
creator may insert themselves and their ACCEPTED friends while
bootstrapping a conversation they created; afterwards the existing
membership policy takes over.
"""

import sqlalchemy as sa

from alembic import op

revision = "f2h4j6l8n0p2"
down_revision = "e1f2h6j0l8n2"
branch_labels = None
depends_on = None

_UID = "COALESCE(current_setting('app.current_user_id', true), '')"
_MEMBER = "secure.is_conversation_member"
_ACCEPTED = "secure.is_accepted_friend"

GRANTS = f"""
    REVOKE ALL ON FUNCTION {_ACCEPTED}(text, text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION {_ACCEPTED}(text, text) TO nexara_app;
"""


def _accepted_friend_function() -> sa.text:
    return sa.text(
        f"""
        CREATE SCHEMA IF NOT EXISTS secure;

        -- Mirrors secure.is_conversation_member (SECURITY DEFINER, no RLS
        -- on friendships) so the participants policy can authorize the
        -- bootstrap insert without recursing into itself.
        CREATE OR REPLACE FUNCTION secure.is_accepted_friend(
            uid_a text,
            uid_b text
        )
        RETURNS boolean
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        SET search_path = public
        AS $$
            SELECT EXISTS (
                SELECT 1
                FROM public.friendships
                WHERE status = 'accepted'
                  AND (
                          (sender_id::text = $1 AND receiver_id::text = $2)
                       OR (sender_id::text = $2 AND receiver_id::text = $1)
                      )
            )
        $$;

        {GRANTS}
        """
    )


def _participants_scope() -> sa.text:
    return sa.text(
        f"""
        DROP POLICY IF EXISTS np_conversation_participants_scope
            ON conversation_participants;

        CREATE POLICY np_conversation_participants_scope
        ON conversation_participants
        FOR ALL
        USING ({_UID} = 'system' OR {_MEMBER}(conversation_id::text, {_UID}))
        WITH CHECK (
            {_UID} = 'system'
            OR {_MEMBER}(conversation_id::text, {_UID})
            OR (
                -- Bootstrap: the conversation's creator adds themselves and
                -- their accepted friends while creating it. After the first
                -- rows exist the membership branch above takes over, and the
                -- 'system' branch covers server-authorized writes (purge,
                -- push fan-out, invite-link join).
                conversation_id IN (
                    SELECT c.id FROM conversations c
                    WHERE c.created_by::text = {_UID}
                )
                AND (user_id::text = {_UID}
                     OR {_ACCEPTED}({_UID}, user_id::text))
            )
        )
        """
    )


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(_accepted_friend_function())
    bind.execute(_participants_scope())


def downgrade() -> None:
    bind = op.get_bind()

    bind.execute(
        sa.text(
            f"""
            DROP POLICY IF EXISTS np_conversation_participants_scope
                ON conversation_participants;
            """
        )
    )
    bind.execute(
        sa.text(
            f"""
            CREATE POLICY np_conversation_participants_scope
            ON conversation_participants
            FOR ALL
            USING ({_UID} = 'system' OR {_MEMBER}(conversation_id::text, {_UID}))
            WITH CHECK ({_MEMBER}(conversation_id::text, {_UID}))
            """
        )
    )
