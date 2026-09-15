from pydantic import BaseModel, Field

# ==========================================================
# Upload Public Key
# ==========================================================


class UploadPublicKeyRequest(BaseModel):
    public_key: str = Field(max_length=2000)


# ==========================================================
# Public Key Response
# ==========================================================


class PublicKeyResponse(BaseModel):
    public_key: str


# ==========================================================
# Generic Response
# ==========================================================


class KeyUploadResponse(BaseModel):
    success: bool
    message: str
