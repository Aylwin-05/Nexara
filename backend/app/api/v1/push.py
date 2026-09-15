import ipaddress
from urllib.parse import urlparse
from uuid import UUID

from app.database.session import get_db
from app.dependencies.auth import get_current_user
from app.dependencies.rate_limit import rate_limit
from app.models.push_subscription import PushSubscription
from app.models.user import User
from app.repositories.push_repository import PushRepository
from app.services.push_service import push_service
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(
    prefix="/push",
    tags=["Push Notifications"],
)


class SubscribeRequest(BaseModel):
    endpoint: str = Field(..., max_length=1000)

    p256dh: str = Field(..., max_length=512)

    auth: str = Field(..., max_length=256)


def _validate_push_endpoint(endpoint: str) -> None:
    """Reject endpoints that are not public HTTPS push providers.

    The server POSTs to this URL, so accepting arbitrary hosts
    would make it an open SSRF (internal services, cloud metadata,
    private networks). Push providers are always public HTTPS.
    """
    parsed = urlparse(endpoint)

    if parsed.scheme != "https":
        raise HTTPException(
            status_code=400,
            detail="Push endpoint must be an HTTPS URL.",
        )

    host = parsed.hostname

    if not host:
        raise HTTPException(
            status_code=400,
            detail="Invalid push endpoint.",
        )

    # IP literals: block private, loopback, link-local, multicast
    # and reserved ranges (e.g. http://169.254.169.254/...).
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        if (
            addr.is_private
            or addr.is_loopback
            or addr.is_link_local
            or addr.is_multicast
            or addr.is_reserved
            or addr.is_unspecified
        ):
            raise HTTPException(
                status_code=400,
                detail="Push endpoint must be publicly reachable.",
            )

    # Bare hostnames (no dot) are internal service names
    # (e.g. "backend", "redis") in a Docker network.
    if "." not in host:
        raise HTTPException(
            status_code=400,
            detail="Push endpoint must be a public hostname.",
        )


# ==========================================================
# VAPID public key (for the browser's PushManager.subscribe)
# ==========================================================


@router.get(
    "/vapid-public-key",
    dependencies=[
        rate_limit("push.vapid", 60, 60),
    ],
)
async def vapid_public_key():
    key = await push_service.get_vapid_public_key()
    return {"public_key": key}


# ==========================================================
# Subscribe this browser to push notifications
# ==========================================================


@router.post(
    "/subscribe",
    dependencies=[
        rate_limit("push.subscribe", 20, 60),
    ],
)
async def subscribe(
    request: SubscribeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _validate_push_endpoint(request.endpoint)

    repo = PushRepository(db)

    existing = await repo.get_subscriptions(current_user.id)

    for subscription in existing:
        if subscription.endpoint == request.endpoint:
            return {
                "id": str(subscription.id),
                "status": "existing",
            }

    if len(existing) >= 10:
        raise HTTPException(
            status_code=400,
            detail="Too many push subscriptions (max 10).",
        )

    subscription = PushSubscription(
        user_id=current_user.id,
        endpoint=request.endpoint,
        p256dh=request.p256dh,
        auth=request.auth,
    )

    await repo.add_subscription(subscription)
    await db.commit()

    return {
        "id": str(subscription.id),
        "status": "subscribed",
    }


# ==========================================================
# List my push subscriptions
# ==========================================================


@router.get(
    "/subscriptions",
    dependencies=[
        rate_limit("push.list", 30, 60),
    ],
)
async def list_subscriptions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    subscriptions = await PushRepository(db).get_subscriptions(current_user.id)

    return [
        {
            "id": str(subscription.id),
            "endpoint": subscription.endpoint,
            "created_at": (
                subscription.created_at.isoformat() if subscription.created_at else None
            ),
        }
        for subscription in subscriptions
    ]


# ==========================================================
# Unsubscribe a browser
# ==========================================================


@router.delete(
    "/subscriptions/{subscription_id}",
    dependencies=[
        rate_limit("push.unsubscribe", 30, 60),
    ],
)
async def unsubscribe(
    subscription_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        subscription_uuid = UUID(subscription_id)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid subscription id.",
        ) from None

    deleted = await PushRepository(db).delete_subscription(
        current_user.id,
        subscription_uuid,
    )

    await db.commit()

    if not deleted:
        raise HTTPException(
            status_code=404,
            detail="Subscription not found.",
        )

    return {"status": "unsubscribed"}
