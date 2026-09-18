# Nexara — Security Audit: Authentication & Authorization

Date: 2026-09-12. Audit findings + status after remediation: the items below marked
**FIXED** were implemented and verified (backend restarted, `alembic upgrade head`
applied, 205/205 tests pass, live flows re-checked). The RLS mechanism is shipped but
**activation is a deliberate two-step** — see Finding 3 for the switch-over step.

Legend — Status: PASS / WARNING / FAIL. Severity: Critical / High / Medium / Low / Info.

## 1. Executive Summary

| # | Audit point | Verdict | Top issue |
|---|---|---|---|
| 1 | Client secrets hardcoded / shipped | **PASS** | Dev credentials in gitignored `backend/.env` (hygiene) |
| 2 | AuthN/AuthZ enforced server-side | **PASS, 1 FAIL** | Attachment thumbnail endpoint is anonymous |
| 3 | DB isolation / RLS / cross-user | **WARNING** | No RLS; single superuser role; app-layer only |
| 4 | Real logout invalidation | **PASS + WARNING** | Stateless access JWT valid up to 15 min post-logout |
| 5 | Error messages leak internals | **PASS + WARNING** | `DEBUG=True` leaks `repr(exc)`; "User not found." discloses account state |

The auth design is solid: server-side refresh-token families with reuse detection,
per-user and per-IP throttles, Turnstile, constant-time OTP verify, scoped queries.
Findings are hardening items, not an exploitable backdoor.

## 2. Point 1 — Are secrets hardcoded / shipped in the client?

**Verdict: PASS.**

- `frontend/src` has no hardcoded API keys, tokens, or passwords. The only key-like
  code is Signal E2EE device-key generation (`frontend/src/crypto/`) — intentional
  client-side cryptography, not a leak.
- Access token lives in JS memory only (`AuthContext.jsx:52`, `authService.js:232`),
  never `localStorage`. Profile (no credentials) is stored and cleared on logout.
- `frontend/.env.example` has no real values; there is no `frontend/.env`.
- Root `.gitignore` covers `.env`, `.env.*`, keeps `!.env.example`; `git ls-files`
  shows only `backend/.env.example` tracked.

**Finding 1.1 — Dev .env credential hygiene — Low**
- Location: `backend/.env` (gitignored). Contains a real-looking Gmail SMTP app
  password (`cipherchat.dev@gmail.com`), `MASTER_KEY`, `TURN_PASSWORD`.
- Why: dev backups/forks leak it; every clone carries the same credentials.
  Not "hardcoded in client" — but rotate if any copy left this machine. Never
  paste real values in `backend/.env.example` or PRs.

## 3. Point 2 — Do the APIs enforce auth / authorization?

**Verdict: PASS for business routes, with 1 FAIL + gaps.**

Verified enforcement:
- `get_current_user` gates all CRUD routes; deactivated accounts get 403
  (`dependencies/auth.py:53-58`).
- Membership checked server-side on send/history/search/pin/read-all
  (`messages.py:160,857,904,934,959,996`), attachment download/sync-blob/delete
  (`attachments.py:375,475,552`), group admin ops
  (`conversation_service.py:434 _require_participant`), story media/feed/view vs
  friend-block-privacy (`story_service.py:469 ensure_visible`).
- Avatar honors block + profile-photo privacy (`users.py:242-293`).
- Group sends validate each wrapped key targets a current member
  (`message_service.py:84-143`).

**Finding 2.1 — FAIL / Medium: attachment thumbnail is unauthenticated — ✅ FIXED**
- `backend/app/api/v1/attachments.py:308-326+`. `GET /api/v1/attachments/{id}/thumbnail`
  takes only `db` — no `current_user`, no participant check. Download at line 337 does.
- Why: thumbnails of private-conversation media (incl. view-once previews) are
  downloadable by anyone with the UUID; UUIDs leak via logs/referrers/browser
  history. `Cache-Control: public, max-age=31536000, immutable` makes it sticky.
- Proof: anonymous `GET /api/v1/attachments/<id>/thumbnail` returns 200; the same
  UUID via `download_attachment` returns 401/403.
- **Fix applied**: endpoint now requires `get_current_user` and checks
  membership via `ConversationRepository.get_participants` (403 otherwise);
  `Cache-Control` changed to `private`. Verified live: anonymous request → 401.
  The applying code is the illustrative block below as implemented:

