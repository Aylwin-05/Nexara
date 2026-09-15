import base64
import json
import logging
import os
import secrets
import time

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

logger = logging.getLogger(__name__)

# ==========================================================
# Account recovery code + sync secret
#
# Every account gets ONE 32-byte "sync secret" (created when its
# first recovery key is generated). It encrypts per-message sync
# copies so any browser of the account can read the full history.
#
# The server NEVER stores the secret in plaintext:
#
#   recovery_code     24-char code, shown on screen exactly once
#   recovery_salt     random 16 bytes (hex)
#   recovery_wrapped  AES-256-GCM(secret, PBKDF2(code, salt))
#
# The code is never stored and never emailed; a lost code goes
# through the /recovery link + OTP flow. A stolen database
# therefore yields ciphertexts + a wrapped key that is only
# usable by guessing the code (2^~119 candidates).
# ==========================================================

RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
RECOVERY_GROUPS = 4
RECOVERY_GROUP_LEN = 6
PBKDF2_ITERATIONS = 600_000
SYNC_SECRET_BYTES = 32
SALT_BYTES = 16
CODE_ENTROPY_BITS = len(RECOVERY_ALPHABET).bit_length() * 24
TOKEN_TTL_SECONDS = 30 * 60


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def _unb64(text: str) -> bytes:
    return base64.b64decode(text)


def format_code(code: str) -> str:
    """XXXXXX-XXXXXX-XXXXXX-XXXXXX display form."""
    groups = [code[i : i + RECOVERY_GROUP_LEN] for i in range(0, len(code), RECOVERY_GROUP_LEN)]
    return "-".join(groups)


def generate_recovery_code() -> str:
    """Random 24-char code over an unambiguous alphabet."""
    return "".join(
        secrets.choice(RECOVERY_ALPHABET) for _ in range(RECOVERY_GROUPS * RECOVERY_GROUP_LEN)
    )


def derive_wrap_key(code: str, salt: bytes) -> bytes:
    """PBKDF2-HMAC-SHA256 wrap key from the recovery code."""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=PBKDF2_ITERATIONS,
    )
    return kdf.derive(code.encode("utf-8"))


def _wrap_secret(secret: bytes, code: str, salt: bytes) -> dict:
    """AES-256-GCM wrap of a secret under PBKDF2(code, salt)."""
    wrap_key = derive_wrap_key(code, salt)
    nonce = os.urandom(12)
    wrapped = AESGCM(wrap_key).encrypt(nonce, secret, None)
    return {
        "nonce": _b64(nonce),
        "data": _b64(wrapped),
    }


def create_recovery_key() -> dict:
    """
    Generate a fresh (code, salt, wrapped secret) triple.

    Returns the code in RAW form (the caller shows it to the user
    once — it is never stored and never emailed), plus the salt +
    wrapped blob that ARE stored on the user row.
    """
    code = generate_recovery_code()
    salt = os.urandom(SALT_BYTES)
    secret = os.urandom(SYNC_SECRET_BYTES)

    return {
        "code": code,
        "code_display": format_code(code),
        "salt": salt.hex(),
        "wrapped_key": _wrap_secret(secret, code, salt),
    }


def rewrap_existing_secret(secret_b64: str) -> dict:
    """
    Re-wrap an EXISTING sync secret under a brand-new code.

    Used by "I lost my recovery code": a browser that still holds
    the secret sends it (over TLS, authenticated), the server
    mints a fresh code + salt and stores the new wrapped blob.
    All existing sync copies stay valid — the secret did not
    change, only the code that unlocks it.
    """
    try:
        secret = base64.b64decode(secret_b64, validate=True)
    except Exception:
        raise ValueError("Invalid sync secret encoding.") from None
    if len(secret) != SYNC_SECRET_BYTES:
        raise ValueError("Invalid sync secret length.")

    code = generate_recovery_code()
    salt = os.urandom(SALT_BYTES)

    return {
        "code": code,
        "code_display": format_code(code),
        "salt": salt.hex(),
        "wrapped_key": _wrap_secret(secret, code, salt),
    }


def unlock_sync_secret(code: str, salt_hex: str, wrapped_key: dict) -> str | None:
    """
    Return the b64 account sync secret for a valid code, else None.

    Wrong codes (or a tampered blob) fail the AES-GCM tag check.
    """
    try:
        salt = bytes.fromhex(salt_hex)
        wrap_key = derive_wrap_key(code, salt)
        secret = AESGCM(wrap_key).decrypt(
            _unb64(wrapped_key["nonce"]),
            _unb64(wrapped_key["data"]),
            None,
        )
    except Exception:
        logger.info("Recovery unlock failed (bad code or blob).")
        return None
    if len(secret) != SYNC_SECRET_BYTES:
        return None
    return _b64(secret)


