from uuid import UUID

from app.database.session import get_db
from app.repositories.auth_repository import AuthRepository
from app.services.jwt_service import JWTService
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

security = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
):

    token = credentials.credentials

    jwt_service = JWTService()

    payload = jwt_service.verify_access_token(token)

    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token.",
        )

    user_id = payload.get("sub")

    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload.",
        )

    repository = AuthRepository(db)

    user = await repository.get_user_by_id(UUID(user_id))

    if user is None:
        # Same message as a bad/expired token on purpose: telling
        # the caller "this account was deleted" would give away
        # account state.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token.",
        )

    if getattr(user, "session_version", 0) != payload.get("ver"):
        # The access token predates the last logout / deactivation /
        # deletion: reject it even though it has not expired yet.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token.",
        )

    if not getattr(user, "is_active", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated.",
        )

    # Publish the authenticated user to the session so the RLS GUC
    # (app.current_user_id) can be re-applied at the start of every
    # transaction for this request. The value has to be transaction-
    # local: services commit mid-request, and a commit both ends the
    # transaction and can release the pooled connection, so a one-off
    # SET would be lost before later statements run. See
    # app/database/database.py for the after_begin hook.
    # Harmless under the superuser role (RLS bypassed). SQLite (tests)
    # has no set_config, so it is skipped.
    db.info["rls_user_id"] = str(user.id)

    if db.bind.dialect.name == "postgresql":
        await db.execute(
            text("SELECT set_config('app.current_user_id', :uid, true)"),
            {"uid": str(user.id)},
        )

    return user
