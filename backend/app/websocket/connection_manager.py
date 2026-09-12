import asyncio
import json
import logging
import time
from collections import defaultdict
from uuid import UUID

from app.database.session import AsyncSessionLocal
from app.websocket.redis_bus import bus as redis_bus
from fastapi import WebSocket

logger = logging.getLogger("app.websocket.connection_manager")

# A socket that stops draining (suspended/hidden tab) would otherwise
# block send() on flow control for as long as the TCP buffer is full,
# freezing REST endpoints that broadcast (edit/delete/reaction). Cap
# every send and drop the socket if it cannot keep up.
SEND_TIMEOUT_SECONDS = 3.0

# How long a ringing call_offer stays pending for offline members
# before it is dropped (matches a typical ring duration).
PENDING_CALL_TTL_SECONDS = 45


async def _send_payload(
    websocket: WebSocket,
    payload: dict,
):
    encoded = json.dumps(
        payload,
        default=str,
    )

    await asyncio.wait_for(
        websocket.send_text(encoded),
        timeout=SEND_TIMEOUT_SECONDS,
    )


class ConnectionManager:
    """
    User-scoped WebSocket connection manager.

    One socket per user (route /ws/me) receives events for ALL of
    that user's conversations, so the sidebar (presence dots, unread
    pills, conversation ordering) updates in real time too.
    """

    def __init__(self):
        # user_id -> list[WebSocket]
        self.user_connections = defaultdict(list)

        # user_id -> set of member user_ids sharing a conversation
        # with that user. Resolved once per connect (see
        # cache_user_members): presence fan-out then never stalls
        # behind a second database connection while the socket's
        # own session still holds an open transaction.
        self.user_members: dict[UUID, set[UUID]] = {}

        # user_id -> set of user_ids they blocked (either direction
        # of a block hides presence and blocks message delivery,
        # WhatsApp-style). Loaded once per connect like user_members.
        self.user_blocked: dict[UUID, set[UUID]] = {}
        self.user_blocked_by: dict[UUID, set[UUID]] = {}

        # user_id -> time.time() of their most recent connect.
        # Epoch (not monotonic) so it stays comparable with the
        # Redis presence registry when several workers serve
        # sockets. Presence snapshots only report peers who were
        # ALREADY online when the snapshot's user connected:
        # peers that connect later announce themselves in their
        # own connect broadcast, so echoing them here would be a
        # duplicate.
        self.user_connected_at: dict[UUID, float] = {}

        # call_id -> pending call_offer. Kept for PENDING_CALL_TTL so
        # a member whose socket was down (background tab, reconnect
        # gap) still receives the ringing offer when they (re)connect
        # instead of losing the call silently. Removed on call_end.
        self.pending_calls: dict[str, dict] = {}

    # ==========================================================
    # Connect
    # ==========================================================

    MAX_CONNECTIONS_PER_USER = 5

    async def connect_user(
        self,
        user_id: UUID,
        websocket: WebSocket,
    ):
        first_socket = not self.user_connections[user_id]

        if first_socket:
            self.user_connected_at[user_id] = (
                time.time()
            )

        # Prevent a single user from exhausting memory with
        # thousands of connections. Drop the oldest socket.
        if (
            len(self.user_connections[user_id])
            >= self.MAX_CONNECTIONS_PER_USER
        ):
            oldest = self.user_connections[user_id].pop(0)
            try:
                await oldest.close(code=1000)
            except Exception:
                pass

        self.user_connections[user_id].append(
            websocket
        )

        from app.metrics import set_gauge
        set_gauge(
            "active_ws_connections",
            sum(
                len(conns)
                for conns in self.user_connections.values()
            ),
        )

        if redis_bus.active and first_socket:
            try:
                await redis_bus.mark_online(
                    user_id,
                    self.user_connected_at[user_id],
                )
            except Exception as e:
                logger.warning(
                    "Presence registry write failed: %s", e
                )

        logger.debug(
            "WS connect: user=%s online=%s",
            user_id,
            list(self.user_connections.keys()),
        )

    # ==========================================================
    # Disconnect
    # ==========================================================

    async def disconnect_user(
        self,
        user_id: UUID,
        websocket: WebSocket,
    ):
        went_offline = False

        if user_id in self.user_connections:
            self.user_connections[user_id] = [
                ws
                for ws in self.user_connections[
                    user_id
                ]
                if ws != websocket
            ]

            if not self.user_connections[user_id]:
                del self.user_connections[user_id]
                self.user_connected_at.pop(
                    user_id,
                    None,
                )
                went_offline = True

        from app.metrics import set_gauge
        set_gauge(
            "active_ws_connections",
            sum(
                len(conns)
                for conns in self.user_connections.values()
            ),
        )

        if redis_bus.active and went_offline:
            # Only clear the shared registry when this node held
            # the user's last socket; another worker may still be
            # serving them.
            try:
                await redis_bus.mark_offline(user_id)
            except Exception as e:
                logger.warning(
                    "Presence registry delete failed: %s", e
                )

        logger.debug(
            "User disconnect: user=%s remaining=%s",
            user_id,
            list(self.user_connections.keys()),
        )

    # ==========================================================
    # Database-backed membership helpers
    # ==========================================================

    async def cache_user_members(
        self,
        user_id: UUID,
        db,
    ):
        # Runs on the CALLER's session (the websocket endpoint's
        # own session) so it never waits on a second connection.
        from app.models.conversation_participant import (
            ConversationParticipant,
        )
        from sqlalchemy import select

        member_ids = set()

        result = await db.execute(
            select(
                ConversationParticipant
            ).where(
                ConversationParticipant.user_id
                == user_id
            )
        )

        for participant in result.scalars().all():
            peers = await db.execute(
                select(
                    ConversationParticipant.user_id
                ).where(
                    ConversationParticipant.conversation_id
                    == participant.conversation_id
                )
            )
            member_ids.update(
                peers.scalars().all()
            )

        self.user_members[user_id] = member_ids

        from app.models.block import Block

        blocked_result = await db.execute(
            select(Block.blocked_id).where(
                Block.blocker_id == user_id
            )
        )

        self.user_blocked[user_id] = set(
            blocked_result.scalars().all()
        )

        blocked_by_result = await db.execute(
            select(Block.blocker_id).where(
                Block.blocked_id == user_id
            )
        )

        self.user_blocked_by[user_id] = set(
            blocked_by_result.scalars().all()
        )

        logger.debug(
            "WS members cached: user=%s members=%d",
            user_id,
            len(member_ids),
        )

    async def _member_ids(
        self,
        conversation_id: UUID,
        user_id: UUID | None = None,
    ):
        from app.models.conversation_participant import (
            ConversationParticipant,
        )
        from sqlalchemy import select
        from sqlalchemy import text

        # Enumerate peers from the caller's perspective. With no
        # user in hand (broadcast fan-out from system tasks) the
        # session runs in the maintenance 'system' scope the RLS
        # policies admit.
        async with AsyncSessionLocal() as db:
            if db.bind.dialect.name == "postgresql":
                await db.execute(
                    text(
                        "SELECT set_config('app.current_user_id', :uid, true)"
                    ),
                    {"uid": str(user_id) if user_id else "system"},
                )

            result = await db.execute(
                select(
                    ConversationParticipant.user_id
                ).where(
                    ConversationParticipant.conversation_id
                    == conversation_id
                )
            )

            return result.scalars().all()

    async def _user_conversation_ids(
        self,
        user_id: UUID,
    ):
        from app.models.conversation_participant import (
            ConversationParticipant,
        )
        from sqlalchemy import select
        from sqlalchemy import text

        async with AsyncSessionLocal() as db:
            if db.bind.dialect.name == "postgresql":
                await db.execute(
                    text(
                        "SELECT set_config('app.current_user_id', :uid, true)"
                    ),
                    {"uid": str(user_id)},
                )

            result = await db.execute(
                select(
                    ConversationParticipant.conversation_id
                ).where(
                    ConversationParticipant.user_id
                    == user_id
                )
            )

            return result.scalars().all()

    async def _peers_for(
        self,
        user_id: UUID,
    ):
        cached = self.user_members.get(user_id)

        if cached is not None:
            return cached

        conversation_ids = (
            await self._user_conversation_ids(user_id)
        )

        peers = set()

        for conversation_id in conversation_ids:
            peers.update(
                await self._member_ids(conversation_id)
            )

        self.user_members[user_id] = peers

        return peers

    async def _blocked_peers(
        self,
        user_id: UUID,
        cached_only: bool = False,
    ) -> set[UUID]:
        """
        User ids the given user must not interact with: everyone
        they blocked plus everyone who blocked them.

        ``cached_only`` skips the database and treats a missing
        cache as "no blocks".  It is used on the disconnect path,
        where opening an async DB session during teardown can
        deadlock against other sockets / session closes.
        """

        blocked = self.user_blocked.get(user_id)
        blocked_by = self.user_blocked_by.get(user_id)

        if blocked is None or blocked_by is None:

            if cached_only:
                return (
                    (blocked or set())
                    | (blocked_by or set())
                )

            from app.models.block import Block
            from sqlalchemy import select

            async with AsyncSessionLocal() as db:

                blocked_result = await db.execute(
                    select(Block.blocked_id).where(
                        Block.blocker_id == user_id
                    )
                )

                blocked_by_result = await db.execute(
                    select(Block.blocker_id).where(
                        Block.blocked_id == user_id
                    )
                )

                blocked = set(
                    blocked_result.scalars().all()
                )

                blocked_by = set(
                    blocked_by_result.scalars().all()
                )

                self.user_blocked[user_id] = blocked
                self.user_blocked_by[user_id] = blocked_by

        return blocked | blocked_by

    # ==========================================================
    # Block / membership caches
    # ==========================================================

    def drop_block_cache(self, user_id: UUID) -> None:
        """Drop the cached block sets (local only)."""

        self.user_blocked.pop(user_id, None)
        self.user_blocked_by.pop(user_id, None)

    def drop_member_cache(self, user_id: UUID) -> None:
        """Drop the cached conversation-peer set (local only)."""

        self.user_members.pop(user_id, None)

    async def invalidate_blocks(
        self,
        user_id: UUID,
    ) -> None:
        """Drop the cached block sets on EVERY worker.

        Called by the block/unblock endpoints: without this, a block
        (or unblock) made while both users' sockets stay connected
        kept silently filtering relays (messages AND calls) until the
        next reconnect.
        """

        self.drop_block_cache(user_id)

        if redis_bus.active:
            try:
                await redis_bus.publish_invalidate(
                    [user_id],
                    ["blocks"],
                )
            except Exception as e:
                logger.warning(
                    "Block-cache invalidation broadcast failed: %s",
                    e,
                )

    async def invalidate_members(
        self,
        user_ids,
    ) -> None:
        """Drop cached conversation-peer sets everywhere.

        Called when group membership changes: peers cached their
        member sets at connect time, so presence fan-out would
        miss the new/removed member until they reconnected.
        """

        for user_id in user_ids:
            self.drop_member_cache(user_id)

        if redis_bus.active:
            try:
                await redis_bus.publish_invalidate(
                    user_ids,
                    ["members"],
                )
            except Exception as e:
                logger.warning(
                    "Member-cache invalidation broadcast failed: %s",
                    e,
                )

    # ==========================================================
    # Pending calls
    #
    # With the bus active the registry lives in Redis (TTL =
    # ring window) so a reconnect landing on a DIFFERENT worker
    # still replays the offer; without it, the previous
    # per-process dict is used.
    # ==========================================================

    async def deliver_pending_calls(self, user_id: UUID) -> None:
        """Deliver ringing call offers the user missed while offline.

        Runs right after a socket (re)connects: every pending offer
        for a conversation the user belongs to is replayed, so an
        incoming call is never lost to a reconnect gap or a closed
        browser tab. Offers expire after PENDING_CALL_TTL_SECONDS
        (or when the caller hangs up).
        """

        if redis_bus.active:

            try:
                entries = await redis_bus.pending_calls()
            except Exception as e:
                logger.warning(
                    "Pending-call lookup failed: %s", e
                )
                return

            for entry in entries:
                members = await self._member_ids(
                    UUID(entry["conversation_id"]),
                    user_id=user_id,
                )

                if user_id in members:
                    await self.deliver_local(
                        user_id,
                        entry["payload"],
                    )

            return

        self._sweep_pending_calls()

        if not self.pending_calls:
            return

        for _call_id, pending in list(self.pending_calls.items()):

            members = await self._member_ids(
                UUID(pending["conversation_id"]),
                user_id=user_id,
            )

            if user_id in members:

                await self.deliver_local(
                    user_id,
                    pending["payload"],
                )

    async def store_pending_call(
        self,
        conversation_id: UUID,
        payload: dict,
    ) -> None:
        """Remember a ringing call_offer for offline members."""

        if redis_bus.active:
            try:
                await redis_bus.store_pending_call(
                    payload["call_id"],
                    str(conversation_id),
                    payload,
                    PENDING_CALL_TTL_SECONDS,
                )
            except Exception as e:
                logger.warning(
                    "Pending-call store failed: %s", e
                )
            return

        self._sweep_pending_calls()

        self.pending_calls[payload["call_id"]] = {
            "conversation_id": str(conversation_id),
            "payload": payload,
            "expires_at": (
                time.monotonic()
                + PENDING_CALL_TTL_SECONDS
            ),
        }

    async def drop_pending_call(self, call_id: str) -> None:
        """Forget a call that ended, was declined or was answered."""

        if redis_bus.active:
            try:
                await redis_bus.drop_pending_call(call_id)
            except Exception as e:
                logger.warning(
                    "Pending-call drop failed: %s", e
                )
            return

        self.pending_calls.pop(call_id, None)

    def connected_local_user_ids(self) -> set[UUID]:
        """Users with at least one socket on THIS worker."""

        return set(self.user_connections.keys())

    async def connected_user_ids(self) -> set[UUID]:
        """Users with at least one live socket, across all workers.

        Used to decide who gets a push fallback: an online user's
        own sockets already received the event.
        """

        if redis_bus.active:
            try:
                raw = await redis_bus.online_user_ids()
                return {
                    UUID(value)
                    for value in raw
                    if value
                }
            except Exception as e:
                logger.warning(
                    "Online-set lookup failed: %s", e
                )

        return set(self.user_connections.keys())

    def _sweep_pending_calls(self) -> None:
        """Drop offers whose ring window already elapsed."""

        if not self.pending_calls:
            return

        now = time.monotonic()

        expired = [
            call_id
            for call_id, pending in self.pending_calls.items()
            if pending["expires_at"] < now
        ]

        for call_id in expired:
            self.pending_calls.pop(call_id, None)

    # ==========================================================
    # Broadcast to a Conversation
    #
    # Resolves the conversation's members from the database and
    # delivers the event to every ONLINE device of each member,
    # no matter which conversations their sockets were opened for.
    # ==========================================================

    async def broadcast(
        self,
        conversation_id: UUID,
        message: dict,
        exclude_user_ids: set[UUID] | None = None,
    ):
        member_ids = await self._member_ids(
            conversation_id
        )

        if exclude_user_ids:

            member_ids = [
                member_id
                for member_id in member_ids
                if member_id not in exclude_user_ids
            ]

        for member_id in member_ids:
            await self.send_to_user(
                member_id,
                message,
            )

    async def broadcast_transient(
        self,
        conversation_id: UUID,
        message: dict,
    ):
        member_ids = await self._member_ids(
            conversation_id
        )

        for member_id in member_ids:
            await self.send_to_user(
                member_id,
                message,
            )

    # ==========================================================
    # Send to One User (all their devices)
    #
    # With the bus active the event is PUBLISHed to Redis and
    # every worker (this one included) delivers it to its own
    # sockets - a user's devices may be spread across workers.
    # If the publish fails, fall back to local delivery so a
    # Redis outage degrades instead of black-holing events.
    # ==========================================================

    async def send_to_user(
        self,
        user_id: UUID,
        message: dict,
    ):
        if redis_bus.active:
            try:
                await redis_bus.publish_user_event(
                    user_id,
                    message,
                )
                return
            except Exception as e:
                logger.warning(
                    "Redis publish failed (%s) - delivering locally.",
                    e,
                )

        await self.deliver_local(user_id, message)

    async def deliver_local(
        self,
        user_id: UUID,
        message: dict,
    ):
        if user_id not in self.user_connections:
            return

        logger.debug(
            "Sending %s to %d sockets of user %s",
            message.get("event"),
            len(self.user_connections[user_id]),
            user_id,
        )

        dead = []

        for websocket in self.user_connections[user_id]:
            try:
                await _send_payload(
                    websocket,
                    message,
                )

            except Exception as e:
                logger.warning(
                    "Dropping stuck socket: %s",
                    e,
                )
                dead.append(websocket)

        if dead:

            for ws in dead:

                await self.disconnect_user(
                    user_id,
                    ws,
                )

    # ==========================================================
    # Presence
    # ==========================================================

    async def is_online(
        self,
        user_id: UUID,
    ) -> bool:
        """Online status, valid across workers when the bus runs."""

        if redis_bus.active:
            try:
                return await redis_bus.is_online(user_id)
            except Exception as e:
                logger.warning(
                    "Presence lookup failed (%s) - using local state.",
                    e,
                )

        return (
            user_id in self.user_connections
            and len(self.user_connections[user_id]) > 0
        )

    async def _connected_at(
        self,
        user_id: UUID,
    ):
        """When the user's current online stretch began.

        Redis value (bus active) or the local dict; None when
        offline or unknown.
        """

        if redis_bus.active:
            try:
                return await redis_bus.connected_at(user_id)
            except Exception:
                return None

        return self.user_connected_at.get(user_id)

    async def broadcast_presence(
        self,
        user_id: UUID,
        online: bool,
        cached_only: bool = False,
    ):
        peers = await self._peers_for(user_id)

        hidden = await self._blocked_peers(
            user_id,
            cached_only=cached_only,
        )

        for peer_id in peers:
            if peer_id in hidden:
                continue

            await self.send_to_user(
                peer_id,
                {
                    "event": "presence",
                    "user_id": str(user_id),
                    "online": online,
                },
            )

    async def send_presence_snapshot(
        self,
        user_id: UUID,
    ):
        connected_at = await self._connected_at(user_id)

        if connected_at is None:
            return

        peers = await self._peers_for(user_id)

        hidden = await self._blocked_peers(user_id)

        for peer_id in peers:
            if peer_id in hidden:
                continue

            if not await self.is_online(peer_id):
                continue

            peer_connected_at = (
                await self._connected_at(peer_id)
            )

            # Only peers who were already online when this user
            # connected belong in the snapshot: a peer who connects
            # later announces themselves in their own connect
            # broadcast, so echoing them here would be a duplicate.
            if (
                peer_connected_at is None
                or peer_connected_at > connected_at
            ):
                continue

            await self.send_to_user(
                user_id,
                {
                    "event": "presence",
                    "user_id": str(peer_id),
                    "online": True,
                },
            )

    # ==========================================================
    # Utility Methods
    # ==========================================================

    def online_users(self):

        return list(
            self.user_connections.keys()
        )


manager = ConnectionManager()
