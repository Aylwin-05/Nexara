from functools import lru_cache
from pathlib import Path

from pydantic_settings import (
    BaseSettings,
    SettingsConfigDict,
)

# ==========================================================
# Environment
# ==========================================================

BASE_DIR = Path(__file__).resolve().parent.parent.parent

ENV_FILE = BASE_DIR / ".env"


class Settings(BaseSettings):

    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ======================================================
    # App
    # ======================================================

    APP_NAME: str = "Nexara"
    APP_ENV: str = "development"
    DEBUG: bool = True
    LOG_LEVEL: str = "INFO"
    SENTRY_DSN: str = ""

    # ======================================================
    # Database
    # ======================================================

    DATABASE_URL: str

    # ======================================================
    # JWT
    # ======================================================

    SECRET_KEY: str = ""
    JWT_ALGORITHM: str = "HS256"

    JWT_PRIVATE_KEY: str = ""
    JWT_PUBLIC_KEY: str = ""

    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    TWO_FA_TOKEN_EXPIRE_MINUTES: int = 10

    # ======================================================
    # Cookies (refresh token transport)
    # ======================================================

    COOKIE_SECURE: bool = False
    COOKIE_SAMESITE: str = "strict"
    COOKIE_DOMAIN: str | None = None

    # ======================================================
    # CORS / Hosts
    # ======================================================

    CORS_ORIGINS: str = (
        "http://localhost:5173,http://127.0.0.1:5173"
    )
    ALLOWED_HOSTS: str = "*"

    # ======================================================
    # Frontend (link emails point back to the app)
    # ======================================================

    FRONTEND_URL: str = "http://localhost:5173"

    # ======================================================
    # Redis (rate limiting; falls back to in-memory)
    # ======================================================

    REDIS_URL: str | None = None

    # ======================================================
    # Cloudflare Turnstile (CAPTCHA on auth endpoints)
    # ======================================================

    TURNSTILE_SECRET_KEY: str = ""

    # ======================================================
    # SMTP
    # ======================================================

    SMTP_HOST: str
    SMTP_PORT: int

    SMTP_USERNAME: str
    SMTP_PASSWORD: str

    SMTP_FROM_EMAIL: str
    SMTP_FROM_NAME: str

    # ======================================================
    # WebRTC calls (STUN/TURN ICE servers)
    #
    # STUN is free and public; TURN is needed when both peers
    # sit behind symmetric NATs. When TURN_URLS is empty the
    # API only returns the public STUN server (calls may fail
    # for restricted networks). Format: "turn:host:3478?transport=udp"
    # (comma-separated for multiple relays).
    # ======================================================

    TURN_URLS: str = ""
    TURN_USERNAME: str = ""
    TURN_PASSWORD: str = ""

    # When set, /call/config mints short-lived per-user TURN
    # credentials (coturn REST / HMAC with `use-auth-secret`) instead
    # of handing every authenticated user the shared static pair.
    # Overrides TURN_USERNAME/TURN_PASSWORD for the minted users.
    TURN_SECRET: str = ""

    # ======================================================
    # Request body limit (bytes)
    #
    # Hard ceiling on the size of any single HTTP request body.
    # File uploads are streamed to disk (and each route enforces
    # its own tighter size cap), so this is a final memory-DoS
    # backstop rather than a per-route setting. It must be at
    # least as large as the biggest permitted upload (video /
    # encrypted: 500 MB) plus multipart overhead.
    # ======================================================

    MAX_REQUEST_BODY_SIZE: int = 550 * 1024 * 1024

    # ======================================================
    # WebAuthn (Passkeys)
    # ======================================================

    WEBAUTHN_RP_ID: str = "localhost"
    WEBAUTHN_RP_NAME: str = "Nexara"


@lru_cache
def get_settings():

    instance = Settings()

    if instance.APP_ENV == "production":

        problems = []

        if instance.DEBUG:
            problems.append(
                "DEBUG must be false in production"
            )

        has_es256 = bool(
            instance.JWT_PRIVATE_KEY and instance.JWT_PUBLIC_KEY
        )

        if not has_es256:
            if (
                not instance.SECRET_KEY
                or instance.SECRET_KEY == "CHANGE_ME"
                or len(instance.SECRET_KEY) < 32
            ):
                problems.append(
                    "SECRET_KEY must be a random value of at "
                    "least 32 characters, or set JWT_PRIVATE_KEY "
                    "/ JWT_PUBLIC_KEY for ES256"
                )

        if instance.ALLOWED_HOSTS == "*":
            problems.append(
                "ALLOWED_HOSTS must be pinned to real hostnames "
                "in production"
            )

        if not instance.COOKIE_SECURE:
            problems.append(
                "COOKIE_SECURE must be true in production "
                "(HTTPS only)"
            )

        if not all([
            instance.SMTP_HOST,
            instance.SMTP_USERNAME,
            instance.SMTP_PASSWORD,
        ]):
            problems.append(
                "SMTP_HOST, SMTP_USERNAME, SMTP_PASSWORD "
                "are required in production"
            )

        if problems:
            raise RuntimeError(
                "Invalid production configuration:\n  - "
                + "\n  - ".join(problems)
            )

    return instance


settings = get_settings()
