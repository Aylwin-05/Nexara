from enum import StrEnum

# ==========================================================
# User Online Status
# ==========================================================


class OnlineStatus(StrEnum):
    """
    User presence status.
    """

    ONLINE = "online"
    OFFLINE = "offline"
    AWAY = "away"
    BUSY = "busy"


# ==========================================================
# Friend Request Status
# ==========================================================


class FriendRequestStatus(StrEnum):
    """
    Friendship request status.
    """

    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    BLOCKED = "blocked"
