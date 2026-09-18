"""
Token family management: issue, rotate and revoke refresh tokens.

Every refresh token carries a unique `jti` and is recorded
(hashed) server-side. Using one rotates it (old -> new, same
family). Reusing a rotated/revoked token is detected and the
entire family is revoked — this contains stolen tokens the
moment they get replayed.
"""

import uuid
from datetime import datetime, timedelta

from app.core.config import settings
from app.core.utc import UTC
from app.models.refresh_token import RefreshToken
from app.repositories.refresh_token_repository import (
    RefreshTokenError,
    RefreshTokenRepository,
)
from app.services.jwt_service import JWTService


class RefreshTokenService:
    def __init__(self, repository: RefreshTokenRepository):
        self.repository = repository
        self.jwt = JWTService()

    # ======================================================
    # Issue
    # ======================================================

    async def issue(
        self,
        user_id,
        *,
        family_id: uuid.UUID | None = None,
        user_agent: str | None = None,
        ip_address: str | None = None,
    ) -> str:
        """Create a new refresh token and record it server-side."""

        jti = uuid.uuid4().hex
        token = self.jwt.create_refresh_token(
            user_id=str(user_id),
            email="",
            jti=jti,
        )

        record = RefreshToken(
            user_id=user_id,
            jti=jti,
            token_hash=RefreshTokenRepository.hash_token(token),
            family_id=family_id or uuid.uuid4(),
            expires_at=datetime.now(UTC) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
            user_agent=user_agent,
            ip_address=ip_address,
        )
        await self.repository.create(record)
        await self.repository.commit()
        return token

    # ======================================================
    # Rotate (used by /auth/refresh)
    # ======================================================

    async def rotate(
        self,
        token: str,
        *,
        user_agent: str | None = None,
        ip_address: str | None = None,
    ) -> str:
        """
        Validate a refresh token and replace it with a new one
        (same session family).

        Returns the new refresh token string.
        Raises RefreshTokenError when the token is unknown,
        expired or already rotated (reuse detected) — in which
        case the entire family is revoked first.
        """

        payload = self.jwt.verify_refresh_token(token)

        if payload is None:
            raise RefreshTokenError("Invalid refresh token.")

        token_hash = RefreshTokenRepository.hash_token(token)
        record = await self.repository.get_by_token_hash(token_hash)

        if record is None or record.revoked_at is not None:
            # Unknown or already-rotated token -> this is a replay.
            # Contain the whole family via the jti chain, then reject.
            await self._revoke_family_for_jti(payload.get("jti"))
            raise RefreshTokenError("Refresh token reuse detected.")

        # -- rotate -------------------------------------------------

        new_jti = uuid.uuid4().hex
        new_token = self.jwt.create_refresh_token(
            user_id=str(record.user_id),
            email=payload.get("email", ""),
            jti=new_jti,
        )

        await self.repository.revoke(
            record,
            replaced_by_jti=new_jti,
        )

        await self.repository.create(
            RefreshToken(
                user_id=record.user_id,
                jti=new_jti,
                token_hash=RefreshTokenRepository.hash_token(new_token),
                family_id=record.family_id,
                predecessor_jti=record.jti,
                expires_at=datetime.now(UTC) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
                user_agent=user_agent,
                ip_address=ip_address,
            )
        )

        await self.repository.commit()

        return new_token

    async def _revoke_family_for_jti(self, jti: str | None) -> None:
        """Best-effort family containment when only a jti is known."""

        if not jti:
            return

        record = await self.repository.get_by_jti(jti)
        if record is None:
            record = await self.repository.get_by_predecessor_jti(jti)

        if record is not None and record.family_id:
            await self.repository.revoke_family(record.family_id)
            await self.repository.commit()

    # ======================================================
    # Revoke
    # ======================================================

    async def revoke_token(
        self,
        token: str,
    ) -> bool:
        """Revoke a single refresh token (logout of one device)."""

        token_hash = RefreshTokenRepository.hash_token(token)
        record = await self.repository.get_by_token_hash(token_hash)

        if record is None or record.revoked_at is not None:
            await self.repository.commit()
            return False

        await self.repository.revoke(record)
        await self.repository.commit()
        return True

    async def revoke_family(
        self,
        token: str,
    ) -> bool:
        """Revoke every token sharing the session family."""

        token_hash = RefreshTokenRepository.hash_token(token)
        record = await self.repository.get_by_token_hash(token_hash)

        if record is None:
            await self.repository.commit()
            return False

        await self.repository.revoke_family(record.family_id)
        await self.repository.commit()
        return True
