from datetime import datetime
from uuid import uuid4

from app.database.base import Base
from sqlalchemy import UUID, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column


class IdentityKeyPin(Base):
    """
    Stores verified identity key fingerprints for safety number pinning.

    When two users verify their safety numbers (identity key fingerprints),
    the fingerprint is stored so that future conversations can automatically
    confirm the match and warn if a key change is detected (potential MITM).
    """

    __tablename__ = "identity_key_pins"

    __table_args__ = (UniqueConstraint("user_id", "contact_user_id", name="uq_user_contact_pin"),)

    id: Mapped[UUID] = mapped_column(
        PGUUID,
        primary_key=True,
        default=uuid4,
    )

    user_id: Mapped[UUID] = mapped_column(
        PGUUID,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    contact_user_id: Mapped[UUID] = mapped_column(
        PGUUID,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    contact_identity_key_fingerprint: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        comment="SHA-256 fingerprint of contact's Ed25519 identity key",
    )

    verified_at: Mapped[datetime] = mapped_column(
        nullable=False,
        server_default=func.now(),
    )

    def get_fingerprint(self) -> str:
        """Return the first 8 characters of the fingerprint for display."""
        return self.contact_identity_key_fingerprint[:8]
