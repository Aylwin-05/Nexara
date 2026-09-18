import asyncio
import logging
import time
from contextlib import asynccontextmanager

import sentry_sdk
from app.api.v1.api import api_router
from app.core.config import settings
from app.core.logging import setup_logging
from app.core.middleware import (
    MetricsMiddleware,
    RequestBodySizeLimitMiddleware,
    RequestIdMiddleware,
    SecurityHeadersMiddleware,
    get_metrics,
)
from app.database.session import AsyncSessionLocal, get_db
from app.dependencies.auth import get_current_user
from app.websocket.redis_bus import bus
from app.websocket.ws import router as websocket_router
from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

setup_logging()

logger = logging.getLogger("app.main")

# ==========================================================
# Sentry (observability)
# ==========================================================

if settings.SENTRY_DSN:
    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        environment=settings.APP_ENV,
        traces_sample_rate=0.1 if settings.APP_ENV == "production" else 1.0,
        profiles_sample_rate=0.1 if settings.APP_ENV == "production" else 1.0,
        integrations=[
            FastApiIntegration(),
            SqlalchemyIntegration(),
        ],
    )

# How often the background purge task runs (seconds).
PURGE_INTERVAL_SECONDS = 60


async def _disappearing_messages_loop():
    """Periodically hard-delete messages whose expiry has passed.

    Runs as a background task for the entire lifespan of the
    application.  Each tick opens a fresh session, calls
    ``purge_expired()``, and (when the bus is active) broadcasts
    a ``message_purged`` event so connected clients can evict
    the rows from their local caches.
    """

    from app.repositories.message_repository import (
        MessageRepository,
    )
    from app.websocket.connection_manager import manager

    # A lock ensures a slow tick can never overlap with the next
    # one (which could double-purge and emit duplicate broadcasts
    # under heavy load). Recovery code is idempotent so re-running
    # is harmless, but skipping the overlap keeps things tidy.
    purge_lock = asyncio.Lock()

    async def _tick():
        async with AsyncSessionLocal() as db:
            # Maintenance session: runs across ALL users' expiry
            # rows, so it adopts the 'system' scope the RLS
            # policies admit (see the RLS migration).
            if db.bind.dialect.name == "postgresql":
                from sqlalchemy import text

                await db.execute(text("SELECT set_config('app.current_user_id', 'system', true)"))

            repo = MessageRepository(db)
            purged = await repo.purge_expired()

            await db.commit()

        if purged and bus.active:
            from uuid import UUID

            conv_ids = {str(cid) for cid, _ in purged}
            msg_ids = {str(mid) for _, mid in purged}

            for cid in conv_ids:
                await manager.broadcast(
                    UUID(cid),
                    {
                        "event": "message_purged",
                        "conversation_id": cid,
                        "message_ids": list(msg_ids),
                    },
                )

        if purged:
            logger.info(
                "Disappearing-message purge: removed %d messages",
                len(purged),
            )

    while True:
        try:
            async with purge_lock:
                # Shield the DB work so a cancellation delivered at
                # teardown (purge_task.cancel()) never interrupts an
                # in-flight aiosqlite call. aiosqlite runs DB ops in
                # a separate thread; cancelling mid-call leaves that
                # thread's future unresolved and the TestClient / anyio
                # portal hangs forever joining it. With the shield the
                # CancelledError is deferred until the session exits
                # cleanly, then propagated.
                await asyncio.shield(_tick())
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Disappearing-message purge task failed")

        try:
            await asyncio.sleep(PURGE_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            raise


@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.websocket.connection_manager import manager

    await bus.start(manager)

    purge_task = asyncio.create_task(_disappearing_messages_loop())

    # Reclaim files orphaned by uploads that died between the disk
    # write and the DB commit (client abort / crash). Runs once at
    # boot and never in a hot loop: the boot has no concurrent
    # requests, and a moving background sweep risks racing active
    # uploads on a shared connection. Quarantine-cron style runs
    # should go in an external scheduler, not the app process.
    # ponytail: boot-only reclaim; add an external periodic job if
    # a single process runs for months and uploads abort often.
    try:
        from app.repositories.attachment_repository import (
            AttachmentRepository,
        )
        from app.services.attachment_service import (
            AttachmentService,
        )

        async with AsyncSessionLocal() as db:
            if db.bind.dialect.name == "postgresql":
                from sqlalchemy import text

                await db.execute(text("SELECT set_config('app.current_user_id', 'system', true)"))

            orphaned = await AttachmentService(AttachmentRepository(db)).sweep_orphaned_files()

        if orphaned:
            logger.info(
                "Startup attachment sweep: removed %d orphaned files",
                orphaned,
            )

    except Exception:
        logger.exception("Startup attachment sweep failed")

    try:
        yield
    finally:
        purge_task.cancel()
        try:
            await purge_task
        except asyncio.CancelledError:
            pass
        await bus.stop()

        from app.core.redis import close_redis_client

        await close_redis_client()


app = FastAPI(
    title="Nexara API",
    description=(
        "End-to-end encrypted messaging platform built with the "
        "Signal Protocol. Provides user authentication, real-time "
        "messaging via WebSockets, encrypted media attachments, "
        "stories, voice/video call ICE configuration, and "
        "disappearing messages — all backed by PostgreSQL, Redis, "
        "and a React + Vite frontend."
    ),
    version="1.0.0",
    debug=settings.DEBUG,
    redirect_slashes=False,
    lifespan=lifespan,
    contact={
        "name": "Nexara Team",
        "email": settings.SMTP_FROM_EMAIL,
        "url": "https://github.com/nexara",
    },
    license_info={
        "name": "MIT License",
        "url": "https://opensource.org/licenses/MIT",
    },
    servers=[
        {
            "url": "/",
            "description": "Current deployment",
        },
    ],
)

# ==========================================================
# CORS (env-driven)
# ==========================================================

origins = [origin.strip() for origin in settings.CORS_ORIGINS.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================================
# Host validation + hardening
# ==========================================================

app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=[host.strip() for host in settings.ALLOWED_HOSTS.split(",") if host.strip()],
)

app.add_middleware(
    SecurityHeadersMiddleware,
    enable_csp=not settings.DEBUG,
)

app.add_middleware(
    RequestIdMiddleware,
    logger=logger,
)

app.add_middleware(MetricsMiddleware)

app.add_middleware(
    RequestBodySizeLimitMiddleware,
    max_bytes=settings.MAX_REQUEST_BODY_SIZE,
)

# ==========================================================
# Global Exception Handlers (always JSON, never plain text)
# ==========================================================


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request,
    exc: RequestValidationError,
):
    errors = [
        {
            "field": ".".join(str(part) for part in error["loc"][1:]),
            "message": error["msg"],
        }
        for error in exc.errors()
    ]

    request_id = getattr(
        request.state,
        "request_id",
        None,
    )

    return JSONResponse(
        status_code=422,
        content={
            "detail": "Invalid request.",
            "errors": errors,
            "request_id": request_id,
        },
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(
    request: Request,
    exc: Exception,
):
    logger.exception(
        "Unhandled exception on %s %s: %s",
        request.method,
        request.url.path,
        exc,
    )

    if settings.SENTRY_DSN:
        sentry_sdk.capture_exception(exc)

    error_response = JSONResponse(
        status_code=500,
        content={
            "detail": "Internal server error.",
            "request_id": getattr(
                request.state,
                "request_id",
                None,
            ),
        },
    )
    return error_response


# ==========================================================
# Health check (load balancer / orchestrator probe)
# ==========================================================


@app.get("/healthz", tags=["ops"])
async def health_check():
    try:
        async with AsyncSessionLocal() as db:
            await db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False

    return JSONResponse(
        status_code=200 if db_ok else 503,
        content={
            "status": "healthy" if db_ok else "degraded",
            "database": "ok" if db_ok else "unreachable",
        },
    )


@app.get(
    "/metrics",
    tags=["ops"],
    dependencies=([] if settings.APP_ENV == "development" else [Depends(get_current_user)]),
)
async def metrics():
    return get_metrics()


# ==========================================================
# REST API Routes
# ==========================================================

app.include_router(
    api_router,
    prefix="/api/v1",
)

# ==========================================================
# WebSocket Routes
# ==========================================================

app.include_router(
    websocket_router,
)

# ==========================================================
# Root Endpoint
# ==========================================================


@app.get("/", tags=["System"])
async def root():
    return {
        "application": settings.APP_NAME,
        "version": "1.0.0",
        "status": "running",
        "docs": "/docs",
        "health": "/health",
        "websocket": "/ws/me",
    }


# ==========================================================
# Health Check
# ==========================================================


@app.get("/health", tags=["System"])
async def health(
    db: AsyncSession = Depends(get_db),
):
    from app.metrics import _start_time

    uptime = round(time.monotonic() - _start_time, 2)

    try:
        await db.execute(text("SELECT 1"))
        database_status = "connected"
        db_ok = True
    except Exception as e:
        logger.error("Health check DB probe failed: %s", e)
        database_status = "unreachable"
        db_ok = False

    redis_status = "connected"
    redis_ok = True
    try:
        from app.core.redis import get_redis_client

        client = await get_redis_client()
        if client is None:
            redis_status = "not_configured"
        else:
            await client.ping()
    except Exception as e:
        logger.warning("Health check Redis probe failed: %s", e)
        redis_status = "unreachable"
        redis_ok = False

    healthy = db_ok and redis_ok

    return JSONResponse(
        status_code=200 if healthy else 503,
        content={
            "status": "healthy" if healthy else "degraded",
            "uptime_seconds": uptime,
            "database": database_status,
            "redis": redis_status,
            "environment": settings.APP_ENV,
        },
    )
