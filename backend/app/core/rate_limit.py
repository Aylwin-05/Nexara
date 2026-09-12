"""
Fully-async rate limiting.

Uses Redis (INCR + EXPIRE) when REDIS_URL is configured,
otherwise falls back to an in-process sliding-window store —
fine for a single worker, and Redis is the production upgrade
path (zero code changes).

Usage (FastAPI):

    limiter = RateLimiter()
    await limiter.hit("otp.send", ip=request.client.host, email=email)
    -> raises RateLimitExceeded (HTTP 429)
"""

import asyncio
import logging
import time
from collections import defaultdict, deque

from app.core.config import settings

logger = logging.getLogger("app.core.rate_limit")

# ==========================================================
# Exceptions
# ==========================================================


class RateLimitExceeded(Exception):
    def __init__(self, retry_after: int):
        super().__init__("Too many requests.")
        self.retry_after = retry_after


# ==========================================================
# In-memory store (single worker)
# ==========================================================


class _MemoryStore:
    def __init__(self):
        self._buckets: dict[str, deque] = defaultdict(deque)
        self._lock = asyncio.Lock()

    async def incr_with_ttl(
        self,
        key: str,
        ttl_seconds: int,
    ) -> int:
        now = time.monotonic()
        async with self._lock:
            bucket = self._buckets[key]
            while bucket and now - bucket[0] > ttl_seconds:
                bucket.popleft()
            bucket.append(now)
            return len(bucket)

    async def peek_with_ttl(
        self,
        key: str,
        ttl_seconds: int,
    ) -> tuple[int, int]:
        """(count, seconds until the oldest entry ages out)."""

        now = time.monotonic()
        async with self._lock:
            bucket = self._buckets[key]
            while bucket and now - bucket[0] > ttl_seconds:
                bucket.popleft()
            if not bucket:
                return 0, ttl_seconds
            oldest = bucket[0]
            return len(bucket), max(1, round(ttl_seconds - (now - oldest)))


# ==========================================================
# Redis store (multi worker)
# ==========================================================


class _RedisStore:
    def __init__(self):
        self._client = None
        # In-process sliding window used when Redis is unreachable:
        # rate limiting degrades to per-worker instead of taking the
        # whole app down with 500s on every protected route. A single
        # Redis blip no longer disables limiting silently.
        self._memory_fallback = _MemoryStore()
        self._warned = False

    async def _get_client(self):
        # Use the shared, pooled Redis client so rate limiting and
        # the WebSocket bus never open unbounded separate
        # connections.
        from app.core.redis import get_redis_client

        if self._client is None:
            self._client = await get_redis_client()
        return self._client

    def _degraded(self, key: str) -> bool:
        if not self._warned:
            self._warned = True
            logger.error(
                "Redis unreachable: rate limiting degraded to "
                "in-process (per-worker) store for key=%r until "
                "Redis recovers.",
                key,
            )
        return True

    async def incr_with_ttl(
        self,
        key: str,
        ttl_seconds: int,
    ) -> int:
        try:
            client = await self._get_client()
            count = await client.incr(key)
            if count == 1:
                await client.expire(key, ttl_seconds)
            return count
        except Exception:
            self._degraded(key)
            return await self._memory_fallback.incr_with_ttl(
                key,
                ttl_seconds,
            )

    async def peek_with_ttl(
        self,
        key: str,
        ttl_seconds: int,
    ) -> tuple[int, int]:
        try:
            client = await self._get_client()
            count = await client.get(key)
            if count is None:
                return 0, ttl_seconds
            ttl = await client.ttl(key)
            if ttl < 0:
                ttl = ttl_seconds
            return int(count), max(1, ttl)
        except Exception:
            self._degraded(key)
            return await self._memory_fallback.peek_with_ttl(
                key,
                ttl_seconds,
            )


# ==========================================================
# Limiter
# ==========================================================


class RateLimiter:
    """Rate limiter with per-key counts over a rolling window."""

    def __init__(self):
        self._store = _RedisStore() if settings.REDIS_URL else _MemoryStore()

    async def check(
        self,
        key: str,
        limit: int,
        window_seconds: int,
    ) -> None:
        """Increment the counter for `key`; raise when over `limit`."""

        count = await self._store.incr_with_ttl(
            f"rl:{key}",
            window_seconds,
        )

        if count > limit:
            raise RateLimitExceeded(retry_after=window_seconds)

    async def remaining(
        self,
        key: str,
        limit: int,
        window_seconds: int,
    ) -> tuple[int, int]:
        """(requests still allowed, seconds until the window resets)."""

        count, retry_after = await self._store.peek_with_ttl(
            f"rl:{key}",
            window_seconds,
        )
        return max(0, limit - count), retry_after


_limiter: RateLimiter | None = None


def get_limiter() -> RateLimiter:
    global _limiter
    if _limiter is None:
        _limiter = RateLimiter()
    return _limiter


def reset_limiter():
    """Clear the shared limiter (used by tests between cases)."""

    global _limiter
    _limiter = None
