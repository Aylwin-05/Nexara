from datetime import datetime
from uuid import uuid4

from app.database.base import Base
from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column


class GroupInviteLink(Base):
    """
    A secret shareable link that lets anyone join a group
    (WhatsApp-style). The token is the only thing a joiner
    needs: there is no approval step — the link either works
    or has been revoked.
    """

    __tablename__ = "group_invite_links"

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    conversation_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "conversations.id",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )

    # The secret portion of the invite URL. Exposed only to
    # group admins; a joiner never learns the conversation id
    # until they redeem the token.
    token: Mapped[str] = mapped_column(
        String(64),
        unique=True,
        nullable=False,
    )

    created_by: Mapped[UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "users.id",
            ondelete="SET NULL",
        ),
        nullable=True,
    )

    # None = never expires.
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    revoked: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
