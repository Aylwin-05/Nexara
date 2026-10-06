# Nexara — Production, Security & Launch Audit

**Date:** 2026-10-04
**Status:** findings only — **no fixes applied**. This document is the execution spec.
**Scope:** full source tree (backend FastAPI + PostgreSQL, React/Vite frontend, Docker/compose, CI, dependencies).
**Method:** static review, dependency audits, test/build runs, config reasoning.
**Not covered:** live production runtime, real TLS/DNS, external services (SMTP, Turnstile, Web Push, Sentry), real DB grants.

Severity: `CRITICAL` blocks launch · `HIGH` data/auth risk · `MEDIUM` hardening/abuse · `LOW` polish · `INFO`.

Related: `docs/security-audit.md` (2026-09-12 auth/authz audit), `docs/SECURITY.md`, `docs/DEPLOYMENT.md`.

---

## Verdict

### ❌ NOT DEPLOYABLE AS-IS

Three CRITICAL wiring/config blockers make the documented production deployment path non-functional, and four HIGH authorization/validation gaps must be closed before real user data.

The application code itself is in good shape: E2EE crypto, JWT + session-version auth, scrypt OTP with rotation and reuse detection, async SQLAlchemy (no SQL injection), rate limits on critical paths, **258 passing tests**, clean typecheck and production build, code-split bundles, correctly designed RLS, `.env` never committed, non-root container.

**What blocks launch is configuration, not architecture.** Phase 0 below is three small changes that unblock the entire deployment.

---

## Scores

| Area | Score |
|---|---|
| Security | **4.5 / 10** |
| Launch-readiness | **8.5 / 20** |
| Code quality & tests | **7.5 / 10** |
| Performance | **7 / 10** |
| Accessibility | **6 / 10** |
| SEO | **4 / 10** |
| Legal / Privacy | **3 / 10** |
| **Overall** | **~5.5 / 10** |

---

## Architecture

| Layer | Stack |
|---|---|
| Frontend | React 19 + Vite, React Router, Axios, `@noble/*` crypto, Capacitor (iOS/Android), vite-pwa service worker |
| Backend | Python 3.12 FastAPI (async), SQLAlchemy 2.x async (asyncpg), Alembic |
| Data | PostgreSQL 16 (RLS on conversation tables), Redis (rate limits / presence) |
| Realtime | WebSockets (messaging), WebRTC + Coturn (calls) |
| Crypto | Client-side E2EE; JWT access (in-memory) + rotating HttpOnly refresh cookie; scrypt OTP; optional WebAuthn/2FA |
| Push | Web Push via VAPID, metadata-only payloads |
| Third-party | SMTP (OTP), Cloudflare Turnstile (optional), Sentry (optional) |
| Infra | Docker Compose (dev + prod), nginx TLS terminator, GitHub Actions CI |

**AI/LLM:** none present. Prompt-injection and AI-security checks are **NOT APPLICABLE**.

---

## Phase 0 — Unblock deploy (CRITICAL, do first)

These three are small config changes. Nothing else can be validated until they land.

### F-01 · Run the app as non-superuser `nexara_app` — CRITICAL

**Problem.** `docker-compose.yml:5` sets `POSTGRES_USER: nexara`, and the official Postgres image creates that role as a **superuser**. `docker-compose.yml:56` hardcodes the app's `DATABASE_URL` to that role. `docker-compose.prod.yml` never overrides `DATABASE_URL`.

PostgreSQL superusers **always bypass RLS**, even with `FORCE ROW LEVEL SECURITY`. So `np_messages_scope`, `np_conversation_participants_scope`, and `np_attachments_scope` (`backend/alembic/versions/a2b4c6d8e0f1_enable_rls_scripts.py:125-135`) are **no-ops in every shipped compose path**. `backend/app/dependencies/auth.py:73` even comments: *"Harmless under the superuser role (RLS bypassed)."*

