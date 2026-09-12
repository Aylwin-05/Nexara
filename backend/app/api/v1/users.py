import mimetypes
from pathlib import Path
from uuid import UUID

from app.core.file_config import (
    AVATAR_DIR,
    AVATAR_EXTENSIONS,
    MAX_AVATAR_SIZE,
)
from app.core.file_stream import stream_to_disk
from app.database.session import get_db
from app.dependencies.auth import get_current_user
from app.dependencies.rate_limit import rate_limit
from app.models.user import User
from app.repositories.user_repository import UserRepository
from app.schemas.user import (
    SearchUserResponse,
    UpdateProfileRequest,
    UsernameAvailabilityResponse,
    UserResponse,
)
from app.services.user_service import UserService
from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
)
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(
    prefix="/users",
    tags=["Users"],
)


# ==========================================================
# Get My Profile
# ==========================================================

@router.get(
    "/me",
    response_model=UserResponse,
)
async def get_my_profile(
    current_user: User = Depends(get_current_user),
):
    """
    Return the authenticated user's profile.
    """

    profile = UserResponse.model_validate(current_user)

    return profile.model_copy(
        update={
            "has_recovery_key":
                current_user.recovery_wrapped_key is not None,
        }
    )


# ==========================================================
# Update My Profile
# ==========================================================

@router.patch(
    "/me",
    response_model=UserResponse,
)
async def update_my_profile(
    request: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    repository = UserRepository(db)
    service = UserService(repository)

    updated_user = await service.update_profile(
        current_user,
        request,
    )

    await repository.commit()

    return updated_user


# ==========================================================
# Search Users
# ==========================================================

@router.get(
    "/search",
    response_model=list[SearchUserResponse],
    dependencies=[
        rate_limit("users.search", 30, 60),
    ],
)
async def search_users(
    q: str = Query(
        ...,
        min_length=1,
        description="Search by email",
    ),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    repository = UserRepository(db)
    service = UserService(repository)

    users = await service.search_users(
        q,
        exclude_user_id=current_user.id,
    )

    return users


# ==========================================================
# Check Username Availability
# ==========================================================

@router.get(
    "/check-username",
    response_model=UsernameAvailabilityResponse,
    dependencies=[
        rate_limit("users.check-username", 30, 60),
    ],
)
async def check_username(
    username: str = Query(
        ...,
        min_length=3,
        max_length=30,
    ),
    db: AsyncSession = Depends(get_db),
):
    repository = UserRepository(db)
    service = UserService(repository)

    available = await service.is_username_available(
        username
    )

    if available:
        return UsernameAvailabilityResponse(
            available=True,
            message="Username is available.",
        )

    return UsernameAvailabilityResponse(
        available=False,
        message="Username already exists.",
    )


# ==========================================================
# Upload Avatar
# ==========================================================

@router.post(
    "/avatar",
    response_model=UserResponse,
)
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload the authenticated user's avatar image.

    The image is stored on disk and served only to the user
    and their friends via ``GET /users/{user_id}/avatar``.
    """

    filename = file.filename or ""
    extension = Path(filename).suffix.lower()

    if extension not in AVATAR_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Unsupported image type.",
        )

    # --------------------------------------------------------
    # Replace any previous avatar for this user
    # --------------------------------------------------------

    for old_file in AVATAR_DIR.glob(f"{current_user.id}.*"):
        old_file.unlink(missing_ok=True)

    destination = AVATAR_DIR / f"{current_user.id}{extension}"

    await stream_to_disk(
        file,
        destination,
        MAX_AVATAR_SIZE,
        extension=extension,
    )

    repository = UserRepository(db)

    current_user.avatar_url = f"/api/v1/users/{current_user.id}/avatar"

    await repository.update_user(current_user)

    await repository.commit()

    return current_user


# ==========================================================
# Get Avatar (self or friends only)
# ==========================================================

@router.get(
    "/{user_id}/avatar",
)
async def get_avatar(
    user_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Serve a user's avatar image.

    Only the owner and accepted friends may view it; other
    users get a 404 so presence of an avatar is not leaked.
    """

    repository = UserRepository(db)

    target_user = await repository.get_by_id(user_id)

    if target_user is None:
        raise HTTPException(
            status_code=404,
            detail="User not found.",
        )

    if target_user.id != current_user.id:

        from app.core.enums import FriendRequestStatus
        from app.repositories.block_repository import BlockRepository
        from app.repositories.friend_repository import FriendRepository
        from app.services.block_service import BlockService

        block_repository = BlockRepository(db)

        if await block_repository.block_exists(
            current_user.id,
            target_user.id,
        ):
            raise HTTPException(
                status_code=404,
                detail="Not found.",
            )

        block_service = BlockService(
            block_repository,
            FriendRepository(db),
        )

        privacy = await block_service.get_privacy(
            target_user
        )

        level = privacy["profile_photo"]

        friend_repository = FriendRepository(db)

        friendship = await friend_repository.get_existing_friendship(
            current_user.id,
            target_user.id,
        )

        is_friend = (
            friendship is not None
            and friendship.status == FriendRequestStatus.ACCEPTED.value
        )

        if level == "nobody":
            raise HTTPException(
                status_code=404,
                detail="Not found.",
            )

        if level == "my_contacts" and not is_friend:
            raise HTTPException(
                status_code=404,
                detail="Not found.",
            )

    avatar_files = list(AVATAR_DIR.glob(f"{target_user.id}.*"))

    if not avatar_files:
        raise HTTPException(
            status_code=404,
            detail="Avatar not found.",
        )

    file_path = avatar_files[0]

    media_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"

    return FileResponse(
        path=file_path,
        media_type=media_type,
    )
