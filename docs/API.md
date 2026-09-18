# Nexara API

Base URL: `/api/v1` (external deployments reverse-proxy it; see [DEPLOYMENT.md](DEPLOYMENT.md)).
Interactive reference: `GET /docs` (Swagger UI) or `GET /redoc`.

All request/response bodies are JSON. Errors are always JSON:

```json
{
  "detail": "Human-readable error",
  "request_id": "<uuid>"
}
```

Validation failures return `422` with an `errors` array (`field`, `message`).

## Authentication

- **Access token** — `Authorization: Bearer <access_token>` header on every request.
  Short-lived (15 min by default), held **in memory only** by the client.
- **Refresh token** — rotating `HttpOnly` cookie (`nexara_refresh`), `samesite=strict`,
  renewed on every use; reuse of a rotated token revokes the whole token family.
- All endpoints below except `auth/*`, `users/search`, `users/check-username`, `/health`,
  `/healthz`, and `/metrics` (dev) require a valid access token.
- WebSocket (see [WebSocket](#websocket)) authenticates via the
  `Sec-WebSocket-Protocol: <access_token>` subprotocol — never via URL.

## Conventions

- Pagination / list shape: resources are returned inside `{"items": [...]}`.
- `client_message_id` (UUID) on message sends makes retries idempotent.
- List routes on some routers use a literal trailing slash (`/api/v1/friends/`,
  `/api/v1/conversations/`, `/api/v1/stories/`, `/api/v1/blocks/`). The app runs with
  `redirect_slashes=false`, so the client must call the exact spelling.

## Auth (`/auth`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/send-otp` | Send a one-time code to an email (rate-limited) |
| POST | `/verify-otp` | Exchange code for `access_token` + refresh cookie |
| GET | `/two-fa/status` | Two-step verification state |
| PUT | `/two-fa` | Enable two-step verification |
| DELETE | `/two-fa` | Disable (needs current code) |
| POST | `/two-fa/verify` | Verify a 2FA code during sign-in |
| POST | `/two-fa/reset` | 2FA reset flow |
| POST | `/refresh` | Silent refresh → new access token |
| POST | `/logout` | Rotate/revoke refresh token |
| DELETE | `/account` | Delete account + all data |

## Users (`/users`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/me` | Current profile (auth) |
| PATCH | `/me` | Update profile / username / pronouns |
| GET | `/search` | Search users by username |
| GET | `/check-username` | Username availability |
| POST | `/avatar` | Upload encrypted avatar |
| GET | `/{user_id}/avatar` | Fetch avatar metadata |

## Devices (`/devices`) — multi-device key bundles

| Method | Path | Purpose |
|---|---|---|
| POST | `/register` | Register a device (uploads X25519/Ed25519 keys) |
| GET | `/{user_id}/bundle` | Fetch a user's signed prekey + one-time prekeys |
| POST | `/prekeys/upload` / `/prekeys/signed` | Prekey replenishment |
| POST | `/trust` / GET `/trust` / DELETE `/trust/{device_id}` | Identity trust / safety numbers |
| GET | `/me` | List my devices |
| PATCH | `/{device_id}` | Rename device |
| DELETE | `/{device_id}` | Revoke device |

## Recovery (`/recovery`)

Cross-device session-sync: `POST /request`, `POST /verify`, `GET /unlock`.
Client-unlock material is encrypted with a recovery-code-derived key; the server
only ever stores wrapped ciphertext.

## Friends (`/friends`)

`POST /request`, `GET /pending`, `POST /accept`, `POST /reject`,
`GET /` (list), `DELETE /{friendship_id}` (unfriend).

## Conversations (`/conversations`)

- `POST /private` — create DM
- `POST /group` — create group (member requests, admin roles)
- `GET /`, `GET /{conversation_id}` — list / detail
- `PATCH /{id}`, `PATCH /{id}/group` — update / manage groups
- `POST /{id}/group/add|leave|remove|admin` — membership management
- `POST /join-with-link`, `GET|POST|DELETE /{id}/group/invite-link`
- `POST /{id}/avatar`, `GET /{id}/avatar`
- `POST /{id}/delete-request|delete-confirm|delete-cancel` — two-phase conversation delete

## Messages (`/messages`)

- `POST /send` — send an E2EE message (envelope + optional recipient key wrappers)
- `GET /{conversation_id}` — fetch history
- `PUT /{id}/edit`, `PUT /{id}/reaction`, `PUT /{id}/star`, `PUT /{id}/pin`
  (+ `/pinned/{conversation_id}`, `/starred`)
- `GET /search/{conversation_id}` — server-side search (client filters ciphertext metadata)
- `POST /{id}/view-once-opened` — consume a view-once message
- `DELETE /{id}` (everyone) / `DELETE /{id}/me` (me)
- `PUT /{id}/sync-envelope` — cross-device snapshot
- `POST /read-all/{conversation_id}` — mark read

## Attachments (`/attachments`)

- `POST /upload/{message_id}` — stream ciphertext to disk (per-route size caps,
  magic-byte sniffing, SVG rejected)
- `POST|GET /{id}/thumbnail` — client-generated encrypted thumbnails only
- `GET /{id}` — download (auth + per-recipient key)
- `PUT /{id}/sync-blob`, `DELETE /{id}`

## Keys (`/keys`)

- `POST /public` — publish key bundle
- `GET /{user_id}` — fetch a user's public keys

## Stories (`/stories`)

`POST /`, `GET /feed`, `POST /{id}/view` (view receipts),
`POST|DELETE /{id}/react`, `POST /{id}/reply`, `GET /{id}/media`, `DELETE /{id}`.

## Push (`/push`) — Web Push / VAPID

`GET /vapid-public-key`, `POST /subscribe`, `GET /subscriptions`, `DELETE /subscriptions/{id}`.
Payloads are redacted; a stored trigger only nudges the client to sync.

## Blocks & Privacy (`/blocks`)

`POST /`, `DELETE /{user_id}`, `GET /`, `GET /privacy`, `PATCH /privacy`.

## Call (`/call`)

`GET /config` (STUN + optional short-lived TURN creds), `POST /log`,
`PUT /{log_id}/end`, `GET /logs`.

## Observability

- `GET /healthz` — L4 orchestration probe (DB only)
- `GET /health` — structured (uptime, database, redis, environment)
- `GET /metrics` — Prometheus text format (dev: open; prod: requires auth)

## WebSocket

- **Connected in** the authenticated API router — path used by the client:
  `GET /ws/me` with subprotocol = access token.
- Events: messages, typing, presence, read receipts, story updates, call signals,
  `message_purged` (disappearing-message eviction), incoming-`location` pings.
- Fan-out is Redis-backed when `REDIS_URL` is set (multi-worker); otherwise in-memory
  (single instance).