Consequences:
- The app-layer participant checks in each route are the **sole** access control. Where one is missing (F-04, F-08) there is no second layer.
- Superuser also implies `CREATEDB`/`CREATEROLE` → any future SQL injection becomes full database + role compromise.

The correct role already exists by design but is unusable: `a2b4c6d8e0f1_enable_rls_scripts.py:101-109` creates `nexara_app` **without a password**, and its docstring (lines 9-13) states activation is *"STEP 2 (operational, NOT automatic)"*. That step was never done.

**Fix.**
1. Set a password: `ALTER ROLE nexara_app LOGIN PASSWORD '<from secret store>';`
2. Point the app at it in `docker-compose.prod.yml` backend env:
   `DATABASE_URL: "postgresql+asyncpg://nexara_app:${POSTGRES_APP_PASSWORD:?set in production}@postgres:5432/nexara"`
3. Keep migrations working — they need DDL rights. Either run `alembic upgrade head` against the privileged role in a one-shot init step, or grant `nexara_app` only what it needs. **Do not** run the app as the migration role.
4. Reduce the blanket grant at `a2b4c6d8e0f1_enable_rls_scripts.py:113` — `nexara_app` currently has `SELECT/INSERT/UPDATE/DELETE` on **all** tables including `users` and `refresh_tokens`. Grant per-table instead.
5. Remove the now-stale comment at `dependencies/auth.py:73`.

**Verify.** Connect as `nexara_app`, set `app.current_user_id` to user A, and confirm user B's conversation rows are invisible. Fold this into CI (see F-16).

---

### F-02 · Add `gunicorn` to `backend/requirements.txt` — CRITICAL

**Problem.** `backend/entrypoint.sh` execs `gunicorn app.main:app` whenever `WEB_CONCURRENCY > 1`. `docker-compose.prod.yml:38` sets `WEB_CONCURRENCY: "${WEB_CONCURRENCY:-4}"`. But **`gunicorn` is not in `requirements.txt`** and is not installed — confirmed: `backend/.venv/Scripts/gunicorn.exe` does not exist. `import uvicorn.workers` also fails, because it imports `gunicorn.arbiter`.

Result: the documented production profile fails immediately with `gunicorn: not found`.

**Fix.** Add the dependency pinned alongside the others in `backend/requirements.txt`:
```
gunicorn==23.0.0
```

**Verify.** `docker compose -f docker-compose.yml -f docker-compose.prod.yml up backend` with `WEB_CONCURRENCY=4`, then confirm 4 worker processes and `/healthz` returns 200.

---

### F-03 · Resolve nginx `${DOMAIN}` — CRITICAL

**Problem.** `frontend/nginx.prod.conf` references `${DOMAIN}` for the TLS certificate path. There is no `DOMAIN` environment value in `docker-compose.prod.yml` and no `envsubst` template step in `frontend/Dockerfile`. Nginx fails its config test on the unknown variable, so the frontend container does not start.

**Fix.** Pick one:
- **Preferred:** change `frontend/nginx.prod.conf` to use a literal path (e.g. `/etc/nginx/certs/fullchain.pem`) and mount certificates there from a host path configured in `docker-compose.prod.yml`. No templating, no extra tooling.
- **Alternative:** pass `DOMAIN` as a container env var and add an `envsubst` step in the frontend Dockerfile.

**Verify.** `docker compose ... up frontend` then `curl -I https://localhost/` — expect 200 and the HSTS + CSP headers present (see F-12).

---

## Phase 1 — Close HIGH security gaps

### F-04 · Attachment upload must verify message ownership — HIGH

**File:** `backend/app/api/v1/attachments.py` (`POST /api/v1/attachments/upload/{message_id}`)
**Problem.** The handler checks that the caller is a member of the conversation, but not that the caller **sent** the target message. Any participant can attach a file to anyone else's message.
**Fix.** Before storing, load the message and assert `message.sender_id == current_user.id` in addition to the existing membership check.
**Verify.** Add a test: user B attaches to user A's message → expect 403.

