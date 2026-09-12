import logging
import uuid

from app.core.config import settings
from app.core.rate_limit import (
    RateLimitExceeded,
    get_limiter,
)
from app.database.session import get_db
from app.dependencies.auth import get_current_user
from app.dependencies.rate_limit import rate_limit
from app.models.conversation_participant import ConversationParticipant
from app.models.message import Message
from app.models.user import User
from app.repositories.auth_repository import AuthRepository
from app.schemas.recovery import (
    RecoveryRequest,
    RecoveryVerifyRequest,
)
from app.services.auth_service import AuthService
from app.services.email_service import EmailService
from app.services.recovery_service import (
    TOKEN_TTL_SECONDS,
    create_recovery_key,
    recovery_token_store,
    rewrap_existing_secret,
)
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
)
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/recovery",
    tags=["Recovery"],
)


# ==========================================================
# Unlock Material (for the account recovery code)
#
# Returns the salt + wrapped sync secret for the authenticated
# account. The client derives the wrap key from the user's
# recovery code (PBKDF2) and unwraps the secret LOCALLY — the
# server never sees the code or the secret in plaintext.
# ==========================================================

@router.get(
    "/unlock",
)
async def get_recovery_unlock_material(
    current_user: User = Depends(get_current_user),
):
    """Return the code-wrapped sync secret for this account."""

    if current_user.recovery_salt is None or current_user.recovery_wrapped_key is None:

        raise HTTPException(
            status_code=404,
            detail="No recovery key for this account.",
        )

    return {
        "salt": current_user.recovery_salt,
        "wrapped_key": current_user.recovery_wrapped_key,
    }


# ==========================================================
# Request a new recovery code ("I lost my code")
#
# 1) The logged-in user clicks the Support button.
# 2) A fresh (code, salt, wrapped secret) triple is minted and
#    stored; the code itself is held ONLY in the in-memory token
#    store, tied to an unguessable token embedded in the email.
# 3) The email carries a link: {FRONTEND_URL}/recover?token=...
#
# Rate limit: 3 per 600s per email + 50 per 600s per IP. The
# response carries remaining + retry_after so the frontend can
# render the 3/600s timer.
# ==========================================================

