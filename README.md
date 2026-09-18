# Nexara

> *Nexara* — from **nexus** (connection) + **ara** (sacred space).

A privacy-first, end-to-end encrypted messaging platform.

**Frontend:** React 19 + Vite · **Backend:** FastAPI + SQLAlchemy + Alembic · **Storage:** PostgreSQL · **Cache/Rate-limit:** Redis · **Crypto:** X25519 / Ed25519 / AES-256-GCM, Double Ratchet (Signal-style).

## Features

- Email OTP authentication with HttpOnly refresh-token rotation, refresh-token family (reuse detection), and optional two-step verification
- End-to-end encryption: X3DH key agreement + double ratchet, AES-256-GCM keyed by the ratchet (client-side only)
- Multi-device key bundles with one-time prekey replenishment and identity-key pinning / safety numbers
- Real-time messaging, typing indicators, presence, delivered/read receipts over a user-scoped WebSocket
- Group chats with admin roles, invite links, and per-participant key wrapping (no WhatsApp-style broadcast groups or communities — members are added by request)
- Client-side encrypted images, files, voice notes, and encrypted avatars; client-side generated thumbnails so the server still only ever sees ciphertext
- Media message features: view-once media, disappearing messages, replies, edits, delete-for-me / delete-for-everyone, forwarding, reactions, stars, media gallery, message search
- Stories (24 h) with view receipts and privacy levels
- E2EE voice/video calls (WebRTC + Insertable Streams frame encryption)
- Live location sharing as a transient E2EE `location` message within a conversation
- Screen-security privacy blur (opaque the app preview / switch-away without locking the ratchet)
- Passkey (WebAuthn) login alongside the email OTP flow
- Friends and contacts with block lists and fine-grained privacy toggles
- App lock (peppered HMAC PIN with lockout) and Web Push notifications with redacted payloads
- Prometheus-compatible metrics endpoint (`/metrics`) plus a structured `/health` probe; horizontally scalable multi-worker deployment (gunicorn + Redis fan-out)
- Rate-limited endpoints (Redis or in-memory), global JSON error handling, request-id tracing, CSP/HSTS headers

## Architecture

Crypto happens **only in the browser**. The backend stores ciphertext, encrypted AES keys, and metadata — it never sees plaintext or private keys. Encryption flows:

```
Sender                                                      Recipient
  |  X3DH (X25519 + signed prekey + OPK) --------> session  |
  |  Double ratchet / AES-GCM ciphertext -------------------> decrypt
  |                                                        |
  |  Attachment AES key encrypted for each participant       |
```

## Documentation

- [docs/ARCHITECTURE.md](docs/architecture.md) — system design, data flows
- [docs/API.md](docs/API.md) — full endpoint reference
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Docker/TLS/backups/scaling
- [docs/SECURITY.md](docs/SECURITY.md) — threat model, hardening, reporting
- [docs/TURN_SERVER_SETUP.md](docs/TURN_SERVER_SETUP.md) — standalone coturn

## Development

Prerequisites: **PostgreSQL 14+** running locally on `:5432` (create the
`nexara` database and match the credentials in `backend/.env`). Redis is
optional — without `REDIS_URL` the app falls back to in-memory rate limiting
(fine for one local instance). Mail: the `.env` `SMTP_*` values for real OTP
delivery.

### Backend

```bash
cd backend
python -m venv .venv && .venv\Scripts\activate   # or source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env                              # fill in values
alembic upgrade head
uvicorn app.main:app --reload                     # http://localhost:8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173, proxies /api + /ws to :8000
```

Open **http://localhost:5173** — sign up with a real inbox address; the OTP
arrives by email (Gmail app password recommended).

### Tests

```bash
cd backend && python -m pytest test_all.py    # 205 tests
cd frontend && npm test                        # 34 tests
```

> **Note on multiple workers:** for local development with `uvicorn --reload`, leave `REDIS_URL` unset. When you run multiple workers (see `gunicorn.conf.py`), provide `REDIS_URL` so the WebSocket fan-out (presence, events, live location) shares state across workers.

## Production (Docker)

For the compact single-node stack:

```bash
cp .env.example .env    # SECRET_KEY, SMTP_*, CORS_ORIGINS
docker compose up --build
```

For a multi-worker / horizontally scaled profile (gunicorn with several workers and a shared Redis bus) use `docker-compose.prod.yml` instead — see `backend/gunicorn.conf.py` and `backend/core/redis_config.py`.

- nginx serves the SPA and proxies `/api`, `/uploads`, and `/ws` to the backend
- postgres and redis run as managed services with health checks
- `alembic upgrade head` runs automatically at backend startup

## Security Notes

- Access tokens live in memory; the refresh token is a rotating `HttpOnly` cookie
- WebSocket auth uses the `Sec-WebSocket-Protocol` subprotocol, never the URL
- Set `COOKIE_SECURE=true`, a locked-down `CORS_ORIGINS`/`ALLOWED_HOSTS`, and `DEBUG=false` in production

## Roadmap

See [ROADMAP.md](ROADMAP.md) for planned features (message search, hosted TURN, P2P session-key backup, more clients).

## License

MIT