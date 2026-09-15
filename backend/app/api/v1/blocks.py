from uuid import UUID

from app.database.session import get_db
from app.dependencies.auth import get_current_user
from app.dependencies.rate_limit import rate_limit
from app.models.user import User
from app.repositories.block_repository import BlockRepository
from app.repositories.friend_repository import FriendRepository
from app.services.block_service import BlockService
from app.websocket.connection_manager import manager
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(
    prefix="/blocks",
    tags=["Blocks & Privacy"],
)


class BlockRequest(BaseModel):
    user_id: UUID


class PrivacyUpdate(BaseModel):
    last_seen: str | None = None
    profile_photo: str | None = None
    story: str | None = None


def _service(db: AsyncSession) -> BlockService:

    return BlockService(
        BlockRepository(db),
        FriendRepository(db),
    )


# ==========================================================
# Block a user
# ==========================================================


@router.post(
    "/",
    dependencies=[
        rate_limit("blocks.block", 30, 60),
    ],
)
async def block_user(
    request: BlockRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await _service(db).block_user(
            current_user,
            request.user_id,
        )

        # Drop the cached block sets so live sockets stop relaying
        # to the blocked user immediately (and vice versa).
        await manager.invalidate_blocks(current_user.id)
        await manager.invalidate_blocks(request.user_id)

        return result
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=str(e),
        ) from e


# ==========================================================
# Unblock a user
# ==========================================================


@router.delete(
    "/{user_id}",
    dependencies=[
        rate_limit("blocks.unblock", 30, 60),
    ],
)
async def unblock_user(
    user_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await _service(db).unblock_user(
            current_user,
            UUID(user_id),
        )

        # Same cache invalidation as block: an unblock must take
        # effect immediately on the live sockets too.
        await manager.invalidate_blocks(current_user.id)
        await manager.invalidate_blocks(UUID(user_id))

        return result
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=str(e),
        ) from e


# ==========================================================
# List blocked users
# ==========================================================


@router.get(
    "/",
    dependencies=[
        rate_limit("blocks.list", 30, 60),
    ],
)
async def list_blocked(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await _service(db).list_blocked(current_user)


# ==========================================================
# Privacy settings
# ==========================================================


@router.get(
    "/privacy",
    dependencies=[
        rate_limit("blocks.privacy.get", 60, 60),
    ],
)
async def get_privacy(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await _service(db).get_privacy(current_user)


@router.patch(
    "/privacy",
    dependencies=[
        rate_limit("blocks.privacy.update", 60, 60),
    ],
)
async def update_privacy(
    request: PrivacyUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await _service(db).update_privacy(
            current_user,
            last_seen=request.last_seen,
            profile_photo=request.profile_photo,
            story=request.story,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=str(e),
        ) from e
