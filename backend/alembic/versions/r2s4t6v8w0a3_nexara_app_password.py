"""Set the least-privilege app role's password at migrate time.

`nexara_app` is created by a2b4c6d8e0f1_enable_rls_scripts.py as LOGIN
but with NO password, so the application could never connect as it
(the documented "STEP 2" activation was manual and never done). The
post-boot switch to the privileged role was abandoned for the RLS proof
that `smoke_rls.py` verifies under `nexara_app`. This migration closes
that gap: the production migration job injects NEXARA_APP_PASSWORD and
this sets it (idempotent ALTER ROLE). Skipped when the env var is
absent (dev, or operators set the password out-of-band).

Revision ID: r2s4t6v8w0a3
Revises: p1q3r5s7t9u1
Create Date: 2026-10-04

"""

import os

import sqlalchemy as sa
from alembic import op

revision = "r2s4t6v8w0a3"
down_revision = "p1q3r5s7t9u1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    password = os.environ.get("NEXARA_APP_PASSWORD")
    if password:
        # Operator-controlled env var; escape quotes for the DDL literal.
        escaped = password.replace("'", "''")
        op.execute(sa.text(f"ALTER ROLE nexara_app LOGIN PASSWORD '{escaped}'"))


def downgrade() -> None:
    # Cannot restore a password unknown to us; the role stays as-is.
    pass