```python
@router.get("/{attachment_id}/thumbnail")
async def get_thumbnail(
    attachment_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    attachment = await AttachmentRepository(db).get_by_id(attachment_id)
    if attachment is None or not attachment.thumbnail_path:
        raise HTTPException(status_code=404, detail="Thumbnail not found.")

    message = await MessageRepository(db).get_by_id(attachment.message_id)
    if message is None:
        raise HTTPException(status_code=404, detail="Thumbnail not found.")

    participants = await ConversationRepository(db).get_participants(message.conversation_id)
    if current_user.id not in {p.user_id for p in participants}:
        raise HTTPException(status_code=403, detail="Access denied.")

    if not Path(attachment.thumbnail_path).exists():
        raise HTTPException(status_code=404, detail="Thumbnail file not found.")
    return FileResponse(path=Path(attachment.thumbnail_path), media_type="image/jpeg")
```

**Finding 2.2 — Low: `/api/v1/metrics` is public — ✅ FIXED**
- `metrics.py:10-12`, no dependency.
  Leaks login/OTP/error counters and WS counts → activity-pattern disclosure. The dev
  HUD polls it by design; in prod gate it (auth / IP allowlist) or scrub labels.
- **Fix applied**: `metrics.py` now requires `get_current_user` whenever
  `APP_ENV != "development"`; the dev HUD keeps open access locally.
  `--metrics` publicly stays available in dev only.

**Finding 2.3 — Low: WebSocket ignores `is_active` — ✅ FIXED**
- `websocket/ws.py:55-63`.
  Verifies token + user existence (close 1008) but not `user.is_active`; HTTP rejects
  deactivated users, WS still delivers events until token expiry.
- **Fix applied**: the connect handler now closes 1008 for deactivated accounts
  **and** for access tokens whose `ver` predates the user's `session_version`
  (stale sessions fail closed on the socket too).

**Finding 2.4 — Low/Medium: static shared TURN credential to every user — ✅ FIXED**
- `call.py:43-63`.
  Same `TURN_USERNAME`/`TURN_PASSWORD` returned to any authenticated user; cannot
  rotate without kicking active calls; any account can burn relay resources.
- **Fix applied**: optional `TURN_SECRET` set in config — when configured, `call.py`
  mints per-user HMAC credentials (`<expiry>:<user_id>`, coturn REST / `use-auth-secret`);
  when absent the static pair is returned (dev coturn keeps working). Pattern:

```python
import hmac, hashlib, base64, time
def turn_credentials(secret: str, username: str, ttl: int = 3600) -> dict:
    expiry = int(time.time()) + ttl
    uname = f"{expiry}:{username}"
    cred = base64.b64encode(hmac.new(secret.encode(), uname.encode(), hashlib.sha1).digest()).decode()
    return {"username": uname, "credential": cred}
```

**Finding 2.5 — Info: username enumeration** — `users.py:126-154`. `check-username`
is unauthenticated and returns exists/available. Optional hardening: rate limit it.

## 4. Point 3 — DB permissions / RLS / cross-user isolation

**Verdict: WARNING — no RLS; single-privilege role; isolation is app-layer only.
🛠 Shipped (opt-in): role + policies + hooks exist; activation is one env switch.**

Evidence:
- No `ROW LEVEL SECURITY` / `CREATE POLICY` / `FORCE ROW LEVEL SECURITY` in any of
  the 33 Alembic migrations or models (grep hits were false positives on "policy").
- `DATABASE_URL` is `postgresql://postgres:...@localhost/nexara` — the app runs as
  the Postgres superuser; no least-privilege app role, no read-only role.
- Isolation rests entirely on server-side query scoping. This audit found the scoping
  consistent, but there is no DB-level backstop if a future query drops a `WHERE`.

Why it matters:
- One SQL bug / injection reads every tenant's rows; RLS caps blast radius to one
  user even when app code fails.
- Superuser app access is a compliance issue on shared managed databases.

Remediation delivered (migration `a2b4c6d8e0f1_enable_rls_scripts`):
- Created least-privilege role `nexara_app` + schema/table/sequence grants
  (incl. `ALTER DEFAULT PRIVILEGES` for future tables).
- Enabled + FORCED RLS on `messages`, `conversation_participants`, `attachments`,
  with participant-scoped `FOR ALL` policies keyed on
  `current_setting('app.current_user_id')::uuid`.
- `get_current_user` and the `/ws/me` connect handler publish
  `app.current_user_id` transaction-locally after auth.

**Activation is deliberately two-step (remaining work, not automatic):**
1. Set a password and point the app at the role:
   `ALTER ROLE nexara_app LOGIN PASSWORD '<secret>';` then
   `DATABASE_URL=postgresql://nexara_app:<secret>@localhost:5432/nexara`.
2. Background worker sessions that read outside a request scope (message purge
   loop, presence/broadcast membership caches) must also set
   `app.current_user_id` or they will see an empty dataset under `nexara_app`.
Migrations apply cleanly under the superuser role; RLS is bypassed by superusers,
so the running dev app is unaffected until the switch is made. Design:

