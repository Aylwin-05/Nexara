from datetime import UTC, datetime, timedelta
from uuid import UUID

from app.models.otp import OTPCode
from app.models.user import User
from app.models.user_key import UserKey
from app.repositories.base_repository import BaseRepository
from sqlalchemy import delete, select, update


class AuthRepository(BaseRepository):
    """
    Repository responsible for authentication,
    OTPs and cryptographic identity keys.
    """

    # ==========================================================
    # Users
    # ==========================================================

    async def get_user_by_email(
        self,
        email: str,
    ) -> User | None:

        result = await self.execute(select(User).where(User.email == email))

        return result.scalar_one_or_none()

    async def get_user_by_username(
        self,
        username: str,
    ) -> User | None:

        result = await self.execute(select(User).where(User.username == username))

        return result.scalar_one_or_none()

    async def get_user_by_id(
        self,
        user_id,
    ):

        from app.models.user import User
        from sqlalchemy import select

        result = await self.execute(select(User).where(User.id == user_id))

        return result.scalar_one_or_none()

    async def create_user(
        self,
        user: User,
    ) -> User:

        self.db.add(user)

        await self.db.flush()

        return user

    # ==========================================================
    # Save (persist dirty attributes, e.g. 2FA fields)
    # ==========================================================

    async def save(self):

        await self.update()

    # ==========================================================
    # User Keys
    # ==========================================================

    async def create_user_key(
        self,
        key: UserKey,
    ) -> UserKey:

        self.db.add(key)

        await self.db.flush()

        return key

    async def get_user_key(
        self,
        user_id: UUID,
    ) -> UserKey | None:

        result = await self.execute(select(UserKey).where(UserKey.user_id == user_id))

        return result.scalar_one_or_none()

    # ==========================================================
    # OTP
    # ==========================================================

    async def create_otp(
        self,
        otp: OTPCode,
    ) -> OTPCode:

        return await self.create(otp)

    async def get_latest_otp(
        self,
        email: str,
    ) -> OTPCode | None:

        result = await self.execute(
            select(OTPCode)
            .where(OTPCode.email == email)
            .where(OTPCode.is_used.is_(False))
            .where(OTPCode.expires_at > datetime.now(UTC))
            .order_by(OTPCode.created_at.desc())
            .limit(1)
        )

        return result.scalar_one_or_none()

    async def mark_otp_used(
        self,
        otp: OTPCode,
    ):

        updated = await self.db.execute(
            update(OTPCode)
            .where(
                OTPCode.id == otp.id,
                OTPCode.is_used.is_(False),
            )
            .values(
                is_used=True,
            )
            .execution_options(synchronize_session=False)
        )

        if updated.rowcount == 0:
            # Another request already consumed this OTP
            raise ValueError("OTP already used or expired.")

    async def increment_attempts(
        self,
        otp: OTPCode,
    ):

        otp.attempts += 1

        await self.update()

    async def delete_existing_otps(
        self,
        email: str,
    ):

        await self.execute(delete(OTPCode).where(OTPCode.email == email))

        await self.update()

    async def delete_expired_otps(
        self,
    ):

        await self.execute(delete(OTPCode).where(OTPCode.expires_at < datetime.now(UTC)))

        await self.update()

    # ==========================================================
    # Transaction Helpers
    # ==========================================================

    async def delete_old_used_otps(
        self,
        email: str,
    ):

        await self.execute(
            delete(OTPCode).where(
                OTPCode.email == email,
                OTPCode.is_used.is_(True),
                OTPCode.updated_at < datetime.now(UTC) - timedelta(hours=24),
            )
        )

        await self.update()

    async def rollback(self):

        await self.db.rollback()

    async def refresh_all(
        self,
        user: User,
        key: UserKey,
    ):

        await self.db.refresh(user)

        await self.db.refresh(key)
