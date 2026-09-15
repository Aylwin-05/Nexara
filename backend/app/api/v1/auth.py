import logging
from pathlib import Path
from uuid import UUID

from app.core.config import settings
from app.core.file_config import AVATAR_DIR
from app.core.ip_utils import resolve_client_ip
from app.core.rate_limit import (
    RateLimitExceeded,
    get_limiter,
)
from app.database.session import get_db
from app.dependencies.auth import get_current_user
from app.dependencies.rate_limit import rate_limit
from app.dependencies.turnstile import verify_turnstile
from app.models.attachment import Attachment
from app.models.message import Message
from app.models.otp import OTPCode
from app.models.story import Story
from app.models.user import User
from app.repositories.auth_repository import AuthRepository
from app.repositories.refresh_token_repository import (
    RefreshTokenError,
    RefreshTokenRepository,
)
from app.schemas.auth import (
    DisableTwoFARequest,
    EnableTwoFARequest,
    MessageResponse,
    ResetTwoFARequest,
    SendOTPRequest,
    TokenResponse,
    TwoFAStatusResponse,
    VerifyOTPRequest,
    VerifyTwoFARequest,
)
from app.services.auth_service import AuthService
from app.services.jwt_service import JWTService
from app.services.refresh_token_service import RefreshTokenService
from app.websocket.connection_manager import (
    manager as ws_manager,
)
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    Request,
    Response,
)
from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/auth",
    tags=["Authentication"],
)

# ==========================================================
# Cookies
# ==========================================================

REFRESH_COOKIE_NAME = "cc_refresh"


def _set_refresh_cookie(
    response: Response,
    token: str,
):
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path="/",
        domain=settings.COOKIE_DOMAIN,
    )


def _clear_refresh_cookie(response: Response):
    response.delete_cookie(
        key=REFRESH_COOKIE_NAME,
        path="/",
        domain=settings.COOKIE_DOMAIN,
    )


def _client_ip(request: Request) -> str:
    return resolve_client_ip(request)


def _extract_refresh_token(
    request: Request,
    body_token: str | None,
) -> str:
    """Prefer the HttpOnly cookie; accept the body for mobile clients."""

    token = request.cookies.get(REFRESH_COOKIE_NAME)
    return token or body_token or ""


# ==========================================================
# Send OTP
# ==========================================================


@router.post(
    "/send-otp",
    response_model=MessageResponse,
    dependencies=[
        rate_limit("otp.send.ip", 50, 600),
        Depends(verify_turnstile),
    ],
)
async def send_otp(
    request: Request,
    request_body: SendOTPRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):

    repository = AuthRepository(db)

    service = AuthService(repository)

    # Per-email throttle: an attacker must not burn an account's
    # inbox (or the DB row) faster than the IP can.
    try:
        await get_limiter().check(
            f"otp.send.{request_body.email.lower()}",
            3,
            600,
        )

    except RateLimitExceeded as exc:
        raise HTTPException(
            status_code=429,
            detail="Too many requests. Try again later.",
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc

    await service.send_otp(
        request_body.email,
        client_ip=_client_ip(request),
        background_tasks=background_tasks,
    )

    return MessageResponse(
        success=True,
        message="OTP sent successfully.",
    )


# ==========================================================
# Verify OTP
# ==========================================================


@router.post(
    "/verify-otp",
    dependencies=[
        rate_limit("otp.verify.ip", 50, 600),
        Depends(verify_turnstile),
    ],
)
async def verify_otp(
    request: Request,
    response: Response,
    request_body: VerifyOTPRequest,
    db: AsyncSession = Depends(get_db),
):

    repository = AuthRepository(db)

    service = AuthService(repository)

    result = await service.verify_otp(
        request_body.email,
        request_body.otp,
    )

    if result is None:
        raise HTTPException(
            status_code=400,
            detail="Invalid or expired OTP.",
        )

    user = result["user"]
    logger.info(
        "OTP verified successfully: user=%s email=%s",
        user.id,
        user.email,
    )

    # ----------------------------------------------------------
    # Two-step verification is enabled: do NOT issue tokens yet.
    # The client must present the 6-digit PIN with a short-lived
    # two_fa token (issued here) within its 10-minute window.
    # ----------------------------------------------------------

    if user.two_fa_enabled:
        jwt = JWTService()

        two_fa_token = jwt.create_two_fa_token(
            user_id=str(user.id),
            email=user.email,
        )

        return {
            "two_fa_required": True,
            "two_fa_token": two_fa_token,
            "email": user.email,
        }

    jwt = JWTService()

    access_token = jwt.create_access_token(
        user_id=str(user.id),
        email=user.email,
        ver=user.session_version,
    )

    # -- issue + persist refresh token (rotation-enabled) ---------
    refresh_service = RefreshTokenService(RefreshTokenRepository(db))

    refresh_token = await refresh_service.issue(
        user.id,
        user_agent=request.headers.get("user-agent"),
        ip_address=_client_ip(request),
    )

    _set_refresh_cookie(response, refresh_token)

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=user,
    )


