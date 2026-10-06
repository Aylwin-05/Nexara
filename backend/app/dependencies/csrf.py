from urllib.parse import urlsplit

from app.core.config import settings
from fastapi import HTTPException, Request


def cookie_origin_allowed(request: Request) -> bool:
    """SameSite=None cookies are usable cross-site, so cookie-auth
    routes must reject any request whose Origin/Referer is not ours.

    Browsers always send `Origin` on cross-site POSTs; curl and native
    apps send neither header and are accepted (they are not CSRF
    carriers). `Referer` is a fallback for the odd client that omits
    Origin on POST (e.g. old Safari form posts).
    """
    allowed = {
        o.strip()
        for o in settings.CORS_ORIGINS.split(",")
        if o.strip()
    }

    origin = request.headers.get("origin")
    if origin:
        return origin in allowed

    referer = request.headers.get("referer")
    if referer:
        ref = urlsplit(referer)
        return f"{ref.scheme}://{ref.netloc}" in allowed

    return True


async def verify_cookie_origin(request: Request) -> None:
    if not cookie_origin_allowed(request):
        raise HTTPException(
            status_code=403,
            detail="Cross-origin request rejected.",
        )
