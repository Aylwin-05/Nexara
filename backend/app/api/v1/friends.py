import logging

from app.database.session import get_db
from app.dependencies.auth import get_current_user
from app.dependencies.rate_limit import rate_limit
from app.models.user import User
from app.repositories.block_repository import BlockRepository
from app.repositories.friend_repository import FriendRepository
from app.schemas.friend import (
    FriendMessage,
    FriendRequestAction,
    FriendResponse,
    SearchUserResponse,
    SendFriendRequest,
)
from app.services.friend_service import FriendService
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("app.api.friends")


router = APIRouter(
    prefix="/friends",
    tags=["Friends"],
)

# ==========================================================
# Search Users
# ==========================================================


@router.get(
    "/search",
    response_model=list[SearchUserResponse],
    dependencies=[
        rate_limit("friends.search", 30, 60),
    ],
)
async def search_users(
    email: str = Query(..., min_length=1),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):

    repository = FriendRepository(db)

    service = FriendService(repository)

    return await service.search_users(
        current_user,
        email,
    )


# ==========================================================
# Send Friend Request
# ==========================================================


@router.post(
    "/request",
    response_model=FriendResponse,
    dependencies=[
        rate_limit("friends.request", 20, 60),
    ],
)
async def send_friend_request(
    request: SendFriendRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    repository = FriendRepository(db)
    service = FriendService(repository)

    block_repository = BlockRepository(db)

    if await block_repository.is_blocked(
        current_user.id,
        request.receiver_id,
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This user cannot be added as a friend.",
        )

    try:
        friendship = await service.send_request(
            current_user,
            request.receiver_id,
        )

        return friendship

    except ValueError as e:
        logger.warning(
            "Friend request failed for user %s: %s",
            current_user.id,
            e,
        )

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e


# ==========================================================
# Pending Requests
# ==========================================================


@router.get(
    "/pending",
    response_model=list[FriendResponse],
)
async def get_pending_requests(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    repository = FriendRepository(db)
    service = FriendService(repository)

    return await service.pending_requests(current_user)


# ==========================================================
# Friends List
# ==========================================================


@router.get(
    "/",
    response_model=list[FriendResponse],
)
async def get_friends(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    repository = FriendRepository(db)
    service = FriendService(repository)

    return await service.friends(current_user)


# ==========================================================
# Accept Request
# ==========================================================


@router.post(
    "/accept",
    response_model=FriendResponse,
    dependencies=[
        rate_limit("friends.accept", 20, 60),
    ],
)
async def accept_friend_request(
    request: FriendRequestAction,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    repository = FriendRepository(db)
    service = FriendService(repository)

    try:
        return await service.accept_request(
            request.friendship_id,
            current_user,
        )

    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=str(e),
        ) from e


# ==========================================================
# Reject Request
# ==========================================================


@router.post(
    "/reject",
    response_model=FriendMessage,
    dependencies=[
        rate_limit("friends.reject", 20, 60),
    ],
)
async def reject_friend_request(
    request: FriendRequestAction,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    repository = FriendRepository(db)
    service = FriendService(repository)

    try:
        await service.reject_request(
            request.friendship_id,
            current_user,
        )

        return FriendMessage(
            success=True,
            message="Friend request rejected.",
        )

    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=str(e),
        ) from e


# ==========================================================
# Remove Friend
# ==========================================================


@router.delete(
    "/{friendship_id}",
    response_model=FriendMessage,
)
async def remove_friend(
    friendship_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    repository = FriendRepository(db)
    service = FriendService(repository)

    try:
        from uuid import UUID

        await service.remove_friend(
            UUID(friendship_id),
            current_user,
        )

        return FriendMessage(
            success=True,
            message="Friend removed successfully.",
        )

    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=str(e),
        ) from e
