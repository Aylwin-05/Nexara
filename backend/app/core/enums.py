from enum import Enum

# ==========================================================
# User Online Status
# ==========================================================


class OnlineStatus(str, Enum):
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


class FriendRequestStatus(str, Enum):
    """
    Friendship request status.
    """

    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    BLOCKED = "blocked"
