from datetime import datetime
from uuid import uuid4

from app.database.base import Base
from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column


class PushSubscription(Base):
    """
    Web Push (VAPID) subscription for one of the user's browsers.

    The endpoint + keys let the server deliver encrypted push
    messages to the browser's service worker even while the app
    is closed. Push payloads never contain plaintext: the client
    decrypts message content in the app, not in the worker.
    """

    __tablename__ = "push_subscriptions"

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    user_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "users.id",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )

    endpoint: Mapped[str] = mapped_column(
        String(1000),
        nullable=False,
    )

    p256dh: Mapped[str] = mapped_column(
        String(512),
        nullable=False,
    )

    auth: Mapped[str] = mapped_column(
        String(256),
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