# ==========================================================
# 2FA: Status
# ==========================================================


@router.get(
    "/two-fa/status",
    response_model=TwoFAStatusResponse,
)
async def two_fa_status(
    current_user=Depends(get_current_user),
):
    return {
        "two_fa_enabled": bool(current_user.two_fa_enabled),
    }


# ==========================================================
# 2FA: Enable (set the 6-digit PIN)
# ==========================================================


@router.put(
    "/two-fa",
    response_model=TwoFAStatusResponse,
    dependencies=[
        rate_limit("auth.two_fa", 10, 300),
    ],
)
async def enable_two_fa(
    request_body: EnableTwoFARequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):

    if request_body.pin != request_body.confirm_pin:
        raise HTTPException(
            status_code=400,
            detail="The PINs do not match.",
        )

    repository = AuthRepository(db)

    service = AuthService(repository)

    return await service.enable_two_fa(
        current_user,
        request_body.pin,
    )


# ==========================================================
# 2FA: Disable (requires the current PIN)
# ==========================================================


@router.delete(
    "/two-fa",
    response_model=TwoFAStatusResponse,
    dependencies=[
        rate_limit("auth.two_fa", 10, 300),
    ],
)
async def disable_two_fa(
    request_body: DisableTwoFARequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):

    repository = AuthRepository(db)

    service = AuthService(repository)

    try:
        return await service.disable_two_fa(
            current_user,
            request_body.pin,
        )

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        ) from error


# ==========================================================
# 2FA: Complete Login with PIN
# ==========================================================


@router.post(
    "/two-fa/verify",
    dependencies=[
        rate_limit("auth.two_fa.verify", 10, 300),
    ],
)
async def verify_two_fa(
    request: Request,
    response: Response,
    request_body: VerifyTwoFARequest,
    db: AsyncSession = Depends(get_db),
):

    jwt = JWTService()

    payload = jwt.verify_two_fa_token(request_body.two_fa_token)

    if payload is None:
        raise HTTPException(
            status_code=401,
            detail="This login session has expired. Please request a new code.",
        )

    email = payload["email"]

    # Per-user PIN attempt lockout: max 5 attempts per 10 minutes
    pin_max_attempts = 5
    pin_window_seconds = 600
    try:
        await get_limiter().check(
            f"twofa.pin.{email.lower()}",
            pin_max_attempts,
            pin_window_seconds,
        )
    except RateLimitExceeded as exc:
        logger.warning(
            "2FA PIN lockout triggered: email=%s",
            email,
        )
        raise HTTPException(
            status_code=429,
            detail="Too many failed attempts. Please wait 10 minutes or reset via email.",
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc

    repository = AuthRepository(db)

    service = AuthService(repository)

    user = await service.verify_two_fa(
        email,
        request_body.pin,
    )

    if user is None:
        raise HTTPException(
            status_code=400,
            detail="The PIN you entered is incorrect.",
        )

    logger.info(
        "Two-step verification passed: user=%s",
        user.id,
    )

    access_token = jwt.create_access_token(
        user_id=str(user.id),
        email=user.email,
        ver=user.session_version,
    )

    refresh_service = RefreshTokenService(RefreshTokenRepository(db))

    refresh_token = await refresh_service.issue(
        user.id,
        user_agent=request.headers.get("user-agent"),
        ip_address=_client_ip(request),
    )

    _set_refresh_cookie(response, refresh_token)

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=user,
    )