@router.post(
    "/request",
    dependencies=[
        rate_limit("recovery.request.ip", 50, 600),
    ],
)
async def request_recovery_code(
    request_body: RecoveryRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):

    email_key = f"recovery.request.{current_user.email.lower()}"

    try:

        await get_limiter().check(
            email_key,
            3,
            600,
        )

    except RateLimitExceeded as exc:

        raise HTTPException(
            status_code=429,
            detail="Too many requests. Try again later.",
            headers={"Retry-After": str(exc.retry_after)},
        )

    # Re-wrap the SAME secret when the browser still has it
    # (lossless: every existing sync copy stays valid), otherwise
    # mint a fresh account key.
    try:

        if request_body.secret_b64:
            recovery = rewrap_existing_secret(
                request_body.secret_b64
            )
            mode = "same_secret"
        else:
            recovery = create_recovery_key()
            mode = "new_secret"

    except ValueError as exc:

        raise HTTPException(
            status_code=400,
            detail=str(exc),
        )

    # ----------------------------------------------------------
    # Fresh-mint safety guard
    #
    # Minting a NEW account key (secret_b64 absent) overwrites the
    # stored code-wrapped secret and permanently orphans every sync
    # copy this account has already written — those copies can only
    # be decrypted with the OLD secret, which is lost the moment the
    # blob is replaced. This is safe only when there is no history
    # to orphan. If any message in this account's conversations
    # carries a sync copy (sent OR received — received copies are
    # also re-encrypted under this account's secret when read), the
    # fresh mint is refused unless the user explicitly opts in
    # (force_new=true).
    # ----------------------------------------------------------
    if not request_body.secret_b64 and not request_body.force_new:

        orphaned_count = (
            await db.scalar(
                select(func.count())
                .select_from(Message)
                .where(Message.sync_envelope.is_not(None))
                .where(
                    Message.conversation_id.in_(
                        select(
                            ConversationParticipant.conversation_id
                        ).where(
                            ConversationParticipant.user_id
                            == current_user.id
                        )
                    )
                )
            )
        ) or 0

        if orphaned_count > 0:

            raise HTTPException(
                status_code=409,
                detail=(
                    f"Requesting a new code from this browser would "
                    f"create a new account key and permanently lock "
                    f"{orphaned_count} existing message(s) beyond "
                    "reach — they are only decodable with the current "
                    "secret, and that secret cannot be recovered once "
                    "overwritten. Request the code from a browser that "
                    "has already unlocked your history to keep it "
                    "intact, or re-enter your code to unlock on this "
                    "browser first."
                ),
                headers={
                    "X-Orphaned-Messages": str(orphaned_count),
                },
            )

    user_row = (
        await db.execute(
            select(User).where(User.id == current_user.id)
        )
    ).scalar_one_or_none()

    if user_row is None:

        raise HTTPException(
            status_code=404,
            detail="Account not found.",
        )

    user_row.recovery_salt = recovery["salt"]
    user_row.recovery_wrapped_key = recovery["wrapped_key"]

    await db.commit()

    # One pending link per user: a re-request invalidates the
    # previous one (its code no longer matches the stored salt).
    await recovery_token_store.revoke_for_user(user_row.id)

    token = await recovery_token_store.issue(
        user_id=user_row.id,
        email=user_row.email,
        code=recovery["code"],
        code_display=recovery["code_display"],
    )

    link_url = (
        f"{settings.FRONTEND_URL}/recover?token={token}"
    )

    if settings.DEBUG and settings.APP_ENV == "development":

        logger.warning(
            "[DEV] Recovery re-issue for %s: %s",
            user_row.email,
            recovery["code_display"],
        )

    try:

        await EmailService().send_recovery_link_email(
            recipient_email=user_row.email,
            link_url=link_url,
        )

    except Exception as exc:

        logger.warning(
            "Recovery link email failed for %s: %s",
            user_row.email,
            exc,
        )

    remaining, retry_after = await get_limiter().remaining(
        email_key,
        3,
        600,
    )

    return {
        "success": True,
        "mode": mode,
        "remaining": remaining,
        "retry_after": retry_after,
        "expires_in": TOKEN_TTL_SECONDS,
    }


# ==========================================================
# Verify (link + OTP) and reveal the new code
#
# No session required — the emailed link token plus an OTP for
# the account email are the proof (password-reset model). The
# OTP is verified with the SAME AuthService used by login, but
# no tokens are issued here: the endpoint only consumes the OTP
# and returns the fresh recovery code.
# ==========================================================

@router.post(
    "/verify",
    dependencies=[
        rate_limit("recovery.verify.ip", 30, 600),
    ],
)
async def verify_recovery_otp(
    request_body: RecoveryVerifyRequest,
    db: AsyncSession = Depends(get_db),
):

    entry = await recovery_token_store.take(
        request_body.token
    )

    if entry is None:

        raise HTTPException(
            status_code=404,
            detail="Recovery link is invalid or expired. "
                   "Request a new one from Settings > Support.",
        )

    if entry["email"] != request_body.email.lower():

        # The link belongs to another account. Never reveal the
        # code; do not even confirm the token was valid.
        raise HTTPException(
            status_code=403,
            detail="This link belongs to a different account.",
        )

    service = AuthService(
        AuthRepository(db)
    )

    result = await service.verify_otp(
        request_body.email,
        request_body.otp,
    )

    if result is None:

        raise HTTPException(
            status_code=400,
            detail="Invalid or expired OTP.",
        )

    user_row = (
        await db.execute(
            select(User).where(
                User.id == uuid.UUID(entry["user_id"])
            )
        )
    ).scalar_one_or_none()

    if user_row is None:
        raise HTTPException(
            status_code=404,
            detail="User no longer exists.",
        )

    await recovery_token_store.discard(request_body.token)

    logger.info(
        "Recovery code re-issued for user %s",
        entry["user_id"],
    )

    return {
        "success": True,
        "code": entry["code"],
        "code_display": entry["code_display"],
        "salt": user_row.recovery_salt,
        "wrapped_key": user_row.recovery_wrapped_key,
    }
