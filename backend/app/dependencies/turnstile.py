"""
Cloudflare Turnstile CAPTCHA verification dependency.

When TURNSTILE_SECRET_KEY is configured, every request that uses
this dependency must include a valid `cf-turnstile-response`
header.  When the key is empty (local dev), the check is skipped
so developers aren't blocked by CAPTCHA during testing.
"""

import logging

import httpx
from app.core.config import settings
from fastapi import HTTPException, Request

logger = logging.getLogger("app.dependencies.turnstile")

TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

# Fail-closed: if the secret is misconfigured, reject all
# requests rather than silently skipping the check.
_SKIP = settings.TURNSTILE_SECRET_KEY == ""


async def verify_turnstile(
    request: Request,
):
    """FastAPI dependency — verifies the Cloudflare Turnstile token."""

    if _SKIP:
        return

    token = request.headers.get("cf-turnstile-response", "")

    if not token:
        raise HTTPException(
            status_code=403,
            detail="CAPTCHA verification required.",
        )

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(
                TURNSTILE_VERIFY_URL,
                data={
                    "secret": settings.TURNSTILE_SECRET_KEY,
                    "response": token,
                    "remoteip": (request.client.host if request.client else ""),
                },
            )
            result = resp.json()

            if not result.get("success"):
                logger.warning(
                    "Turnstile verification failed: %s",
                    result.get("error-codes", []),
                )
                raise HTTPException(
                    status_code=403,
                    detail="CAPTCHA verification failed.",
                )

    except HTTPException:
        raise
    except Exception:
        logger.exception("Turnstile network error")
        raise HTTPException(
            status_code=503,
            detail="CAPTCHA service unavailable.",
        ) from None
