from datetime import UTC, datetime, timedelta
from typing import Any

from app.core.config import settings
from jose import JWTError, jwt


class JWTService:
    """
    Handles JWT creation and verification.

    When JWT_PRIVATE_KEY / JWT_PUBLIC_KEY are configured the
    service signs with ES256 (ECDSA P-256); otherwise it
    falls back to the symmetric HS256 algorithm using
    SECRET_KEY.
    """

    def __init__(self):
        self._private_key = settings.JWT_PRIVATE_KEY
        self._public_key = settings.JWT_PUBLIC_KEY

        if self._private_key and self._public_key:
            self.algorithm = "ES256"
            self._sign_key = self._private_key
            self._verify_key = self._public_key
        else:
            self.algorithm = settings.JWT_ALGORITHM
            self._sign_key = settings.SECRET_KEY
            self._verify_key = settings.SECRET_KEY

        self.access_token_expire = settings.ACCESS_TOKEN_EXPIRE_MINUTES
        self.refresh_token_expire = settings.REFRESH_TOKEN_EXPIRE_DAYS

        self.two_fa_token_expire = settings.TWO_FA_TOKEN_EXPIRE_MINUTES

    # ======================================================
    # Access Token
    # ======================================================

    def create_access_token(
        self,
        user_id: str,
        email: str,
        *,
        ver: int = 0,
    ) -> str:

        expire = datetime.now(UTC) + timedelta(minutes=self.access_token_expire)

        payload = {
            "sub": user_id,
            "email": email,
            "type": "access",
            "ver": ver,
            "exp": expire,
        }

        return jwt.encode(
            payload,
            self._sign_key,
            algorithm=self.algorithm,
        )

    # ======================================================
    # Refresh Token
    # ======================================================

    def create_refresh_token(
        self,
        user_id: str,
        email: str,
        jti: str | None = None,
    ) -> str:

        expire = datetime.now(UTC) + timedelta(days=self.refresh_token_expire)

        payload: dict[str, Any] = {
            "sub": user_id,
            "email": email,
            "type": "refresh",
            "exp": expire,
        }

        if jti:
            payload["jti"] = jti

        return jwt.encode(
            payload,
            self._sign_key,
            algorithm=self.algorithm,
        )

    # ======================================================
    # Two-Factor Token (short-lived proof of OTP success)
    #
    # Issued when the user passes the email OTP but has 2FA
    # enabled. The login does not complete until the PIN is
    # presented together with this token; the short expiry
    # limits the window in which a stolen token is useful.
    # ======================================================

    def create_two_fa_token(
        self,
        user_id: str,
        email: str,
    ) -> str:

        expire = datetime.now(UTC) + timedelta(minutes=self.two_fa_token_expire)

        payload = {
            "sub": user_id,
            "email": email,
            "type": "two_fa",
            "exp": expire,
        }

        return jwt.encode(
            payload,
            self._sign_key,
            algorithm=self.algorithm,
        )

    def verify_two_fa_token(
        self,
        token: str,
    ) -> dict[str, Any] | None:

        payload = self.decode_token(token)

        if payload is None:
            return None

        if payload.get("type") != "two_fa":
            return None

        return payload

    # ======================================================
    # Decode
    # ======================================================

    def decode_token(
        self,
        token: str,
    ) -> dict[str, Any] | None:

        try:
            return jwt.decode(
                token,
                self._verify_key,
                algorithms=[self.algorithm],
            )

        except JWTError:
            return None

    # ======================================================
    # Validation
    # ======================================================

    def verify_access_token(
        self,
        token: str,
    ) -> dict[str, Any] | None:

        payload = self.decode_token(token)

        if payload is None:
            return None

        if payload.get("type") != "access":
            return None

        return payload

    def verify_refresh_token(
        self,
        token: str,
    ) -> dict[str, Any] | None:

        payload = self.decode_token(token)

        if payload is None:
            return None

        if payload.get("type") != "refresh":
            return None

        return payload