```postgresql
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages FORCE ROW LEVEL SECURITY;
CREATE POLICY messages_scope ON public.messages
  USING (conversation_id IN (
    SELECT conversation_id FROM public.conversation_participants
    WHERE user_id = current_setting('app.current_user_id', true)::uuid));
```

```python
# in get_current_user, after user loads:
await db.execute(sa.text("SELECT set_config('app.current_user_id', :uid, true)"),
                 {"uid": str(user.id)})
```

## 5. Point 4 — Is logout implemented correctly (real invalidation)?

**Verdict: PASS (server-side revocation real); WARNING on stateless access JWT.**

What is right:
- `POST /auth/logout` revokes the whole refresh-token family server-side and clears
  the HttpOnly cookie (`auth.py:595-631`; `refresh_token_service.py:165-178`).
  A stolen/rotated cookie dies on next use — reuse detection revokes the family
  (`refresh_token_service.py:94-96`).
- Refresh tokens are stored hashed server-side (jti-chain + family), never
  plaintext; a DB dump cannot be replayed. DNS-trust chain is fine.
- Frontend logout clears the memory token, stored profile, and the IndexedDB
  keypair: `AuthContext.jsx:329-343` → `authService.logout()` (`authService.js:212-238`).

**Finding 4.1 — Warning/Low: access JWT survives logout until expiry (15 min) — ✅ FIXED**
- Location: `jwt_service.py:52` (`ACCESS_TOKEN_EXPIRE_MINUTES`); stateless verify
  in `dependencies/auth.py:22-29`.
- What: after logout/deactivation/deletion the access JWT still passes
  `get_current_user` until `exp`. Refresh side is invalidated instantly.
- Why: shared-device scenario — prior token keeps reading messages for up to 15 min.
- **Fix applied**: a `users.session_version` column (default 0) was added via
  migration `u1v3w5x7y9z1`; `create_access_token` embeds `ver`;
  `get_current_user` rejects tokens whose `ver` ≠ current version
  (a token with no `ver` — issued before deploy — is rejected, forcing one
  re-login); `logout` bumps the version so the still-valid access JWT dies
  immediately. Applies to all token sites (email OTP, 2FA verify/reset,
  refresh, WebAuthn). Verified live: `200` → logout → same token `401`.
  Existing refresh revocation keeps working unchanged.

```python
# user model gets: session_version: Mapped[int] = mapped_column(default=0)

# jwt_service.create_access_token() adds: "ver": user.session_version

# dependencies/auth.py, after user loads:
if user.session_version != payload.get("ver"):
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired access token.")

# auth.py logout() / deactivate / delete_account: bump once
current_user.session_version += 1   # then commit
```

## 6. Point 5 — Do error messages leak internals?

**Verdict: PASS for stack traces; WARNING on two disclosure paths.**

- No stack traces reach clients: global handler returns JSON
  `{"detail": "Internal server error."}` (`main.py:309-349`); validation errors are
  shaped JSON with field lists, never raw exceptions (`main.py:278-306`).
