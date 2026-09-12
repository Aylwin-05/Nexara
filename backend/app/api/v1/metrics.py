from app.core.config import settings
from app.dependencies.auth import get_current_user
from app.metrics import get_snapshot
from fastapi import APIRouter, Depends

router = APIRouter(
    prefix="/metrics",
    tags=["Observability"],
)


def _gate():
    # Development keeps metrics public so the HUD can poll live
    # telemetry from the browser; any other environment requires
    # an authenticated user.
    if settings.APP_ENV == "development":
        return []
    return [Depends(get_current_user)]


@router.get("", dependencies=_gate())
async def app_metrics():
    return get_snapshot()