---

### F-05 · Validate thumbnail uploads — HIGH

**File:** `backend/app/api/v1/attachments.py` (`POST /api/v1/attachments/{attachment_id}/thumbnail`)
**Problem.** No size limit, no extension allowlist, no magic-byte check.
**Fix.** Enforce a small max size, an image extension allowlist, and verify magic bytes before writing. Reuse whatever the service layer already does for the main upload path — do not build a second validator.
**Verify.** Test oversized file → 413; renamed `.exe` → 415.

---

### F-06 · Clamp `limit` and rate-limit message search — HIGH

**Files:** `backend/app/api/v1/messages.py`, `backend/app/repositories/message_repository.py`

Two related issues:
1. `GET /api/v1/messages/{conversation_id}?limit=0` (or a negative value) **disables pagination** and returns the entire conversation. A large conversation becomes a memory and bandwidth problem.
2. `GET /api/v1/messages/search/{conversation_id}` has **no rate limit** and passes the query straight into `ILIKE`, so `%` wildcards force a full table scan per keystroke.

**Fix.**
- Clamp `limit` to `1..MAX_PAGE_SIZE` at the schema level; reject or coerce out-of-range values.
- Apply the existing rate-limit dependency to the search route.
- Escape `%` and `_` in the user-supplied term, or use PostgreSQL `pg_trgm` with a bounded scan.

**Verify.** `?limit=0` → 400 or clamped; `?limit=999999` → capped; repeated searches → 429.

---

### F-07 · Make message pin per-participant — HIGH

**Problem.** Pin state is stored globally on the `Message` row, so when one participant pins a message the pin appears for **everyone** in the conversation.
**Fix.** Move pin state to a join table keyed by `(message_id, user_id)`, or add a per-user pin on the participant row. Requires a migration.

---

### F-08 · Scope device bundle access to the caller — HIGH

**File:** `backend/app/api/v1/devices.py` (`GET /api/v1/devices/{user_id}/bundle`)
**Problem.** Any authenticated user can request **another user's** push/keys bundle by changing the path parameter. Even if the private material is not directly usable, this is cross-user data disclosure and may allow prekey exhaustion.
**Fix.** Return the bundle only when `user_id == current_user.id`, otherwise 403.
**Verify.** Test user B requesting user A's bundle → 403.

Related, same file: the trust endpoints can reference another user's device ID, leaking its metadata (name, platform, last-seen). Validate that the target device belongs to the caller.

---

## Phase 2 — Harden

### F-09 · Rate-limit remaining authenticated endpoints — MEDIUM

Unlimited today: `GET /users/search`, avatar operations, message search. Apply the existing rate-limit dependency (already used on OTP and upload routes).

### F-10 · Fix account enumeration — MEDIUM

Two leaks: `POST /auth/send-otp` returns `is_new`, and `GET /users/search?email=` resolves accounts by email.
**Fix.** Return a generic response from `send-otp` regardless of whether the account exists; restrict user search to the minimum fields needed and rate-limit it (see F-09).

### F-11 · Close CSRF on cookie-authenticated endpoints — MEDIUM

`docker-compose.prod.yml` sets `COOKIE_SAMESITE: "None"` (needed for the Capacitor WebView). With `SameSite=None`, `POST /auth/refresh` and `POST /auth/logout` become simple cross-site requests that send **no preflight**, so any page can trigger them:
- forced refresh-token rotation, which combined with reuse detection can revoke the victim's whole token family → forced logout;
- forced logout nuisance.

`DELETE /auth/account` is **already safe** — it requires an `Authorization: Bearer` header, so a cross-origin attempt triggers a CORS preflight that the explicit `allow_origins` list rejects.

**Fix.** Keep the web deployment on `SameSite=Lax`/`Strict` and scope `None` to the native build, **or** add an `Origin`/`Referer` check to the cookie-reading routes.

