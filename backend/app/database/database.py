from app.core.config import settings
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import Session

# ==========================================================
# Database URL
# ==========================================================

DATABASE_URL = settings.DATABASE_URL.replace(
    "postgresql://",
    "postgresql+asyncpg://",
)

# ==========================================================
# Async Engine
# ==========================================================

engine = create_async_engine(
    DATABASE_URL,
    echo=settings.DEBUG,
    future=True,
    pool_pre_ping=True,
    pool_recycle=300,
    pool_size=20,
    max_overflow=40,
)

# ==========================================================
# Session Factory
# ==========================================================

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
)


# ==========================================================
# Row-Level Security scope
# ==========================================================

# The auth dependency stores the authenticated user id in
# session.info["rls_user_id"]. Re-publish it as the transaction-
# local GUC app.current_user_id whenever a transaction begins.
#
# Why here and not once at auth time: services commit mid-request,
# and a commit ends the transaction and can release the pooled
# connection; the next statement may run on a different (or reset)
# connection with no GUC, making RLS-filtered rows invisible and
# breaking post-commit reads (e.g. db.refresh after a send).
# Re-applying on every begin keeps the whole request correctly
# scoped. Transaction-local (is_local=true) means the value is
# wiped at commit and never leaks to the next pool user.
# SQLite (tests) has no set_config and is skipped.
@event.listens_for(Session, "after_begin")
def _publish_rls_user(session, transaction, connection) -> None:

    user_id = session.info.get("rls_user_id")

    if user_id and connection.dialect.name == "postgresql":
        connection.execute(
            text("SELECT set_config('app.current_user_id', :uid, true)"),
            {"uid": user_id},
        )

