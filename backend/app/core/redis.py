"""
Shared async Redis client with connection pooling.

Every Redis consumer (rate limiting, the cross-worker WebSocket
bus, presence) should request its client from here so all of them
reuse ONE connection pool instead of opening an unbounded number
of connections per component.
"""

import logging

from app.core.config import settings

logger = logging.getLogger("app.core.redis")

_client = None

# Latched, not timed. Once Redis has proven unreachable this process
# serves from the in-process stores and stops dialling Redis, because
# every dial costs a connect timeout: a dead Redis was adding ~2s to
# each rate-limited request (login, send-otp). The latch clears only
# on a successful probe, so recovering means starting Redis and
# restarting the backend - which is exactly the "one process, one
# start" story the boot probe below sets up.
_redis_down = False


def redis_marked_down() -> bool:
    """True once Redis has been proven unreachable in this process."""
    return _redis_down


def mark_redis_down(reason: str) -> None:
    global _redis_down

    if not _redis_down:
        _redis_down = True
        logger.warning(
            "Redis marked down (%s). Using in-process stores: rate "
            "limiting is per-worker and recovery tokens are not shared. "
            "Start Redis and restart the backend to restore them.",
            reason,
        )


async def probe_redis() -> bool:
    """Ping Redis once at boot and latch the verdict for this process."""
    global _redis_down

    if not settings.REDIS_URL:
        return False

    try:
        client = await get_redis_client()
        if client is None:
            return False
        await client.ping()
    except Exception as e:
        mark_redis_down(str(e))
        return False

    _redis_down = False
    logger.info("Redis reachable.")
    return True


async def get_redis_client():
    """Return a shared, lazily-created Redis client (connection pool)."""
    global _client

    if not settings.REDIS_URL or _redis_down:
        return None

    if _client is None:
        import redis.asyncio as aioredis

        _client = aioredis.from_url(
            settings.REDIS_URL,
            protocol=2,
            encoding="utf-8",
            decode_responses=True,
            max_connections=20,
            socket_connect_timeout=3,
            socket_timeout=3,
        )

    return _client


async def close_redis_client():
    """Close the shared client (used at app shutdown)."""
    global _client

    if _client is not None:
        try:
            await _client.aclose()
        except Exception:
            logger.warning("Error closing shared Redis client.", exc_info=True)
        _client = None
