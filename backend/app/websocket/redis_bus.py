"""
Cross-worker fan-out bus for the WebSocket layer.

The ConnectionManager is in-process state: with several uvicorn
workers a REST broadcast only reaches sockets held by THAT worker.
When REDIS_URL is configured this module bridges the gap:

  * every fan-out event is PUBLISHed to a shared channel
  * each worker subscribes and delivers to its LOCAL sockets
  * presence ("who is online") lives in short-TTL Redis keys,
    refreshed by a heartbeat, so nodes agree on online status
    even across reconnects and crashed workers
  * ring pending-calls live in Redis (TTL = ring window) so a
    reconnect landing on another worker still replays the offer

Without REDIS_URL everything degrades to the previous
single-worker behaviour (the bus simply stays inactive).
"""

import asyncio
import json
import logging

from app.core.config import settings
from app.core.redis import get_redis_client

logger = logging.getLogger("app.websocket.redis_bus")

CHANNEL = "nexara:ws:fanout"

ONLINE_PREFIX = "nexara:ws:online:"
CALL_PREFIX = "nexara:ws:call:"

# Online keys expire on their own so a crashed worker never
# leaves phantom "online" users behind; the heartbeat below
# keeps them alive while sockets are actually open.
ONLINE_TTL_SECONDS = 90
HEARTBEAT_INTERVAL_SECONDS = 30


