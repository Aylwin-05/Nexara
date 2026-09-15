"""Enable Row-Level Security for conversation data (defense in depth).

WARNING — activation is a TWO-STEP operation, on purpose:

  STEP 1 (this migration): create the least-privilege app role,
  grant DB access, and enable RLS + FORCE ROW LEVEL SECURITY with
  participant-scoped policies on the conversation tables.

  STEP 2 (operational, NOT automatic): point the application at the
  app role and set its password:

      ALTER ROLE nexara_app LOGIN PASSWORD '...';
      -- backend/.env: DATABASE_URL=postgresql://nexara_app:...@localhost:5432/nexara

  RLS references `current_setting('app.current_user_id')`, which the
  app sets transaction-locally on every authenticated request (see
  app/dependencies/auth.py `get_current_user` and the WebSocket
  connect handler). Background worker connections that load rows
  OUTSIDE those request scopes (the message-purge loop, membership
  caches used for presence/broadcasts) must also set it, or they
  will see an empty dataset under the app role.

Tables deliberately left WITHOUT RLS (pre- / unauthenticated flows
reference them, and their existing query-layer scoping is sufficient):
users, otp_codes, refresh_tokens, conversations. Everything else is
covered by the grants only.
"""

import sqlalchemy as sa
from alembic import op

revision = "a2b4c6d8e0f1"
down_revision = "u1v3w5x7y9z1"
branch_labels = None
depends_on = None


def _uid():
    return "current_setting('app.current_user_id', true)::uuid"


def _member_scope():
    uid = _uid()

    return {
        "messages": sa.text(
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
        ),
        "conversation_participants": sa.text(
            f"""CREATE POLICY np_conversation_participants_scope
                ON conversation_participants
                FOR ALL
                USING (user_id = {uid})
                WITH CHECK (user_id = {uid})"""
        ),
        "attachments": sa.text(
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
        ),
    }


RLS_TABLES = (
    "messages",
    "conversation_participants",
    "attachments",
)


def upgrade() -> None:

    bind = op.get_bind()

    # Least-privilege app role (idempotent).
    bind.execute(
        sa.text(
            """
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nexara_app') THEN
                    CREATE ROLE nexara_app LOGIN
                        NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
                END IF;
            END
            $$;
            """
        )
    )

    bind.execute(sa.text("GRANT USAGE ON SCHEMA public TO nexara_app"))
    bind.execute(
        sa.text("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nexara_app")
    )
    bind.execute(sa.text("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nexara_app"))
    bind.execute(
        sa.text(
            """
            ALTER DEFAULT PRIVILEGES IN SCHEMA public
                GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nexara_app
            """
        )
    )

    for table in RLS_TABLES:
        bind.execute(sa.text(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY"))
        bind.execute(sa.text(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY"))

    for table, stmt in _member_scope().items():
        exists = bind.execute(
            sa.text("SELECT 1 FROM pg_policies WHERE policyname = :p"),
            {"p": f"np_{table}_scope"},
        ).first()
        if exists is None:
            bind.execute(stmt)


def downgrade() -> None:

    bind = op.get_bind()
    for table in RLS_TABLES:
        bind.execute(sa.text(f"DROP POLICY IF EXISTS np_{table}_scope ON {table}"))
        bind.execute(sa.text(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY"))
        bind.execute(sa.text(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY"))

    bind.execute(sa.text("DROP ROLE IF EXISTS nexara_app"))
