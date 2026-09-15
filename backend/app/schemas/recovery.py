from pydantic import BaseModel, EmailStr, Field

OTP_PATTERN = r"^\d{6}$"


class RecoveryRequest(BaseModel):
    """
    Re-issue the account recovery code.

    secret_b64: the b64 32-byte sync secret from an unlocked
    browser. When present the SAME secret is re-wrapped under a
    new code (all sync copies stay valid). When omitted a fresh
    account key is minted (existing sync copies become readable
    only by browsers that already hold the old secret).
    """

    secret_b64: str | None = Field(
        default=None,
        description="b64 32-byte sync secret (optional).",
    )

    force_new: bool = Field(
        default=False,
        description=(
            "When true, mint a fresh account key even if existing "
            "sync copies would be orphaned. Only set after the user "
            "explicitly accepts losing access to the old history."
        ),
    )


class RecoveryVerifyRequest(BaseModel):
    """
    Final step of the "recover my code" flow: prove the link
    token AND an OTP for the account email, then receive the
    new recovery code. No session is required — the OTP is the
    proof (same model as a password reset).
    """

    token: str = Field(min_length=10)
    email: EmailStr
    otp: str = Field(pattern=OTP_PATTERN)