### F-12 · Fix nginx `add_header` inheritance — MEDIUM

**File:** `frontend/nginx.prod.conf`
Nginx's `add_header` does not inherit into a block that defines its own. Locations with `add_header Cache-Control ...` therefore drop the server-level CSP, HSTS, and `X-Content-Type-Options`.
**Fix.** Repeat the full header set in every location, or move caching into a `map`/include snippet that is pasted at each level.

### F-13 · Reconcile CSP with Google Fonts — MEDIUM

The app loads Google Fonts externally, but the production CSP `style-src` does not allow it — fonts are blocked, and loading them would also leak visitor IPs to Google, which conflicts with the product's privacy positioning.
**Fix.** Self-host the fonts (preferred — removes the third-party request entirely) or add the origins to CSP. Do not simply widen the policy.

### F-14 · Check `session_version` on WebSocket connect — MEDIUM

**File:** `backend/app/dependencies/websocket_auth.py`
A valid access token is accepted at connect time without verifying `session_version` or `is_active`, so a token from a logged-out or deactivated account can still open a socket. Per-event membership checks limit the damage, but revocation is not enforced for the connection lifetime.
**Fix.** Verify `session_version` and `is_active` on connect, same as `dependencies/auth.py` does for HTTP.

### F-15 · Fail closed on missing Turnstile secret — MEDIUM

`backend/app/dependencies/turnstile.py` silently disables the check when `TURNSTILE_SECRET_KEY` is empty, including in production if the variable is unset.
**Fix.** Require the secret when `ENVIRONMENT=production`; only allow the skip in dev.

### F-16 · Move migration execution off every boot — MEDIUM

`backend/entrypoint.sh` runs `alembic upgrade head` on container start. `docker-compose.prod.yml` sets `deploy.replicas: 2`, so two backends race to migrate.
**Fix.** Run migrations as a separate one-shot service or CI/CD step that must complete before the backends start.

### F-17 · Add automated RLS verification — MEDIUM

`backend/smoke_rls.py` proves RLS works by registering two users and asserting cross-user reads fail — but it is manual, has a hardcoded Windows log path (`LOG = r"C:\Users\dell\AppData\Local\Temp\..."`), and is not in CI. RLS is currently asserted by design and never automatically proven.
**Fix.** Port it to the CI environment (path via env var, run against the `nexara_app` role) once F-01 is done. This is the regression test for the most important fix in this document.

---

## Phase 3 — Dependencies, CI, quality

### F-18 · Pin the Trivy action and set CI permissions — MEDIUM

**File:** `.github/workflows/ci.yml`
Uses the mutable ref `aquasecurity/trivy-action@master`. Pin to a released tag or commit SHA, and add an explicit least-privilege `permissions:` block.

### F-19 · Run Playwright E2E in CI — MEDIUM

E2E specs exist but are not invoked in CI, so only unit/integration coverage gates merges. Wire the suite in.

### F-20 · Accepted dependency risk: `ecdsa` — MEDIUM (accepted)

`pip-audit` reports `ecdsa==0.19.2`, `CVE-2024-23342` / `PYSEC-2026-1325`, with **no fixed version available**. It is reachable only on the optional ES256 WebAuthn path. Already documented in `.trivyignore`. Keep the ignore, but re-check when a fix ships, and confirm the ES256 path is off unless WebAuthn is actually enabled.

For reference, `npm audit --production` reports **0 vulnerabilities**.

### F-21 · Keyboard accessibility — LOW

`frontend/src/components/chat/MessageInfoPanel.jsx:83` uses `<div className="msg-info-overlay" onClick={onClose}>` — not focusable, no keyboard handler, no `role`. Make it a `<button>`.
Several stylesheets set `outline: none` on controls; these rely entirely on the global `:focus-visible` rule in `frontend/src/index.css`. That mitigation works for keyboard focus but leaves no visible ring for other focus paths — worth a manual screen-reader and keyboard pass.