class RedisBus:
    def __init__(self):
        self._client = None
        self._tasks: list[asyncio.Task] = []
        self._started = False
        # Set only after a successful subscribe; all routing
        # decisions key off this, not off the raw config value.
        self.active = False

    @property
    def enabled(self) -> bool:
        return settings.REDIS_URL is not None

    # ==========================================================
    # Lifecycle
    # ==========================================================

    async def start(self, manager) -> None:
        """Connect and spawn the listener / heartbeat tasks."""

        if self._started or not self.enabled:
            return

        self._started = True

        try:
            self._client = await get_redis_client()

            if self._client is None:
                self._client = None
                return

            pubsub = self._client.pubsub()
            await pubsub.subscribe(CHANNEL)

        except Exception as e:
            logger.warning(
                "Redis bus unavailable (%s) - WebSocket fan-out falls back to single-worker mode.",
                e,
            )
            self._client = None
            return

        self.active = True

        self._tasks = [
            asyncio.create_task(self._listener(pubsub, manager)),
            asyncio.create_task(self._heartbeat(manager)),
        ]

        logger.info("Redis bus active: cross-worker WS fan-out enabled.")

    async def stop(self) -> None:

        if not self._started:
            return

        self._started = False
        self.active = False

        for task in self._tasks:
            task.cancel()

        await asyncio.gather(
            *self._tasks,
            return_exceptions=True,
        )

        self._tasks.clear()

        # NOTE: we do NOT close the shared Redis client here —
        # other components (rate limiting) may still be using it.
        # The process-wide client is closed once at app shutdown.
        self._client = None

    # ==========================================================
    # Background tasks
    # ==========================================================

    async def _listener(self, pubsub, manager) -> None:

        while True:
            try:
                async for message in pubsub.listen():
                    if message["type"] != "message":
                        continue

                    await self._dispatch(
                        message["data"],
                        manager,
                    )

            except asyncio.CancelledError:
                raise

            except Exception as e:
                logger.warning(
                    "Redis bus listener error: %s - resubscribing.",
                    e,
                )
                await asyncio.sleep(2)

                try:
                    await pubsub.unsubscribe(CHANNEL)
                    await pubsub.subscribe(CHANNEL)
                except Exception:  # noqa: S110 - best-effort cleanup
                    pass

    async def _heartbeat(self, manager) -> None:

        while True:
            try:
                await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)

                user_ids = [str(user_id) for user_id in (manager.connected_local_user_ids())]

                if user_ids:
                    await self.refresh_online(user_ids)

            except asyncio.CancelledError:
                raise

            except Exception as e:
                logger.warning("Presence heartbeat failed: %s", e)

    async def _dispatch(self, raw, manager) -> None:

        try:
            envelope = json.loads(raw)

        except (TypeError, ValueError):
            return

        kind = envelope.get("t")

        if kind == "evt":
            user_id = envelope.get("u")
            payload = envelope.get("m")

            if user_id and isinstance(payload, dict):
                await manager.deliver_local(
                    uuid_from(user_id),
                    payload,
                )

        elif kind == "inv":
            kinds = set(envelope.get("k", []))

            for user_id in envelope.get("u", []):
                uid = uuid_from(user_id)

                if uid is None:
                    continue

                if "blocks" in kinds:
                    manager.drop_block_cache(uid)

                if "members" in kinds:
                    manager.drop_member_cache(uid)

    # ==========================================================
    # Publish
    # ==========================================================

    async def publish_user_event(
        self,
        user_id,
        message: dict,
    ) -> None:

        client = await get_redis_client()

        if client is None:
            return

        await client.publish(
            CHANNEL,
            json.dumps(
                {
                    "t": "evt",
                    "u": str(user_id),
                    "m": message,
                },
                default=str,
            ),
        )

    async def publish_invalidate(
        self,
        user_ids,
        kinds,
    ) -> None:

        client = await get_redis_client()

        if client is None:
            return

        await client.publish(
            CHANNEL,
            json.dumps(
                {
                    "t": "inv",
                    "u": [str(u) for u in user_ids],
                    "k": list(kinds),
                }
            ),
        )

    # ==========================================================
    # Presence registry
    #
    # Key: nexara:ws:online:<user_id> = epoch seconds of the
    # user's first live socket. The value doubles as the
    # "connected before me?" timestamp used by presence
    # snapshots, so it must survive TTL refreshes unchanged.
    # ==========================================================

    async def mark_online(
        self,
        user_id,
        connected_at: float,
    ) -> None:
        client = await get_redis_client()
        if client is None:
            return
        await client.set(
            f"{ONLINE_PREFIX}{user_id}",
            repr(connected_at),
            ex=ONLINE_TTL_SECONDS,
        )

    async def mark_offline(self, user_id) -> None:
        client = await get_redis_client()
        if client is None:
            return
        await client.delete(f"{ONLINE_PREFIX}{user_id}")

    async def refresh_online(
        self,
        user_ids: list[str],
    ) -> None:
        client = await get_redis_client()
        if client is None:
            return
        pipeline = client.pipeline()

        for user_id in user_ids:
            pipeline.expire(
                f"{ONLINE_PREFIX}{user_id}",
                ONLINE_TTL_SECONDS,
            )

        await pipeline.execute()

    async def is_online(self, user_id) -> bool:
        client = await get_redis_client()
        if client is None:
            return False
        return await client.exists(f"{ONLINE_PREFIX}{user_id}") > 0

    async def connected_at(self, user_id):
        client = await get_redis_client()
        if client is None:
            return None
        value = await client.get(f"{ONLINE_PREFIX}{user_id}")
        return float(value) if value else None

    async def online_user_ids(self) -> set:
        client = await get_redis_client()
        if client is None:
            return set()
        keys = [key async for key in (client.scan_iter(match=f"{ONLINE_PREFIX}*"))]

        return {key[len(ONLINE_PREFIX) :] for key in keys}

    # ==========================================================
    # Pending calls registry
    # ==========================================================

    async def store_pending_call(
        self,
        call_id: str,
        conversation_id: str,
        payload: dict,
        ttl_seconds: int,
    ) -> None:
        client = await get_redis_client()
        if client is None:
            return
        await client.set(
            f"{CALL_PREFIX}{call_id}",
            json.dumps(
                {
                    "conversation_id": conversation_id,
                    "payload": payload,
                },
                default=str,
            ),
            ex=ttl_seconds,
        )

    async def drop_pending_call(
        self,
        call_id: str,
    ) -> None:
        client = await get_redis_client()
        if client is None:
            return
        await client.delete(f"{CALL_PREFIX}{call_id}")

    async def pending_calls(self) -> list[dict]:
        client = await get_redis_client()
        if client is None:
            return []

        keys = [key async for key in (client.scan_iter(match=f"{CALL_PREFIX}*"))]

        entries = []

        for key in keys:
            raw = await client.get(key)
            if raw is None:
                continue
            try:
                entries.append(json.loads(raw))
            except (TypeError, ValueError):
                continue

        return entries

    # ==========================================================
    # Helpers
    # ==========================================================

    @property
    def client(self):
        return self._client


def uuid_from(value):
    from uuid import UUID

    try:
        return UUID(value)
    except (TypeError, ValueError, AttributeError):
        return None


bus = RedisBus()
