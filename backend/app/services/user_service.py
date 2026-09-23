from app.models.user import User
from app.repositories.user_repository import UserRepository
from app.schemas.user import UpdateProfileRequest
from fastapi import HTTPException


class UserService:
    """
    Handles all user-related business logic.
    """

    def __init__(
        self,
        repository: UserRepository,
    ):
        self.repository = repository

    # ==========================================================
    # Get Current User
    # ==========================================================

    async def get_current_user(
        self,
        user_id,
    ) -> User | None:
        return await self.repository.get_by_id(user_id)

    # ==========================================================
    # Update Profile
    # ==========================================================

    async def update_profile(
        self,
        user: User,
        request: UpdateProfileRequest,
    ) -> User:

        if request.username is not None:
            username = request.username.strip()

            existing_user = await self.repository.get_by_username(username)

            if existing_user is not None and existing_user.id != user.id:
                raise HTTPException(
                    status_code=409,
                    detail="Username already exists.",
                )

            user.username = username

        if request.display_name is not None:
            user.display_name = request.display_name.strip()

        if request.bio is not None:
            user.bio = request.bio.strip()

        if request.avatar_url is not None:
            user.avatar_url = request.avatar_url.strip()

        if request.presence_animal is not None:
            user.presence_animal = request.presence_animal

        return await self.repository.update_user(user)

    # ==========================================================
    # Search Users
    # ==========================================================

    async def search_users(
        self,
        query: str,
        exclude_user_id=None,
    ):
        return await self.repository.search_users(
            query,
            exclude_user_id=exclude_user_id,
        )

    # ==========================================================
    # Username Availability
    # ==========================================================

    async def is_username_available(
        self,
        username: str,
    ) -> bool:

        existing_user = await self.repository.get_by_username(username)

        return existing_user is None
