from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

# ==========================================================
# Public User
# ==========================================================


class UserResponse(BaseModel):
    """
    Public user information.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: EmailStr
    username: str
    display_name: str

    avatar_url: str | None = None
    bio: str | None = None

    is_verified: bool

    online_status: str

    last_seen: datetime | None = None

    # True when the account has a recovery key (a recovery code
    # was already issued). A browser that has not unlocked the
    # sync secret prompts the user for the code on login.
    has_recovery_key: bool = False

    created_at: datetime


# ==========================================================
# Update Profile
# ==========================================================


class UpdateProfileRequest(BaseModel):
    username: str | None = Field(
        default=None,
        min_length=3,
        max_length=30,
        pattern=r"^[a-zA-Z0-9_.-]+$",
    )

    display_name: str | None = Field(
        default=None,
        min_length=2,
        max_length=50,
    )

    bio: str | None = Field(
        default=None,
        max_length=250,
    )

    avatar_url: str | None = None


# ==========================================================
# Search Users
# ==========================================================


class SearchUserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID

    username: str

    display_name: str

    avatar_url: str | None = None

    online_status: str


# ==========================================================
# Username Availability
# ==========================================================


class UsernameAvailabilityResponse(BaseModel):
    available: bool

    message: str
