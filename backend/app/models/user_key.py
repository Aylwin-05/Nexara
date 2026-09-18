from uuid import uuid4

from app.database.base import Base
from sqlalchemy import (
    DateTime,
    ForeignKey,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import (
    Mapped,
    mapped_column,
    relationship,
)


class UserKey(Base):
    """
    Stores a user's long-term identity key.

    Only the PUBLIC key should ever be shared.
    """

    __tablename__ = "user_keys"

    # ==========================================================
    # Identity
    # ==========================================================

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    # ==========================================================
    # Owner
    # ==========================================================

    user_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "users.id",
            ondelete="CASCADE",
        ),
        unique=True,
        nullable=False,
    )

    # ==========================================================
    # Keys
    # ==========================================================

    public_key: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    # ==========================================================
    # Audit
    # ==========================================================

    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # ==========================================================
    # Relationship
    # ==========================================================

    user = relationship(
        "User",
        back_populates="key",
    )
