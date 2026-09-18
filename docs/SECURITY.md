# Nexara Security

Nexara is a privacy-first messenger: **encryption happens only in the browser**, and
the backend stores ciphertext, encrypted key material, and metadata — never plaintext,
never private keys.

## Threat model

What the server can and cannot see:

- **Ciphertext only.** Messages, attachments, avatars, story media, group keys, and
  cross-device sync envelopes are AES-256-GCM encrypted client-side. Server-side one-time
  prekeys are consumed atomically; a stolen database yields no readable conversation.
- **Metadata is visible to the server** (who talks to whom, when) — like every messenger.
  Disappearing messages are hard-deleted server-side on expiry.
- **Identity** is enforced with X25519/Ed25519 key bundles and identity-key pins
  (safety numbers). An attacker with server root cannot silently swap keys without the
  clients rejecting the mismatch at the first ratchet step.
- **Multi-device:** each device holds its own private keys; a compromised device exposes
  only its own sessions, never the account's keys.

## Cryptographic posture

- Key agreement: X3DH (X25519 + signed prekey + one-time prekeys), double ratchet.
- Data at rest: private keys never leave the device (IndexedDB / KeyStore).
- Media: attachment AES keys are wrapped per participant; thumbnails are generated and
  encrypted **client-side**, so the server never decodes media.
- Calls: WebRTC with Insertable Streams frame encryption.
- Passwords: Argon2 (passlib) / scrypt OTP hashes.

## Authentication

- Email OTP login with rotating **HttpOnly** refresh-token cookie, refresh-token family
  and reuse detection (replayed tokens revoke the family), and optional two-step
  verification. Access tokens live in memory (no XSS-surfable storage).
- Passkeys (WebAuthn) supported alongside OTP.
- Account deletion removes server-side material.

## Defense in depth

| Layer | Mechanism |
|---|---|
| Transport | TLS front (nginx) with HSTS, CSP, `X-Frame-Options: DENY`, nosniff, strict Referrer-Policy |
| App | Rate-limited auth endpoints (Redis or in-memory), Cloudflare-style Turnstile hook, request-id tracing, global JSON error handling |
| API | TrustedHost allow-list, strict CORS origins, request-body size backstop, per-upload size caps |
| Uploads | Magic-byte sniffing, strict MIME allow-list, SVG rejected, served as downloads with `Content-Disposition: attachment` |
| WebSocket | Auth via `Sec-WebSocket-Protocol` subprotocol (never URL tokens) |
| DB | Row-Level Security (RLS) layered on the app's user-scoped queries, system-scope only for maintenance tasks |
| Secrets | None committed; `.env` git-ignored; pre-commit runs gitleaks + `detect-private-key` |

## Production configuration requirements

The app refuses to start in `APP_ENV=production` unless:

- `DEBUG=false`
- `COOKIE_SECURE=true`
- `ALLOWED_HOSTS` is pinned
- `SECRET_KEY` ≥ 32 chars (or ES256 key pair set)
- SMTP credentials present

See [DEPLOYMENT.md](DEPLOYMENT.md) for the full checklist, and [../.env.example](../.env.example)
for safe templates.

## Verifying a deployment

1. `docker compose ... run --rm backend python -m pytest test_all.py` — 205 API + crypto
   integration tests against a persistent loop (fallback sqlite) or live Postgres.
2. `npm test`, `npx tsc --noEmit`, `npm run build` in `frontend`.
3. CI (`.github/workflows/ci.yml`) additionally runs migrations on a **fresh** Postgres 16
   and Trivy (`CRITICAL,HIGH`) over both images.
4. `gitleaks detect .` — no secrets in the tree.

## Reporting a vulnerability

Open a **private** issue on the repository. Do not post exploit details publicly.
Include the affected endpoint/flow, the impact, and a minimal repro. We treat crypto and
auth bugs as urgent.