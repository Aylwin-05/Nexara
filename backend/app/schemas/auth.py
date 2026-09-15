from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

# ==========================================================
# Reusable Types
# ==========================================================

OTPCode = Annotated[
    str,
    Field(
        pattern=r"^\d{6}$",
        description="6-digit OTP",
    ),
]

TwoFAPin = Annotated[
    str,
    Field(
        pattern=r"^\d{6}$",
        description="6-digit two-step verification PIN",
    ),
]


# ==========================================================
# Requests
# ==========================================================


class SendOTPRequest(BaseModel):
    email: EmailStr


class VerifyOTPRequest(BaseModel):
    email: EmailStr

    otp: OTPCode


class RefreshTokenRequest(BaseModel):
    refresh_token: str = Field(max_length=500)


# ==========================================================
# Two-Step Verification (2FA PIN)
# ==========================================================


class EnableTwoFARequest(BaseModel):
    pin: TwoFAPin

    confirm_pin: TwoFAPin


class DisableTwoFARequest(BaseModel):
    pin: TwoFAPin


class VerifyTwoFARequest(BaseModel):
    two_fa_token: str = Field(max_length=500)

    pin: TwoFAPin


class ResetTwoFARequest(BaseModel):
    email: EmailStr

    otp: OTPCode


class TwoFAStatusResponse(BaseModel):
    two_fa_enabled: bool


class TwoFAChallengeResponse(BaseModel):
    """
    Returned by verify-otp when the account has 2FA enabled:
    no tokens are issued until the PIN is presented with the
    short-lived two_fa_token.
    """

    two_fa_required: bool = True

    two_fa_token: str

    email: EmailStr


# ==========================================================
# User Response
# ==========================================================


class UserResponse(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
    )

    id: UUID

    email: EmailStr

    username: str

    display_name: str

    bio: str | None = None

    avatar_url: str | None = None

    is_verified: bool

    is_active: bool

    online_status: str

    last_seen: datetime | None = None

    created_at: datetime

    updated_at: datetime


# ==========================================================
# Generic Responses
# ==========================================================


class MessageResponse(BaseModel):
    success: bool

    message: str


class SendOTPResponse(MessageResponse):
    pass


# ==========================================================
# Login Response
# ==========================================================


class TokenResponse(BaseModel):
    access_token: str

    refresh_token: str

    token_type: str = "Bearer"  # noqa: S105 - OAuth token_type field

    user: UserResponse