# ==========================================================
# 2FA: Reset via Email OTP (recovery)
#
# Proving control of the account email with a fresh OTP
# disables 2FA and logs the user in, so the account owner is
# never permanently locked out (the email is the primary
# factor; the PIN is the second layer).
# ==========================================================


@router.post(
    "/two-fa/reset",
    dependencies=[
        rate_limit("auth.two_fa.reset", 5, 600),
    ],
)
async def reset_two_fa(
    request: Request,
    response: Response,
    request_body: ResetTwoFARequest,
    db: AsyncSession = Depends(get_db),
):

    repository = AuthRepository(db)

    service = AuthService(repository)

    result = await service.reset_two_fa(
        request_body.email,
        request_body.otp,
    )

    if result is None:
        raise HTTPException(
            status_code=400,
            detail="Invalid or expired OTP.",
        )

    user = result["user"]

    jwt = JWTService()

    access_token = jwt.create_access_token(
        user_id=str(user.id),
        email=user.email,
        ver=user.session_version,
    )

    refresh_service = RefreshTokenService(RefreshTokenRepository(db))

    refresh_token = await refresh_service.issue(
        user.id,
        user_agent=request.headers.get("user-agent"),
        ip_address=_client_ip(request),
    )

    _set_refresh_cookie(response, refresh_token)

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=user,
    )


# ==========================================================
# Refresh Access Token (with rotation)
# ==========================================================


@router.post(
    "/refresh",
    dependencies=[
        rate_limit("auth.refresh.ip", 60, 600),
    ],
)
async def refresh_token(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):

    body_token = None
    if request.headers.get("content-type", "").startswith("application/json"):
        import json

        try:
            body_token = json.loads((await request.body()).decode()).get("refresh_token")
        except Exception:
            body_token = None

    token = _extract_refresh_token(request, body_token)

    if not token:
        raise HTTPException(
            status_code=401,
            detail="Missing refresh token.",
        )

    refresh_service = RefreshTokenService(RefreshTokenRepository(db))

    try:
        new_token = await refresh_service.rotate(
            token,
            user_agent=request.headers.get("user-agent"),
            ip_address=_client_ip(request),
        )

    except RefreshTokenError as exc:
        # Rotate on reuse/expiry: caller must re-authenticate.
        _clear_refresh_cookie(response)

        raise HTTPException(
            status_code=401,
            detail=exc.args[0],
        ) from exc

    jwt = JWTService()

    payload = jwt.decode_token(new_token)

    user_id = payload["sub"]

    repository = AuthRepository(db)

    user = await repository.get_user_by_id(UUID(user_id))

    if user is None:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired access token.",
        )

    access_token = jwt.create_access_token(
        user_id=str(user.id),
        email=user.email,
        ver=user.session_version,
    )

    _set_refresh_cookie(response, new_token)

    return {
        "access_token": access_token,
        "refresh_token": new_token,
        "token_type": "Bearer",
    }


# ==========================================================
# Logout (revoke the refresh-token family)
# ==========================================================


