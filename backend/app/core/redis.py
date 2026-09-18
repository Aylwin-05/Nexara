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


async def get_redis_client():
    """Return a shared, lazily-created Redis client (connection pool)."""
    global _client

    if not settings.REDIS_URL:
        return None

    if _client is None:
        import redis.asyncio as aioredis

        _client = aioredis.from_url(
            settings.REDIS_URL,
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
