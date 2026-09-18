import uuid

from app.core.enums import FriendRequestStatus
from app.database.base import Base
from app.database.mixins import TimestampMixin
from sqlalchemy import ForeignKey, Index, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship


class Friendship(Base, TimestampMixin):
    """
    Stores friendship relationships and friend requests.
    """

    __tablename__ = "friendships"

    __table_args__ = (
        Index("ix_friend_sender", "sender_id"),
        Index("ix_friend_receiver", "receiver_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        primary_key=True,
        default=uuid.uuid4,
    )

    sender_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey(
            "users.id",
            ondelete="CASCADE",
        ),
        nullable=False,
    )

    receiver_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey(
            "users.id",
            ondelete="CASCADE",
        ),
        nullable=False,
    )

    status: Mapped[str] = mapped_column(
        String(20),
        default=FriendRequestStatus.PENDING.value,
        nullable=False,
    )

    sender = relationship(
        "User",
        foreign_keys=[sender_id],
    )

    receiver = relationship(
        "User",
        foreign_keys=[receiver_id],
    )

    def __repr__(self) -> str:
        return (
            f"<Friendship("
            f"sender={self.sender_id}, "
            f"receiver={self.receiver_id}, "
            f"status={self.status})>"
        )
