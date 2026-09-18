from uuid import uuid4

from app.database.base import Base
from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column


class CallLog(Base):
    """
    Records a call event (answer, miss, declined).

    Created by the backend when call_end or call_offer
    events pass through the WebSocket relay.
    """

    __tablename__ = "call_logs"

    __table_args__ = (
        Index("ix_call_logs_caller_id", "caller_id"),
        Index("ix_call_logs_receiver_id", "receiver_id"),
        Index("ix_call_logs_created_at", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    caller_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    receiver_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    conversation_id: Mapped[UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("conversations.id", ondelete="SET NULL"),
        nullable=True,
    )

    call_type: Mapped[str] = mapped_column(
        String(10),
        default="voice",
        nullable=False,
    )

    status: Mapped[str] = mapped_column(
        String(20),
        default="missed",
        nullable=False,
    )

    duration_seconds: Mapped[int | None] = mapped_column(
        nullable=True,
    )

    started_at: Mapped[DateTime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    ended_at: Mapped[DateTime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
