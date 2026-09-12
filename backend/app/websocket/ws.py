import asyncio
import logging
from uuid import UUID

from app.core.rate_limit import RateLimitExceeded
from app.database.session import AsyncSessionLocal
from app.dependencies.websocket_auth import websocket_auth
from app.models.user import User
from app.repositories.auth_repository import AuthRepository
from app.websocket.connection_manager import manager
from app.websocket.websocket_service import WebSocketService
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import text

logger = logging.getLogger("app.websocket.ws")

router = APIRouter()


@router.websocket("/ws/me")
async def websocket_endpoint(
    websocket: WebSocket,
):
    """
    User-scoped WebSocket Endpoint.

    One socket per user receives events for ALL of the user's
    conversations (messages, typing, receipts, edits, deletes,
    reactions, attachments, presence), so every part of the UI -
    including the sidebar - updates in real time.
    """

    # ==========================================================
    # Authenticate
    # ==========================================================

    payload, subprotocol = (
        await websocket_auth.authenticate(
            websocket
        )
    )

    if payload is None:
        return

    user_id = UUID(payload["sub"])

    # ==========================================================
    # Database Session
    # ==========================================================

    async with AsyncSessionLocal() as db:

        auth_repository = AuthRepository(db)

        current_user: User | None = (
            await auth_repository.get_user_by_id(
                user_id
            )
        )

        if current_user is None:
            await websocket.close(code=1008)
            return

        # Match the HTTP path: a deactivated account is not allowed
        # to keep an event stream open even though its token is valid.
        if not current_user.is_active:
            await websocket.close(code=1008)
            return

        # Match the HTTP path: a token issued before the last logout /
        # deactivation is rejected even though it has not expired yet.
        if current_user.session_version != payload.get("ver"):
            await websocket.close(code=1008)
            return

        # Publish the user to the transaction-local GUC so Row-Level
        # Security policies scope reads in this socket's session (RLS
        # migration); a no-op under the superuser role and on SQLite.
        if db.bind.dialect.name == "postgresql":
            await db.execute(
                text("SELECT set_config('app.current_user_id', :uid, true)"),
                {"uid": str(user_id)},
            )

        # Plain snapshots: a rollback in the error handlers expires
        # every ORM object in the session, so touching current_user
        # in the finally/except blocks below would raise
        # MissingGreenlet and kill the socket. These values are
        # loaded now and never expire.
        user_id = current_user.id
        user_email = current_user.email

        websocket_service = WebSocketService(db)

        # ======================================================
        # Accept Handshake (echo validated subprotocol)
        # ======================================================

        await websocket.accept(subprotocol=subprotocol)

        # ======================================================
        # Connect
        # ======================================================

        await manager.connect_user(
            current_user.id,
            websocket,
        )

        # Resolve this user's conversation peers NOW, on this
        # session (no open transaction yet). Everything below -
        # including the disconnect broadcast - then uses the
        # cached membership instead of opening a second database
        # connection that could stall behind this long-lived
        # session's open transaction.
        await manager.cache_user_members(
            current_user.id,
            db,
        )

        # Notify current client
        await websocket.send_json(
            {
                "event": "connected",
                "user_id": str(current_user.id),
            }
        )

        # Replay any ringing call offers this user missed while
        # offline (closed tab, reconnect gap) so the incoming-call
        # UI always shows up instead of being silently lost.
        await manager.deliver_pending_calls(
            current_user.id
        )

        # Notify everyone sharing a conversation with this user
        await manager.broadcast_presence(
            current_user.id,
            True,
        )

        # Tell this client who of their peers is already online
        await manager.send_presence_snapshot(
            current_user.id,
        )

        logger.info(
            "WS connected: user=%s",
            current_user.email,
        )

        # ======================================================
        # Main Loop
        #
        # Error handling lives INSIDE the loop: a single bad event
        # (bad payload, unknown event, denied access) replies with
        # an "error" frame and the connection keeps serving the
        # next event. Only a client disconnect stops the loop.
        # ======================================================

        try:

            while True:

                data = await websocket.receive_json()

                if not isinstance(data, dict):

                    await websocket.send_json(
                        {
                            "event": "error",
                            "message": "Invalid payload: expected JSON object.",
                        }
                    )

                    continue

                try:

                    await websocket_service.handle_event(
                        websocket=websocket,
                        current_user=current_user,
                        data=data,
                    )

                    # The websocket session is otherwise held open
                    # for the whole connection lifetime: any handler
                    # write (read/delivered receipts, edit, delete)
                    # would stay in an open transaction and keep its
                    # PostgreSQL row locks until the socket closes -
                    # blocking REST updates on the same message
                    # (e.g. edit) forever. Commit after every event
                    # to release them promptly.
                    await db.commit()

                except RateLimitExceeded as e:

                    try:
                        await db.rollback()
                    except Exception:
                        pass

                    try:
                        fresh_user = await db.get(User, user_id)
                        if fresh_user is not None:
                            current_user = fresh_user
                    except Exception:
                        pass

                    await websocket.send_json(
                        {
                            "event": "error",
                            "message": "Rate limit exceeded.",
                            "retry_after": e.retry_after,
                        }
                    )

                except ValueError as e:

                    # rollback ends the transaction AND expires
                    # every ORM object in the session (including
                    # current_user): re-load it so the next event
                    # can still use it.
                    try:
                        await db.rollback()
                    except Exception:
                        pass

                    try:
                        fresh_user = await db.get(User, user_id)
                        if fresh_user is not None:
                            current_user = fresh_user
                    except Exception:
                        pass

                    await websocket.send_json(
                        {
                            "event": "error",
                            "message": str(e),
                        }
                    )

                except Exception as e:

                    logger.exception(
                        "WebSocket error for user=%s: %s",
                        user_email,
                        e,
                    )

                    try:
                        await db.rollback()
                    except Exception:
                        pass

                    try:
                        fresh_user = await db.get(User, user_id)
                        if fresh_user is not None:
                            current_user = fresh_user
                    except Exception:
                        pass

                    try:

                        await websocket.send_json(
                            {
                                "event": "error",
                                "message": "Internal server error.",
                            }
                        )

                    except Exception:
                        pass

        except WebSocketDisconnect:

            logger.info(
                "WS disconnected: user=%s",
                user_email,
            )

        finally:

            await manager.disconnect_user(
                user_id,
                websocket,
            )

            # The TestClient cancels the websocket task immediately
            # after the client sends its close frame, right as this
            # finally block runs: an unguarded await would be
            # cancelled before the offline event reached a single
            # peer. Shield the broadcast - it is in-memory now
            # (cached membership), so it completes either way - and
            # swallow the teardown CancelledError.
            try:

                await asyncio.shield(
                    manager.broadcast_presence(
                        user_id,
                        False,
                        cached_only=True,
                    )
                )

            except asyncio.CancelledError:

                pass


@router.websocket("/ws/ping")
async def websocket_ping(
    websocket: WebSocket,
):
    """
    Unauthenticated health probe for the real-time layer.

    The HUD keeps this socket open and sends ``ping``; the server
    answers ``pong``.  It verifies end-to-end that uvicorn can
    accept and service websockets without requiring a user session.
    """
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
            elif data in ("quit", "close"):
                await websocket.close(code=1000)
                return
    except WebSocketDisconnect:
        pass
