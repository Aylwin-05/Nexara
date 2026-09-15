import hashlib
import secrets
from hmac import compare_digest


class SecurityUtils:
    """
    Cryptographic helper functions used throughout Nexara.
    """

    OTP_LENGTH = 6

    # scrypt parameters for the 2FA PIN hash. Interactive-ish
    # cost: 14-bit N is ~50ms on modern hardware — fast enough
    # for a login but painful to brute-force offline.
    SCRYPT_N = 2**14
    SCRYPT_R = 8
    SCRYPT_P = 1
    SCRYPT_DKLEN = 64

    @staticmethod
    def generate_otp() -> str:
        """
        Generate a cryptographically secure 6-digit OTP.
        """
        return f"{secrets.randbelow(10**6):06d}"

    @staticmethod
    def hash_otp(otp: str) -> str:
        """
        Return a salted, KDF-stretched hash of an OTP.

        Reuses the scrypt PIN scheme (per-OTP random salt) so a DB
        leak is not enough for offline guessing of the 6-digit space:
        each guess costs a scrypt iteration instead of one SHA-256.
        """
        return SecurityUtils.hash_pin(otp)

    @staticmethod
    def verify_otp(plain_otp: str, hashed_otp: str) -> bool:
        """
        Constant-time OTP comparison against the scrypt hash.
        """
        return SecurityUtils.verify_pin(
            plain_otp,
            hashed_otp,
        )

    # ==========================================================
    # 2FA PIN hashing (scrypt + per-user random salt)
    # ==========================================================

    @staticmethod
    def hash_pin(pin: str) -> str:
        """
        Hash a 2FA PIN with scrypt and a fresh random salt.
        Returns "scrypt$<salt_hex>$<hash_hex>".
        """

        salt = secrets.token_bytes(16)

        digest = hashlib.scrypt(
            pin.encode("utf-8"),
            salt=salt,
            n=SecurityUtils.SCRYPT_N,
            r=SecurityUtils.SCRYPT_R,
            p=SecurityUtils.SCRYPT_P,
            dklen=SecurityUtils.SCRYPT_DKLEN,
        )

        return f"scrypt${salt.hex()}${digest.hex()}"

    @staticmethod
    def verify_pin(pin: str, stored: str | None) -> bool:
        """
        Constant-time verification of a PIN against a stored
        "scrypt$<salt_hex>$<hash_hex>" string.
        """

        if not stored:
            return False

        try:
            scheme, salt_hex, hash_hex = stored.split("$", 2)

            if scheme != "scrypt":
                return False

            salt = bytes.fromhex(salt_hex)

            digest = hashlib.scrypt(
                pin.encode("utf-8"),
                salt=salt,
                n=SecurityUtils.SCRYPT_N,
                r=SecurityUtils.SCRYPT_R,
                p=SecurityUtils.SCRYPT_P,
                dklen=SecurityUtils.SCRYPT_DKLEN,
            )

            return compare_digest(
                digest.hex(),
                hash_hex,
            )

        except (ValueError, TypeError):
            return False