- Rate-limit and OTP errors are generic ("Too many requests...", "Invalid or
  expired OTP.", "The PIN you entered is incorrect.").

**Finding 5.1 — Warning: `DEBUG=True` leaks exception text — ✅ FIXED**
- Location: `backend/.env` sets `DEBUG = True`; `main.py:336-348` then includes
  `"error": repr(exc)` in 500 responses; `main.py:205` wires `debug=`; config
  default `DEBUG: bool = True` (`config.py:32`).
- Why: `repr(exc)` can surface table/column names, file paths, and query fragments.
  Dev-only (config validation forbids it in prod). Still — set `DEBUG=False` in any
  shared dev/staging env.
- **Fix applied**: the `DEBUG` repr branch was removed — 500 responses always return
  the generic body with `request_id`; exception text is logged server-side only.

**Finding 5.2 — Warning/Low: "User not found." discloses account state — ✅ FIXED**
- Location: `dependencies/auth.py:46-51`.
- What: a deleted account returns 401 "User not found."; a bad/expired token returns
  401 "Invalid or expired access token.". The distinct message tells an attacker the
  account was deleted.
- **Fix applied**: the user-missing path now returns the same generic
  `"Invalid or expired access token."` (message difference kept in server logs only).

**Finding 5.3 — Low: PII in logs** — `auth.py:196-199` and `ws.py:127-130` log user
email at INFO. Acceptable in development; prefer ids, or lower to DEBUG in prod.

## 7. Additional findings beyond the five points

| Id | Finding | Location | Severity |
|---|---|---|---|
| F1 | Attachment thumbnail anonymous (no auth, no membership) | `attachments.py:308` | Medium | ✅ fixed |
| F2 | `/metrics` public | `metrics.py:10` | Low | ✅ fixed |
| F3 | Static TURN credential to every user | `call.py:43` | Low/Medium | ✅ fixed |
| F4 | OTP stored as unsalted SHA-256 (`sha256(otp)`) | `utils/security.py:33` | Low/Medium | open |
| F5 | WS skips `is_active` | `websocket/ws.py:55` | Low | ✅ fixed |
| F6 | Refresh token accepted in JSON body | `auth.py:97-104` | Warning | accepted (documented) |
| F7 | `COOKIE_SECURE` defaults False | `config.py:60` | Warning | open (validated in prod) |
| F8 | `check-username` public | `users.py:126` | Info | open (by design) |
| F9 | `_client_ip` trusts X-Forwarded-For first entry | `rate_limit.py:41-51` | Warning | ✅ fixed |
| F10 | Logout does not close the client WS socket | frontend `api/api.js` / WS svc | Info | open |
| F11 | Message search runs `ilike` on encrypted `ciphertext` | `messages.py:870-873` | Info (non-security) | open |

- F4 why/low: OTPs are 6 digits (~10^6 space), live ~5 min; if the DB leaks, offline
  crack takes seconds–minutes. Fix: HMAC with per-OTP salt or argon2; the existing
  rate-limits/turnstile/expiry already blunt online abuse.
- F6: body token is a documented mobile convenience; the web client never persists
  it (memory only). Ensure native apps rotate/never store it in plaintext.
- F7: validation already rejects `COOKIE_SECURE=False` in production
  (`config.py:175-177`) — just confirm env parity in prod.
- F9: **fixed** — a shared resolver (`app/core/ip_utils.py::resolve_client_ip`) honors
  `X-Forwarded-For` only when the direct peer is a private/loopback address (i.e. a
  trusted reverse proxy). Public peers cannot spoof the header; used by both the rate
  limiter and the auth routers' IP recording.
- F11: searching base64 ciphertext can never match plaintext; affects feature
  correctness, not security (still worth fixing search to filter client-side on
  decrypted text).
- OTP delivery: `send_otp` always mints + attempts delivery regardless of account
  existence (`auth_service.py:40-90`) — no account enumeration via timing/hits.
- JWT: `decode_token` pins `algorithms=[self.algorithm]` (HS256 by default), so
  algorithm-confusion ("alg none"/RS256-key-attack) is not reachable. HS256 default
  is fine for dev; prefer the ES256 option in prod.

## 8. Dev vs production configuration guardrails

| Setting | Dev (current) | Prod requirement | Enforced |
|---|---|---|---|
| `DEBUG` | True | False | `config.py:148-151` |
| `SECRET_KEY` | placeholder (42 chars, contains `change_me`) | random ≥32, ≠ CHANGE_ME | `config.py:159-165` |
| `ALLOWED_HOSTS` | `*` | pinned hostnames | `config.py:169-171` (rejects `*`) |
| `COOKIE_SECURE` | False | True | `config.py:175-177` |
| `TURNSTILE_SECRET_KEY` | empty (CAPTCHA skipped, `turnstile.py:24`) | set | graceful skip is dev-only |
| `REDIS_URL` | unset (in-process limits/bus, `rate_limit.py:162`) | set for multi-worker | n/a |
| CORS | explicit dev origins, `allow_credentials=True`, no wildcard | explicit prod origins | n/a |

## 9. Remediation priorities — status

Done this pass (verified by 205/205 tests + live checks):
1. ✅ F1 — thumbnail now requires auth + membership (`attachments.py`).
2. 🛠 Point 3 — role + RLS policies + `set_config` hooks shipped; **activation**
   switch documented above (still optional, superuser bypass until flipped).
3. ✅ Finding 4.1 — `session_version` + `ver` claim: logout/deactivate/delete kill
   access JWTs immediately (live-verified).
4. ✅ F3 — ephemeral per-user TURN via optional `TURN_SECRET` (`call.py`).
5. ✅ F2 — `/metrics` gated when `APP_ENV != development`.
6. ✅ F5 — WS rejects `is_active=false` and stale-session tokens (1008).
7. ✅ Finding 5.1 — `repr(exc)` removed from 500 responses.
8. ✅ Finding 5.2 — unified "Invalid or expired access token." 401.
9. ✅ F9 — `resolve_client_ip` trusts XFF only from private/loopback peers
   (`app/core/ip_utils.py`), used by limiter + auth routers.
10. ✅ Test-warning cleanup — full suite **205 passed, 0 warnings**.

Still open (deliberate / out of scope):
- F4 — OTP hashing (unsalted SHA-256 → per-OTP salt / HMAC).
- F7 — flip `COOKIE_SECURE=True` via env in prod (validation already enforces).
- F8 — rate-limit `check-username`; F10 — frontend closes WS socket on logout.
- F11 — client-side decrypted search.
- Point 3 activation — switch `DATABASE_URL` to `nexara_app` (two-step documented).