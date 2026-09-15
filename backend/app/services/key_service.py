from uuid import UUID

from app.models.user import User
from app.models.user_key import UserKey
from app.repositories.user_key_repository import UserKeyRepository
from fastapi import HTTPException


class KeyService:
    """
    Handles public key management.

    Nexara design:

    • Client generates RSA key pair.
    • Client stores the private key locally.
    • Client uploads ONLY the Base64-encoded public key.
    • Backend stores the Base64 string exactly as received.
    """

    def __init__(
        self,
        repository: UserKeyRepository,
    ):
        self.repository = repository

    # ==========================================================
    # Upload Public Key
    # ==========================================================

    async def upload_public_key(
        self,
        current_user: User,
        public_key: str,
    ):

        existing = await self.repository.get_by_user_id(current_user.id)

        if existing:
            existing.public_key = public_key

            await self.repository.save(existing)

            await self.repository.commit()

            return {
                "success": True,
                "message": "Public key updated.",
            }

        key = UserKey(
            user_id=current_user.id,
            public_key=public_key,
        )

        await self.repository.create_key(key)

        await self.repository.commit()

        return {
            "success": True,
            "message": "Public key uploaded.",
        }

    # ==========================================================
    # Get Public Key
    # ==========================================================

    async def get_public_key(
        self,
        user_id: UUID,
    ):

        key = await self.repository.get_by_user_id(user_id)

        if key is None:
            raise HTTPException(
                status_code=404,
                detail="Public key not found.",
            )

        return {
            "public_key": key.public_key,
        }
