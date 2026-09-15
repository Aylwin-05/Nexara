import logging
from datetime import UTC, datetime, timedelta

from app.core.config import settings
from app.models.otp import OTPCode
from app.models.user import User
from app.repositories.auth_repository import AuthRepository
from app.services.email_service import EmailService
from app.utils.security import SecurityUtils
from fastapi import BackgroundTasks

logger = logging.getLogger(__name__)


class AuthService:
    """
    Handles authentication business logic.

    In the E2EE architecture:

    • Backend NEVER generates encryption keys.
    • Backend NEVER stores private keys.
    • Backend only authenticates users.
    """

    OTP_EXPIRY_MINUTES = 5
    MAX_ATTEMPTS = 10

    def __init__(
        self,
        repository: AuthRepository,
    ):
        self.repository = repository
        self.email_service = EmailService()

    # =====================================================
    # SEND OTP
    # =====================================================

    async def send_otp(
        self,
        email: str,
        client_ip: str | None = None,
        background_tasks: BackgroundTasks | None = None,
    ) -> bool:

        await self.repository.delete_expired_otps()
        # Delete used OTPs older than 24 hours to prevent accumulation
        await self.repository.delete_old_used_otps(email)

        otp = SecurityUtils.generate_otp()

        otp_hash = SecurityUtils.hash_otp(otp)

        otp_record = OTPCode(
            email=email,
            otp_hash=otp_hash,
            expires_at=datetime.now(UTC) + timedelta(minutes=self.OTP_EXPIRY_MINUTES),
        )

        await self.repository.create_otp(otp_record)

        await self.repository.commit()

        # ==================================================
        # DEVELOPMENT shortcut: print the OTP to the server
        # console instead of sending real mail (DEBUG only)
        # ==================================================

        if settings.DEBUG:
            logger.warning(
                "[DEV] OTP for %s: %s",
                email,
                otp,
            )

        # ==================================================
        # Send the email AFTER the response goes out when a
        # BackgroundTasks handle is provided: slow SMTP (or a
        # retry cycle) must not outlive the client's timeout
        # and turn a successful send into a UI error.
        # ==================================================

        if background_tasks is not None:

            async def _deliver():

                try:
                    await self.email_service.send_otp_email(
                        recipient_email=email,
                        otp=otp,
                    )

                except Exception:
                    logger.exception(
                        "OTP email delivery failed for %s",
                        email,
                    )

            background_tasks.add_task(_deliver)

        else:
            await self.email_service.send_otp_email(
                recipient_email=email,
                otp=otp,
            )

        return True

    # =====================================================
    # TWO-STEP VERIFICATION (2FA PIN)
    # =====================================================

    async def enable_two_fa(
        self,
        user: User,
        pin: str,
    ) -> dict:

        user.two_fa_secret = SecurityUtils.hash_pin(pin)

        user.two_fa_enabled = True

        await self.repository.save()

        await self.repository.commit()

        logger.info(
            "Two-step verification enabled: user=%s",
            user.id,
        )

        return {
            "two_fa_enabled": True,
        }

    async def disable_two_fa(
        self,
        user: User,
        pin: str,
    ) -> dict:

        if not SecurityUtils.verify_pin(
            pin,
            user.two_fa_secret,
        ):
            raise ValueError("The PIN you entered is incorrect.")

        user.two_fa_secret = None

        user.two_fa_enabled = False

        await self.repository.save()

        await self.repository.commit()

        logger.info(
            "Two-step verification disabled: user=%s",
            user.id,
        )

        return {
            "two_fa_enabled": False,
        }

    async def verify_two_fa(
        self,
        email: str,
        pin: str,
    ) -> User | None:
        """
        Returns the user only when the PIN matches their
        stored 2FA secret. The caller issues tokens.
        """

        user = await self.repository.get_user_by_email(email)

        if user is None or not user.two_fa_enabled:
            return None

        if not SecurityUtils.verify_pin(
            pin,
            user.two_fa_secret,
        ):
            return None

        return user

    async def reset_two_fa(
        self,
        email: str,
        otp: str,
    ):
        """
        Recovery path: proving email control via a fresh OTP
        disables 2FA so the owner is never locked out.
        """

        result = await self.verify_otp(
            email,
            otp,
        )

        if result is None:
            return None

        user = result["user"]

        user.two_fa_secret = None

        user.two_fa_enabled = False

        await self.repository.save()

        await self.repository.commit()

        # The `onupdate=func.now()` flush expires updated_at;
        # reload the row so serializing the user later (Pydantic
        # reads attributes synchronously) never hits a lazy load.
        await self.repository.refresh(user)

        logger.warning(
            "Two-step verification reset via OTP: user=%s",
            user.id,
        )

        return {
            "user": user,
        }

    # =====================================================
    # VERIFY OTP
    # =====================================================

    async def verify_otp(
        self,
        email: str,
        otp: str,
    ):

        otp_record = await self.repository.get_latest_otp(email)

        if otp_record is None:
            return None

        if otp_record.is_used:
            return None

        if otp_record.attempts >= self.MAX_ATTEMPTS:
            return None

        expires_at = otp_record.expires_at

        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)

        if datetime.now(UTC) > expires_at:
            return None

        if not SecurityUtils.verify_otp(
            otp,
            otp_record.otp_hash,
        ):
            await self.repository.increment_attempts(otp_record)

            await self.repository.commit()

            return None

        try:
            await self.repository.mark_otp_used(otp_record)

        except ValueError:
            # OTP was consumed by a concurrent request
            await self.repository.commit()

            return None

        await self.repository.commit()

        logger.info(
            "OTP verified and marked used: email=%s",
            email,
        )

        # =====================================================
        # Existing User
        # =====================================================

        existing_user = await self.repository.get_user_by_email(email)

        if existing_user:
            await self.repository.commit()

            return {
                "user": existing_user,
            }

        # =====================================================
        # New User Registration
        # =====================================================

        base_username = email.split("@")[0].strip().lower()

        username = base_username

        counter = 1

        # Generate a unique username
        while await self.repository.get_user_by_username(username):
            username = f"{base_username}{counter}"

            counter += 1

        user = User(
            email=email,
            username=username,
            display_name=username,
            is_verified=True,
        )

        try:
            await self.repository.create_user(user)

            await self.repository.commit()

            await self.repository.refresh(user)

        except Exception:
            await self.repository.rollback()

            raise

        return {
            "user": user,
        }
