from pydantic import BaseModel, Field

# ==========================================================
# Device Registration
# ==========================================================


class OneTimePreKeyUpload(BaseModel):
    key_id: int
    public_key: str = Field(max_length=1000)


class RegisterDeviceRequest(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    platform: str = Field(default="other", max_length=20)
    device_name: str | None = Field(default=None, max_length=100)
    platform_version: str | None = Field(default=None, max_length=50)
    app_version: str | None = Field(default=None, max_length=50)

    identity_key_public: str = Field(max_length=2000)
    identity_key_x25519: str = Field(max_length=2000)

    signed_prekey_public: str = Field(max_length=2000)
    signed_prekey_id: int
    signed_prekey_signature: str = Field(max_length=2000)

    one_time_prekeys: list[OneTimePreKeyUpload] = []


class RegisterDeviceResponse(BaseModel):
    success: bool = True
    device_id: str
    is_primary: bool

    # Present exactly once per account: when the recovery key was
    # just created by THIS registration. The code is shown on
    # screen and emailed; the salt + wrapped blob are what gets
    # stored server-side so any browser can unlock with the code.
    recovery_code: str | None = None
    recovery_salt: str | None = None
    recovery_wrapped_key: dict | None = None


# ==========================================================
# Key Bundle (what a client fetches to initiate X3DH)
# ==========================================================


class SignedPreKeyBundle(BaseModel):
    key_id: int
    public_key: str
    signature: str


class OneTimePreKeyBundle(BaseModel):
    key_id: int
    public_key: str


class DeviceBundle(BaseModel):
    device_id: str
    identity_key: str
    x25519_identity_key: str
    signed_prekey: SignedPreKeyBundle
    one_time_prekeys: list[OneTimePreKeyBundle] = []


class KeyBundleResponse(BaseModel):
    user_id: str
    devices: list[DeviceBundle]


# ==========================================================
# One-Time PreKey replenishment
# ==========================================================


class ReplenishPreKeysResponse(BaseModel):
    success: bool = True
    one_time_prekeys: list[OneTimePreKeyUpload]


# ==========================================================
# One-Time PreKey upload (client-generated)
# ==========================================================


class UploadPreKeysRequest(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    one_time_prekeys: list[OneTimePreKeyUpload] = []


# ==========================================================
# Device list / removal
# ==========================================================


class DeviceInfo(BaseModel):
    device_id: str
    device_name: str | None = None
    platform: str
    platform_version: str | None = None
    app_version: str | None = None
    is_primary: bool
    is_active: bool
    last_seen: str | None = None
    created_at: str | None = None


class DeviceListResponse(BaseModel):
    devices: list[DeviceInfo]


class DeviceUpdateRequest(BaseModel):
    device_name: str | None = None
    platform_version: str | None = None
    app_version: str | None = None


class DeviceActionResponse(BaseModel):
    success: bool = True
    message: str


# ==========================================================
# Signed PreKey Rotation
# ==========================================================


class RotateSignedPreKeyRequest(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    key_id: int
    public_key: str = Field(max_length=2000)
    signature: str = Field(max_length=2000)


class RotateSignedPreKeyResponse(BaseModel):
    success: bool = True
    key_id: int
    public_key: str
    signature: str
    expires_at: str | None = None
    purged: int = 0


# ==========================================================
# Device Trust (TOFU)
# ==========================================================


class DeviceTrustSetRequest(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    trust_level: str = Field(
        pattern=r"^(trusted|verified)$",
    )
    identity_key_fingerprint: str | None = Field(default=None, max_length=128)


class DeviceTrustInfo(BaseModel):
    device_id: str
    trust_level: str
    identity_key_fingerprint: str | None = None
    trusted_at: str | None = None


class DeviceTrustListResponse(BaseModel):
    trusts: list[DeviceTrustInfo]


class DeviceTrustActionResponse(BaseModel):
    success: bool = True
    trust_level: str
    message: str | None = None
