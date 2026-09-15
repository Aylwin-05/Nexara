from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

# ==========================================================
# User Summary
# ==========================================================


class FriendUser(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID

    username: str

    display_name: str

    email: str

    online_status: str

    avatar_url: str | None = None


# ==========================================================
# Send Friend Request
# ==========================================================


class SendFriendRequest(BaseModel):
    receiver_id: UUID


# ==========================================================
# Friend Request Action
# ==========================================================


class FriendRequestAction(BaseModel):
    friendship_id: UUID


# ==========================================================
# Friend Response
# ==========================================================


class FriendResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID

    sender_id: UUID

    receiver_id: UUID

    status: str

    created_at: datetime

    sender: FriendUser

    receiver: FriendUser


# ==========================================================
# Search User Response
# ==========================================================


class SearchUserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID

    email: str

    username: str

    display_name: str

    avatar_url: str | None = None

    online_status: str


# ==========================================================
# Generic Message
# ==========================================================


class FriendMessage(BaseModel):
    success: bool

    message: str
