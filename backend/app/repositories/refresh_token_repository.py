import hashlib
import uuid
from datetime import UTC, datetime

from app.models.refresh_token import RefreshToken
from sqlalchemy import delete, select, update


class RefreshTokenRepository:
    """
    Persistence for refresh tokens (rotation + revocation).
    """

    def __init__(self, db):
        self.db = db

    @staticmethod
    def hash_token(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()

    async def get_by_token_hash(
        self,
        token_hash: str,
    ) -> RefreshToken | None:
        result = await self.db.execute(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash)
        )
        return result.scalar_one_or_none()

    async def get_by_jti(
        self,
        jti: str,
    ) -> RefreshToken | None:
        """Find a row by its token id.

        After rotation the old row survives with `replaced_by_jti`
        set, so a replayed (rotated-away) token can still be traced
        back to its family for revocation.
        """
        result = await self.db.execute(select(RefreshToken).where(RefreshToken.jti == jti))
        return result.scalar_one_or_none()

    async def get_by_predecessor_jti(
        self,
        predecessor_jti: str,
    ) -> RefreshToken | None:
        """Find the row that replaced the given jti.

        Lets a replayed token be traced to its family even after
        its own row has been pruned.
        """
        result = await self.db.execute(
            select(RefreshToken).where(RefreshToken.predecessor_jti == predecessor_jti)
        )
        return result.scalar_one_or_none()

    async def create(
        self,
        record: RefreshToken,
    ) -> RefreshToken:
        self.db.add(record)
        await self.db.flush()
        return record

    async def revoke(
        self,
        record: RefreshToken,
        replaced_by_jti: str | None = None,
    ):
        record.revoked_at = datetime.now(UTC)
        if replaced_by_jti:
            record.replaced_by_jti = replaced_by_jti
        await self.db.flush()

    async def revoke_family(
        self,
        family_id: uuid.UUID,
    ):
        await self.db.execute(
            update(RefreshToken)
            .where(RefreshToken.family_id == family_id)
            .values(revoked_at=datetime.now(UTC))
            .execution_options(synchronize_session=False)
        )
        await self.db.flush()

    async def revoke_all_for_user(
        self,
        user_id: uuid.UUID,
    ):
        await self.db.execute(
            update(RefreshToken)
            .where(
                RefreshToken.user_id == user_id,
                RefreshToken.revoked_at.is_(None),
            )
            .values(revoked_at=datetime.now(UTC))
            .execution_options(synchronize_session=False)
        )
        await self.db.flush()

    async def delete_expired(self):
        await self.db.execute(
            delete(RefreshToken).where(RefreshToken.expires_at < datetime.now(UTC))
        )
        await self.db.flush()

    async def commit(self):
        await self.db.commit()


class RefreshTokenError(Exception):
    def __init__(self, message: str, code: str = "invalid_token"):
        super().__init__(message)
        self.code = code
