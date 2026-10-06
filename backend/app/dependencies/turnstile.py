"""
Cloudflare Turnstile CAPTCHA verification dependency.

When TURNSTILE_SECRET_KEY is configured, every request that uses
this dependency must include a valid `cf-turnstile-response`
header.  The check is skipped ONLY in DEBUG when the key is empty
so developers aren't blocked by CAPTCHA during testing.  In
production the key is mandatory: a missing secret fails closed
(every request is rejected) rather than silently disabling bot
protection.
"""

import logging

import httpx
from app.core.config import settings
from fastapi import HTTPException, Request

logger = logging.getLogger("app.dependencies.turnstile")

TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

# Debug-only escape hatch; production always enforces the check.
_DEV_SKIP = settings.DEBUG and settings.TURNSTILE_SECRET_KEY == ""


async def verify_turnstile(
    request: Request,
):
    """FastAPI dependency — verifies the Cloudflare Turnstile token."""

    if _DEV_SKIP:
        return

    token = request.headers.get("cf-turnstile-response", "")

    # Fail-closed: a missing token OR a missing secret (misconfigured
    # production) rejects the request instead of skipping the check.
    if not token or settings.TURNSTILE_SECRET_KEY == "":
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