# ==========================================================
# Recovery link tokens
#
# The "recover my code" flow delivers the new code ONLY after the
# user clicks the emailed link AND proves the OTP. The code is
# held in a short-lived store keyed by an unguessable token
# (32 random bytes, embedded in the link), expiring after
# TOKEN_TTL_SECONDS. It never touches the database, so a stolen
# DB still yields nothing.
#
# When REDIS_URL is configured the tokens live in Redis (safe
# for multi-worker deployments); otherwise an in-process dict
# is used (single-worker fallback).
# ==========================================================


class _RedisTokenStore:
    """Redis-backed recovery token store."""

    _PREFIX = "nexara:recovery:token:"
    _USER_PREFIX = "nexara:recovery:user:"

    def __init__(self, ttl_seconds: int = TOKEN_TTL_SECONDS):
        self._ttl = ttl_seconds
        self._client = None

    def _get_client(self):
        if self._client is None:
            import redis.asyncio as aioredis
            from app.core.config import settings

            self._client = aioredis.from_url(
                settings.REDIS_URL,
                encoding="utf-8",
                decode_responses=True,
            )
        return self._client

    async def issue(
        self,
        user_id: str,
        email: str,
        code: str,
        code_display: str,
    ) -> str:
        token = secrets.token_urlsafe(32)
        client = self._get_client()
        entry = json.dumps(
            {
                "user_id": str(user_id),
                "email": email.lower(),
                "code": code,
                "code_display": code_display,
            }
        )
        pipe = client.pipeline()
        pipe.set(
            f"{self._PREFIX}{token}",
            entry,
            ex=self._ttl,
        )
        pipe.set(
            f"{self._USER_PREFIX}{user_id}",
            token,
            ex=self._ttl,
        )
        await pipe.execute()
        return token

    async def revoke_for_user(self, user_id: str) -> None:
        client = self._get_client()
        previous = await client.get(f"{self._USER_PREFIX}{user_id}")
        if previous is not None:
            pipe = client.pipeline()
            pipe.delete(f"{self._PREFIX}{previous}")
            pipe.delete(f"{self._USER_PREFIX}{user_id}")
            await pipe.execute()

    async def take(self, token: str) -> dict | None:
        client = self._get_client()
        raw = await client.get(f"{self._PREFIX}{token}")
        if raw is None:
            return None
        entry = json.loads(raw)
        await client.delete(f"{self._PREFIX}{token}")
        return entry

    async def discard(self, token: str) -> None:
        client = self._get_client()
        await client.delete(f"{self._PREFIX}{token}")

    async def clear(self) -> None:
        client = self._get_client()
        keys = []
        async for key in client.scan_iter(f"{self._PREFIX}*"):
            keys.append(key)
        async for key in client.scan_iter(f"{self._USER_PREFIX}*"):
            keys.append(key)
        if keys:
            await client.delete(*keys)


class _MemoryTokenStore:
    """In-memory fallback (single worker only)."""

    def __init__(self, ttl_seconds: int = TOKEN_TTL_SECONDS):
        self._ttl = ttl_seconds
        self._tokens: dict[str, dict] = {}
        self._user_tokens: dict[str, str] = {}

    async def issue(
        self,
        user_id: str,
        email: str,
        code: str,
        code_display: str,
    ) -> str:
        token = secrets.token_urlsafe(32)
        self._tokens[token] = {
            "user_id": str(user_id),
            "email": email.lower(),
            "code": code,
            "code_display": code_display,
            "expires_at": time.monotonic() + self._ttl,
        }
        self._user_tokens[str(user_id)] = token
        return token

    async def revoke_for_user(self, user_id: str) -> None:
        previous = self._user_tokens.pop(str(user_id), None)
        if previous is not None:
            self._tokens.pop(previous, None)

    async def take(self, token: str) -> dict | None:
        entry = self._tokens.get(token)
        if entry is None:
            return None
        if time.monotonic() > entry["expires_at"]:
            self._tokens.pop(token, None)
            return None
        return entry

    async def discard(self, token: str) -> None:
        self._tokens.pop(token, None)
        for uid, tok in list(self._user_tokens.items()):
            if tok == token:
                self._user_tokens.pop(uid, None)

    async def clear(self) -> None:
        self._tokens.clear()
        self._user_tokens.clear()


def _create_store():
    from app.core.config import settings

    if settings.REDIS_URL:
        return _RedisTokenStore()
    return _MemoryTokenStore()


recovery_token_store = _create_store()