### F-22 · Add social metadata — LOW

`frontend/index.html` has no `canonical`, Open Graph, or Twitter tags. `robots.txt` disallows all crawling, which is correct for a private messenger.

### F-23 · Finalize legal documents — MEDIUM

`frontend/src/pages/Legal/legalContent.js` still contains operator/legal placeholders in the Privacy Policy and Terms. **These must be completed before launch.**
Also document the push-notification behavior: Web Push payloads carry the **sender's display name** (`payload.sender_name`) to the lock screen. Message *content* is never in the notification, but for an E2EE product the sender-name disclosure should be stated explicitly in the privacy policy.

---

## Verification Test Plan

Run in order after each phase.

1. **Prod profile boots** — `docker compose -f docker-compose.yml -f docker-compose.prod.yml up`; backend has 4 workers, `/healthz` 200, nginx serves 200. *(validates F-01, F-02, F-03)*
2. **RLS enforced** — run the ported `smoke_rls.py` in CI as `nexara_app`; cross-user reads must fail. *(F-01, F-17)*
3. **Ownership** — user B attaches to user A's message → 403; user B requests user A's device bundle → 403. *(F-04, F-08)*
4. **Pagination abuse** — `?limit=0` and `?limit=999999` are rejected or clamped; wildcard search is rate-limited. *(F-06)*
5. **Upload validation** — oversized and wrong-magic-byte thumbnails are rejected. *(F-05)*
6. **CSRF** — cross-site `POST /auth/refresh` and `/auth/logout` return 403 under `SameSite=None`. *(F-11)*
7. **Enumeration** — `send-otp` and user search give identical responses for existing and non-existing accounts. *(F-10)*
8. **Headers** — `curl -I` every nginx location; CSP, HSTS, and `X-Content-Type-Options` present everywhere. *(F-12)*
9. **Regression** — `pytest test_all.py` (baseline 212 passed), `npx vitest run` (baseline 46 passed), `npx tsc --noEmit`, `npm run build`.

---

## Baseline Test Results (2026-10-04)

| Suite | Command | Result |
|---|---|---|
| Backend | `pytest test_all.py` | **212 passed** (290s) |
| Frontend unit | `npx vitest run` | **46 passed** / 8 files |
| Typecheck | `npx tsc --noEmit` | clean |
| Build | `npm run build` | success, ~912 KB dist |
| npm audit | `npm audit --production` | **0 vulnerabilities** |
| pip-audit | `pip-audit -r backend/requirements.txt` | **1** — `ecdsa`, no fix (see F-20) |

Largest bundles: `react-vendor` 214 KB, `Dashboard` 190 KB, `Dashboard.css` 74 KB — all code-split and gzipped by nginx.

---

## Findings Not Verified

Requires a live environment; do not record these as passing without checking.

- Actual TLS certificate validity, HSTS preload, and HTTPS redirect in production.
- Real PostgreSQL role grants and whether RLS fires under the live connection.
- SMTP delivery, Turnstile enforcement, Web Push delivery, Sentry emission.
- Coturn TURN server configuration (`docs/TURN_SERVER_SETUP.md`).
- Orphaned upload cleanup after message deletion.
- Sync envelope/blob behavior — whether it preserves conversation-scoped E2EE history access on multi-device sync. **Worth verifying manually**: if sync blobs are readable outside their conversation context, that would undermine the E2EE guarantee.
- Rate-limit behavior across multiple backend workers (Redis-backed, but untested under load).

---

## Definition of Done

Launch is unblocked when:

- [ ] F-01, F-02, F-03 complete and the prod profile boots end to end
- [ ] RLS enforcement proven automatically in CI (F-17)
- [ ] F-04 through F-08 closed with regression tests
- [ ] No CRITICAL or HIGH open in §Security Review
- [ ] Privacy Policy and Terms finalized (F-23)
- [ ] Verification test plan above passes on the production configuration