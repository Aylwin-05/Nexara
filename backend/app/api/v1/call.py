import time
from datetime import UTC, datetime
from uuid import UUID

from app.core.config import settings
from app.database.session import get_db
from app.dependencies.auth import get_current_user
from app.dependencies.rate_limit import rate_limit
from app.models.call_log import CallLog
from app.models.user import User
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(
    prefix="/call",
    tags=["Calls"],
)


# ==========================================================
# WebRTC ICE configuration
#
# Returns the ICE servers the client should use for voice and
# video calls. Media itself is end-to-end encrypted on the
# client (insertable streams); TURN servers only relay opaque
# encrypted RTP packets, so they never see call content.
#
# In production you would mint short-lived TURN credentials
# per user here; this static config is safe to extend.
# ==========================================================


@router.get(
    "/config",
    dependencies=[
        rate_limit("call.config", 30, 60),
    ],
)
async def call_config(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):

    ice_servers = [
        {
            "urls": "stun:stun.l.google.com:19302",
        },
    ]

    turn_urls = [url.strip() for url in settings.TURN_URLS.split(",") if url.strip()]

    if turn_urls:
        ice_servers.append(
            {
                "urls": turn_urls,
                "username": _turn_username(current_user),
                "credential": _turn_credential(current_user),
            }
        )

    return {
        "ice_servers": ice_servers,
        "e2ee_supported": True,
    }


def _turn_username(user) -> str:
    """Per-user (or shared static) TURN username.

    With a TURN_SECRET configured coturn runs in REST mode
    (`use-auth-secret`), where the username embeds the expiry and no
    reversible password is ever issued. Without it, the shared static
    pair from settings is used, matching the classic long-term
    credentials setup.
    """
    if settings.TURN_SECRET:
        return f"{int(time.time()) + 3600}:{user.id}"
    return settings.TURN_USERNAME


def _turn_credential(user) -> str:
    import base64
    import hashlib
    import hmac

    if settings.TURN_SECRET:
        uname = _turn_username(user)
        digest = hmac.new(
            settings.TURN_SECRET.encode(),
            uname.encode(),
            hashlib.sha1,
        ).digest()
        return base64.b64encode(digest).decode()
    return settings.TURN_PASSWORD


# ==========================================================
# Call History
# ==========================================================


@router.post(
    "/log",
    dependencies=[
        rate_limit("call.log", 30, 60),
    ],
)
async def create_call_log(
    receiver_id: UUID,
    conversation_id: UUID | None = None,
    call_type: str = "voice",
    status: str = "missed",
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    log = CallLog(
        caller_id=current_user.id,
        receiver_id=receiver_id,
        conversation_id=conversation_id,
        call_type=call_type,
        status=status,
    )
    db.add(log)
    await db.commit()
    await db.refresh(log)

    return {"id": str(log.id), "status": log.status}


@router.put(
    "/{log_id}/end",
    dependencies=[
        rate_limit("call.end", 30, 60),
    ],
)
async def end_call_log(
    log_id: UUID,
    duration_seconds: int = 0,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(CallLog).where(CallLog.id == log_id))
    log = result.scalar_one_or_none()
    if not log:
        raise HTTPException(status_code=404, detail="Call log not found.")

    if log.caller_id != current_user.id and log.receiver_id != current_user.id:
        raise HTTPException(
            status_code=403,
            detail="Not authorized to update this call log.",
        )

    log.status = "answered"
    log.duration_seconds = duration_seconds
    log.ended_at = datetime.now(UTC)
    if not log.started_at:
        log.started_at = log.ended_at

    await db.commit()
    return {"success": True}


@router.get("/logs")
async def get_call_logs(
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(CallLog)
        .where((CallLog.caller_id == current_user.id) | (CallLog.receiver_id == current_user.id))
        .order_by(CallLog.created_at.desc())
        .limit(min(limit, 100))
    )

    result = await db.execute(stmt)
    logs = result.scalars().all()

    peer_ids = {
        log.receiver_id if log.caller_id == current_user.id else log.caller_id for log in logs
    }
    peers: dict[UUID, User] = {}
    if peer_ids:
        peer_result = await db.execute(select(User).where(User.id.in_(peer_ids)))
        peers = {peer.id: peer for peer in peer_result.scalars().all()}

    calls = []
    for log in logs:
        peer_id = log.receiver_id if log.caller_id == current_user.id else log.caller_id
        peer = peers.get(peer_id)
        calls.append(
            {
                "id": str(log.id),
                "caller_id": str(log.caller_id),
                "receiver_id": str(log.receiver_id),
                "conversation_id": str(log.conversation_id) if log.conversation_id else None,
                "call_type": log.call_type,
                "status": log.status,
                "duration_seconds": log.duration_seconds,
                "started_at": log.started_at.isoformat() if log.started_at else None,
                "ended_at": log.ended_at.isoformat() if log.ended_at else None,
                "created_at": log.created_at.isoformat() if log.created_at else None,
                "peer_id": str(peer_id),
                "peer_display_name": (peer.display_name if peer else str(peer_id)),
                "peer_avatar_url": (peer.avatar_url if peer else None),
            }
        )

    return {
        "calls": calls,
        "count": len(logs),
    }
