from uuid import UUID

from app.core.rate_limit import (
    RateLimitExceeded,
    get_limiter,
)
from app.database.session import get_db
from app.dependencies.auth import get_current_user
from app.models.user import User
from app.repositories.user_key_repository import (
    UserKeyRepository,
)
from app.schemas.keys import (
    KeyUploadResponse,
    PublicKeyResponse,
    UploadPublicKeyRequest,
)
from app.services.key_service import (
    KeyService,
)
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(
    prefix="/keys",
    tags=["Encryption Keys"],
)


# ==========================================================
# Upload Public Key
# ==========================================================


@router.post(
    "/public",
    response_model=KeyUploadResponse,
)
async def upload_public_key(
    request: UploadPublicKeyRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_limiter().check(f"keys.upload.{current_user.id}", 10, 60)
    except RateLimitExceeded as exc:
        raise HTTPException(
            status_code=429,
            detail="Too many requests.",
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc

    repository = UserKeyRepository(db)

    service = KeyService(repository)

    return await service.upload_public_key(
        current_user=current_user,
        public_key=request.public_key,
    )


# ==========================================================
# Get Public Key
# ==========================================================


@router.get(
    "/{user_id}",
    response_model=PublicKeyResponse,
)
async def get_public_key(
    user_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_limiter().check(f"keys.get.{current_user.id}", 60, 60)
    except RateLimitExceeded as exc:
        raise HTTPException(
            status_code=429,
            detail="Too many requests.",
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc

    repository = UserKeyRepository(db)

    service = KeyService(repository)

    return await service.get_public_key(
        user_id=user_id,
    )