@router.post(
    "/logout",
    response_model=MessageResponse,
)
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):

    body_token = None
    if request.headers.get("content-type", "").startswith("application/json"):
        import json

        try:
            body_token = json.loads((await request.body()).decode()).get("refresh_token")
        except Exception:
            body_token = None

    token = _extract_refresh_token(request, body_token)

    refresh_service = RefreshTokenService(RefreshTokenRepository(db))

    if token:
        await refresh_service.revoke_family(token)

        # Bump the session generation so every outstanding access
        # token for this account dies immediately (not up to 15 min
        # later). Best-effort: a stale/unknown refresh token leaves
        # the session version untouched.
        try:
            record = await RefreshTokenRepository(db).get_by_token_hash(
                RefreshTokenRepository.hash_token(token)
            )
            if record is not None:
                auth_repo = AuthRepository(db)
                user = await auth_repo.get_user_by_id(record.user_id)
                if user is not None:
                    user.session_version += 1
                    await db.commit()
        except Exception:
            logger.exception("Logout session-version bump failed")

    _clear_refresh_cookie(response)

    return MessageResponse(
        success=True,
        message="Logged out.",
    )


# ==========================================================
# Account Deletion (GDPR)
# ==========================================================


@router.delete(
    "/account",
    dependencies=[
        rate_limit("auth.delete_account", 3, 86400),
    ],
)
async def delete_account(
    response: Response,
    confirm: str = "",
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """GDPR right to erasure.  Pass ?confirm=YES_DELETE to confirm."""

    if confirm != "YES_DELETE":
        raise HTTPException(
            status_code=400,
            detail="Pass confirm=YES_DELETE to permanently delete your account.",
        )

    uid = current_user.id

    # 1. Collect every on-disk blob BEFORE the rows go away: the
    #    avatar, attachment ciphertext + thumbnails for messages this
    #    user sent, and story media. Files cannot be cone by a DB
    #    cascade, only the rows can.
    files: list[Path] = list(AVATAR_DIR.glob(f"{uid}.*"))

    attachment_rows = await db.execute(
        select(
            Attachment.storage_path,
            Attachment.thumbnail_path,
        )
        .join(Message, Message.id == Attachment.message_id)
        .where(Message.sender_id == uid)
    )
    for storage_path, thumbnail_path in attachment_rows:
        if storage_path:
            files.append(Path(storage_path))
        if thumbnail_path:
            files.append(Path(thumbnail_path))

    story_paths = await db.scalars(select(Story.storage_path).where(Story.user_id == uid))
    files.extend(Path(path) for path in story_paths)

    # 2. Hard-delete the user row. Every dependent row - devices,
    #    signal sessions, keys, messages, attachments, stories,
    #    reactions, friendships, blocks, refresh tokens, webauthn
    #    credentials, identity-key pins, privacy settings - is
    #    removed by the schema's ON DELETE CASCADE, so there is no
    #    hand-grown delete list to drift out of sync with new tables.
    await db.execute(sa_delete(OTPCode).where(OTPCode.email == current_user.email))
    await db.delete(current_user)
    await db.commit()

    # 3. Unlink the ciphertext blobs best-effort. A crash between
    #    commit and unlink leaves only an orphan file, which the
    #    periodic orphan sweep reclaims.
    for path in files:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            logger.warning(
                "Could not remove file during account deletion: %s",
                path,
            )

    # 4. Drop this worker's sockets for the deleted account and tell
    #    their conversation peers the user is gone. Sockets on other
    #    workers close on their next authed write; a Redis-distributed
    #    kick is marginal for a deleted account.
    #    ponytail: local-only socket kick; add a bus event for a
    #    distributed kick if accounts are deleted while many
    #    multi-worker sockets stay connected.
    await ws_manager.broadcast_presence(uid, False)
    for websocket in list(ws_manager.user_connections.get(uid, [])):
        try:
            await websocket.close(code=1000)
        except Exception:  # noqa: S110 - best-effort cleanup
            pass

    _clear_refresh_cookie(response)

    return MessageResponse(
        success=True,
        message="Account permanently deleted.",
    )
