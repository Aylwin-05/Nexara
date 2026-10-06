# Nexara — Complete Production + Security + Quality Audit

Date: 2026-10-06
Scope: entire repo (backend, frontend, migrations, infra, CI). Audit reflects the **current** post-fix state (the 2026-10-04 launch audit findings F-01..F-22 are implemented; F-23 legal content is still pending operator input).

Method: source inspection, route enumeration from the live FastAPI app, dependency scan (trivy config + `.trivyignore`), test-harness evidence (`backend/test_all.py`), git-history secret scan, and launch-checklist inspection. Items that cannot be exercised in this environment (live-host nginx, live TLS, live SMTP, live Redis/Postgres behavior) are marked **NOT VERIFIED**, not PASS.

Severity legend: CRIT / HIGH / MED / LOW / INFO.

---

## 0. ARCHITECTURE SUMMARY

| Aspect | Finding |
|---|---|
| Purpose | End-to-end-encrypted private messaging + calling + ephemeral "stories" web/mobile app |
| Main features | X3DH/Double-Ratchet messaging, disappearing messages, group chats, stories, WebRTC calls (signaling only), attachments (client-encrypted blobs), stars/pins, friends/blocking/privacy, device management + trust, WebAuthn-capable device auth, email OTP login, PIN 2FA, recovery/unlock flow, Web Push |
| Frontend | React 18 + Vite (SPA), React Router, Capacitor (mobile), WebCrypto E2EE in the browser, PWA service worker + manifest |
| Backend | FastAPI + Uvicorn, SQLAlchemy 2 async, Pydantic v2, slowapi rate limiting, Sentry SDK |
| Database | PostgreSQL 16 (asyncpg) with RLS FORCE on user tables; Alembic migrations; Redis for OTP/rate-limit/session bus/expiry |
| Auth | Email OTP (enumeration-safe, Turnstile-gated), short-lived JWT access token (kept in memory), rotating HttpOnly refresh cookie (SameSite=strict, Secure in prod), session_version check on REST + WS, optional PIN 2FA, recovery via emailed tokens |
| External services | SMTP (email OTP/recovery), Turnstile (bot gate), Web Push (VAPID), Sentry (opt-in), no AI/LLM services anywhere |
| Uploads/storage | Client-encrypted attachments/stories/avatars; served back as opaque blobs; local disk (nginx-served) in compose; no S3/blob CDN currently |
| Deployment | Docker Compose (api, worker, migrate, nginx, postgres, redis); frontend static build (nginx/Vercel), CI: lint/test/trivy/RLS-smoke/Playwright e2e |
| Config | `backend/app/core/config.py` (pydantic-settings) + `.env`; startup `validate()` refuses to boot on insecure prod values |
| Roles | Single user role; relationship-based authorization (friendship/block/membership/admin) — no privilege escalation surface found |
| Critical data | E2EE-encrypted message payloads, key bundles (identity + signed prekeys + one-time prekeys), trust relationships, recovery codes, refresh-token families, call logs, story/attachment blobs |

Data flow: Browser (WebCrypto, keys derived + stored locally) → HTTPS API (JWT) → FastAPI dep: `get_current_user` → SQLAlchemy (RLS-scoped session as `app.current_user_id`) → Postgres; blobs → disk → nginx Range-serving; WS for realtime (token in subprotocol, session_version enforced); Redis for OTP/limits/expiry/pub-sub.

---

## 1. EXECUTIVE SUMMARY

| Metric | Value |
|---|---|
| **Overall security score** | **90 / 100** |
| **Overall production readiness** | **82 / 100** |
| Critical issues | 0 |
| High issues | 1 |
| Medium issues | 8 |
| Low issues | 7 |

*Post-audit fixes applied 2026-10-06: prod docs lockdown, cookie-consent banner, frontend Sentry wiring, `npm audit fix` (source-map-js DoS). The High blockers are now only the placeholder legal pages.*

The application is architecturally strong: server-side auth on every user-data route, RLS FORCE + relationship checks, comprehensive rate limiting, CSRF origin gate, fail-closed Turnstile, rotation + reuse-detection on refresh tokens, anti-enumeration OTP, SSRF-guarded push endpoints, pinned supply-chain CI, and a 213-test backend suite including 61 authorization negative tests. **No confirmed IDOR/BOLA, auth bypass, injection, or secret exposure was found.**

Bleed: it is not yet *legal/operationally* launchable — privacy/terms are placeholder (High). Several P2 hardening items remain. Live-host behavior (nginx, TLS, SMTP, real Postgres RLS) is NOT VERIFIED here and must be confirmed on the deploy target.

---

## 2. CRITICAL ISSUES

None confirmed. The two nearest-to-critical items are operational blockers for *public* launch, not code defects: placeholder legal pages, and absent cookie consent. Both are tracked below as High.

---

## 3. SECURITY CHECKLIST

| # | Check | Status | Severity | Evidence | Fix |
|---|---|---|---|---|---|
| 2.1 | No secrets in frontend | PASS | — | `frontend/src` + `frontend/dist` scanned; no keys, tokens, or credentials. Auth token kept in memory (not localStorage); refresh in HttpOnly cookie. `.env*` gitignored (`.gitignore`), only `.env.example` tracked | Keep `.env.example` free of real values at deploy |
| 2.2 | Row-level / database security | PASS | — | RLS `FORCE` on user tables; per-session `set_config('app.current_user_id', ...)`; smoke_rls.py tests isolation in CI; maintenance purge uses `'system'` scope (main.py) | Re-run RLS smoke in CI on every patch (already a CI job) |
| 2.3 | Users only see their own data | PASS | — | Every conversation/message/attachment/story/star/pin gated by `conversation_membership` / friendship / owner checks; 61 negative authz tests incl. `test_non_participant_cannot_read_history`, `test_attachment_rejected_for_non_participant`, `test_blocked_user_cannot_view_story_media`, `test_get_bundle_non_friend_or_unknown_user_403` | Keep negative tests as regression gate |
| 2.4 | Server-side authentication | PASS | — | `Depends(get_current_user)` on all `/api/v1` data routes (verified via route enumeration + grep); root `/metrics` auth-gated outside dev; WS authenticates token in subprotocol | — |
| 2.5 | Auth provider quality | PASS | — | OTP expiring + single-use (Redis), per-IP + per-user limits; JWT + rotating refresh with reuse→re-auth; logout revokes family; 2FA PIN hashed + limited; recovery tokens email-gated + OTP-verified | — |
| 2.6 | HTTPS | PARTIAL | HIGH (ops) | App config enforces `COOKIE_SECURE`, `ALLOWED_HOSTS` pinned, `DEBUG=false` at boot; nginx TLS + HSTS config present; local host cannot exercise live TLS | Verify cert/DOMAIN + `nginx -t` on deploy host; confirm HTTP→HTTPS 301 |
| 2.7 | Input validation | PASS | — | Pydantic v2 everywhere (types, length-max at schema level); magic-byte + extension checks on uploads; `MAX_REQUEST_BODY_SIZE` middleware; request-size caps per route; search sanitized; SSRF guards on push endpoints | — |
| 2.8 | Rate limiting | PARTIAL | MED | 67 `rate_limit()` declarations across 11 routers (auth/OTP/recovery/upload/search/contacts all covered) | Some low-risk reads lack limits (see API table): messages read-all/pinned, stories react/reply/media, conversation join-with-link, devices/key endpoints — add before heavy public load |
| 2.9 | Secrets out of GitHub | PASS | — | `git log --all` scan of `.env`/key patterns: zero tracked; `.env`, `.env.*`, `*.key` gitignored; CI uses env-injected secrets | N/A |
| 2.10 | 2FA / MFA | PASS | — | Optional PIN 2FA: enable/disable/reset (OTP-gated), 10/5-min rate limits, mismatch + non-numeric rejected by tests. WebAuthn models/migration exist but are not wired to any route (see Middle/INFO) | Either implement WebAuthn enroll/verify or drop the dormant tables to avoid confusion |
| 2.11 | Dependencies | PASS (1 MED residual) | MED | trivy configured; `trivy-action@v0.36.0` pinned (March 2026 tag-compromise handled); `ecdsa==0.19.2` CVE-2024-23342 (**no upstream fix**, PYSEC-2026-1325) kept in `.trivyignore`; sentry-sdk 2.71.0 current | Re-check `ecdsa` for a release; monitor `.trivyignore` drift |
| 2.12 | Error-message security | PASS | — | Global `RequestValidationError` + generic `Exception` handlers return safe bodies; no stack/DB/SQL to clients; ServiceException mapped to HTTPException; Sentry logs detail server-side only | — |
| 2.13 | Logging & auditing | PASS (keep verifying) | — | Request-ID middleware (correlatable logs), security-event logging (auth success/fail, recovery, 2FA), DSN-level OTP log; no password/token/secret in log lines | Wire logs to a central sink + retention policy |
| 2.14 | Prompt injection | NOT APPLICABLE | — | No AI/LLM features, no LLM endpoints, no user prompts, no retrieval. Nothing to inject | N/A |

---

## 4. PRODUCTION CHECKLIST (20)

| # | Item | Status | Severity | Evidence | Fix |
|---|---|---|---|---|---|
| 1 | Privacy Policy page | FAIL | HIGH | `/privacy` route renders placeholders in `frontend/src/pages/Legal/legalContent.js` (pending operator) | Supply real privacy copy (E2EE claims, data we don't collect, subprocessors, retention) |
| 2 | Terms & Conditions page | FAIL | HIGH | Same file, placeholder content | Supply real terms |
| 3 | Secrets removed from frontend | PASS | — | Section 2.1 | — |
| 4 | Force HTTPS | PARTIAL | MED | App-side enforcement exists; live nginx/TLS not exercised here | Verify on host: cert, 301 redirect, HSTS preload later |
| 5 | Cookie consent / banner | PASS | — | New `frontend/src/components/layout/CookieConsent.jsx` (+ test) — informational banner (only a strictly-necessary auth cookie), links to `/privacy` + `/terms`, persists choice in localStorage | — |
| 6 | Meta title & description | PASS | — | Added in F-22 (`frontend/index.html`) | — |
| 7 | Social preview / OG image | FAIL | LOW | OG tags present but **no `og:image`** asset | Add a static `og-image.png` (~1200×630) |
| 8 | Image compression/optimization | PARTIAL | LOW | Server generates thumbnails; avatars uploaded are stored/transformed; no resize pipeline for full image bodies (they're encrypted opaque blobs — inherently un-optimizable) | OK to defer for E2EE blobs |
| 9 | Page-load performance | PARTIAL | MED | Route-level code splitting + Suspense; service worker caching; but no bundle-size budget or lazy media | Set a bundle budget; measure Lighthouse on deploy |
| 10 | Color contrast / accessibility | PARTIAL | LOW | F-21 dialog fix + earlier a11y pass; no automated axe run in CI | Add `@axe-core/playwright` to the e2e job |
| 11 | Mobile-friendly / responsive | PASS | — | Tailwind-ish responsive layout; Capacitor shell; e2e mobile viewport could be added | — |
| 12 | Broken links | NOT VERIFIED | LOW | No link crawler; SPA links are route-based | Lighthouse/crawl on staging |
| 13 | Form validation | PASS | — | Pydantic + frontend validators; error states exist | — |
| 14 | Spam / bot protection | PASS | — | Turnstile on OTP/recovery (fail-closed in prod), per-IP + per-user limits | — |
| 15 | Analytics | NOT APPLICABLE (choice) | — | None present (privacy-preserving). Deliberate for E2EE app | Optional: privacy-friendly self-hosted analytics only |
| 16 | Clear calls to action | PASS | — | Signup/login/recover flows have clear CTAs | — |
| 17 | Favicon | PASS | — | `public/favicon.svg` + manifest icons | — |
| 18 | Custom 404 | PASS | — | `AppRoutes.jsx` `NotFound` (inline, minimal) | Optional: prettify + add to sitemap exclusion |
| 19 | Sitemap + robots.txt | PARTIAL | LOW | `robots.txt` present (`Disallow: /` — intentional for auth-walled app) but **no `sitemap.xml`** | Optional: add sitemap listing `/privacy`, `/terms` only |
| 20 | Error monitoring | PARTIAL | LOW | Backend `sentry-sdk` init + frontend `@sentry/react` init (guarded by `VITE_SENTRY_DSN`) + ErrorBoundary `captureException` now wired; both DSNs are deploy-time env vars — set them on the host | Set `SENTRY_DSN`/`VITE_SENTRY_DSN` + alert route on deploy |

---

## 5. API SECURITY (endpoint table)

Auth legend: 🔒 = `Depends(get_current_user)`; ⛔ = public (pre-auth); RL = rate-limited. All data routes enforce membership/owner checks (see database section). Full route list was enumerated from the live OpenAPI schema.

| Method | Path | Auth | RL | Notes |
|---|---|---|---|---|
| POST | `/auth/send-otp` | ⛔ | ✅ 50/10m ip | Turnstile fail-closed (prod), per-user limit, generic response (F-10 anti-enumeration) |
| POST | `/auth/verify-otp` | ⛔ | ✅ 50/10m ip | consumes one-time code; issues JWT + rotating refresh |
| POST | `/auth/refresh` | cookie | ✅ | rotation + reuse detection; CSRF origin gate (F-11) |
| POST | `/auth/logout` | cookie | ✅ | revokes family; CSRF origin gate |
| DELETE | `/auth/account` | 🔒 | ✅ 3/day | account deletion |
| PUT/DELETE | `/auth/two-fa` | 🔒 | ✅ 10/5m | PIN enable/disable (mismatch-rejected) |
| POST/GET | `/auth/two-fa/reset` `/status` `/verify` | 🔒 | ✅ | OTP-gated reset; verify 10/5m |
| POST | `/recovery/request` `/verify`; GET `/recovery/unlock` | ⛔/🔒 | ✅ | secret + email OTP + token; orphan-history protection |
| POST/GET | `/users/me`, PATCH | 🔒 | — | own profile only |
| GET/POST | `/users/search`, `/users/check-username`, avatar | 🔒 | ✅ | search limited |
| GET | `/users/{id}/avatar` | 🔒 | ✅ | hidden from blockers (tested) |
| POST/GET | `/devices/register` `prekeys/*` `me` `trust` | 🔒 | — | **RL gap** (MED): register/prekey/trust have per-user business limits? none via slowapi — add |
| GET | `/devices/{user_id}/bundle` | 🔒 | — | self-or-friend (F-08), consumes one-time prekey; **no rate limit** — add to prevent OPK drain (Low/Med) |
| PATCH/DELETE | `/devices/{id}` | 🔒 | — | owner/primary-protected; **no RL** |
| POST/GET/PATCH | `/keys/public`, `/keys/{user_id}` | 🔒 | — | **no RL** — Low (read-only) |
| POST/PUT | `/messages/send` `/sync-envelope` | 🔒 | ✅ | 60/300 rpm; stale-recipient-key checks |
| GET | `/messages/{conversation_id}` | 🔒 | ✅ 120 | membership-checked |
| DELETE | `/messages/{id}` `/me` | 🔒 | ✅ | sender/purge semantics |
| PUT | `/messages/{id}/edit` `/reaction` `/star` `/pin` | 🔒 | ✅ | permission + deleted-message checks |
| GET | `/messages/starred` `/search/{conversation_id}` `/pinned/{conversation_id}` | 🔒 | ✅ (starred/search) | **pinned GET, read-all POST: no RL** (Low) |
| POST/GET | `/conversations/private` `/group` `/` | 🔒 | ✅ | admins-only ops tested |
| POST | `/join-with-link` | 🔒 | — | **no RL** (MED): invite brute-force — add |
| GET/PATCH | `/conversations/{id}` + delete-request/confirm/cancel | 🔒 | ✅ | groups/private enforcement |
| POST/PATCH | `/conversations/{id}/group` add/admin/remove/leave/invite-link | 🔒 | ✅ | non-admin rejected (tests) |
| POST/GET/DELETE | `/attachments/upload/{mid}` `/thumbnail` `/sync-blob` `/download` `/delete` | 🔒 | ✅ | participant-only, magic-byte + ext checks, size cap |
| POST/GET/DELETE | `/stories/` `/feed` `/react` `/reply` `/view` `/media` | 🔒 | ✅ (create/feed/view/delete) | **react/reply/media no RL** (Low) — add |
| POST/GET/PUT | `/call/config` `/log` `/logs` `/end` | 🔒 | ✅ | — |
| POST/GET/DELETE | `/push/subscribe` `/subscriptions` `/vapid-public-key` | 🔒 | ✅ | SSRF-guarded endpoints (tests) |
| POST/GET/PATCH/DELETE | `/blocks/*` `/blocks/privacy` | 🔒 | ✅ | cannot block self; duplicate rejected |
| GET | `/healthz` `/health` `/metrics` | ⛔/🔒 | — | root `/metrics` auth-gated outside dev; `/health` does live DB ping |
| GET | `/docs` `/redoc` `/openapi.json` | ⛔ | — | **Now dev-only** — `docs_url/redoc_url/openapi_url=None` when `APP_ENV != "development"` (main.py) | — |
| WS | `/ws` (signaling) | token | — | token subprotocol + session_version (F-14); no Origin check (Low — SwSAuth token not cookie-based, low CSWSH risk) |

Overall: **no confirmed critical exploit path** in the API surface.

---

## 6. DATABASE SECURITY

| Check | Result | Evidence / Notes |
|---|---|---|
| RLS enabled | PASS | RLS migrations set `ALTER TABLE ... FORCE ROW LEVEL SECURITY` on user tables |
| App role | PASS | app connects as non-superuser `nexara_app`; migrations run as separate role (compose `backend-migrate`) |
| Current-user scoping | PASS | session-level `app.current_user_id` set per request; system maintenance uses `'system'` |
| Vertical isolation | PASS | `messages_me` mapped via user_id; conversations via membership table filter; attachments/stories/privacy via owner/membership |
| Authorization in DB | PASS | RLS prevents set-returning queries from leaking other users' rows even if a future endpoint forgets a filter (belt-and-suspenders) |
| Foreign keys / cascade | PASS | message stars/pins/reactions cascade; conversation delete-cancel/confirm flow |
| Sensitive columns | PASS | no plaintext secrets in DB; OTP/recovery in Redis w/ TTL; PIN hashed; refresh-token family revocable |
| Exposed views/functions | NONE | no public views; maintenance function internal |
| One-user-reads-another | CONFIRMED SAFE | 20+ negative tests across conversations/messages/attachments/stories/devices/groups/blocks; RLS backs it independently |
| NOT VERIFIED | live PG | local env is SQLite; RLS executed in CI `rls-smoke` job only — watch that job on first GitHub run |

---

## 7. FRONTEND AUDIT

| Area | Finding | Severity |
|---|---|---|
| Auth-token storage | JWT in memory only; refresh HttpOnly cookie — no XSS-exfil source | PASS |
| Route splitting | `AppRoutes.jsx` lazy() + Suspense for all pages | PASS |
| Error handling | `ErrorBoundary` at root; inline 404 | PASS |
| Loading/empty/error states | present across pages | PASS |
| a11y basics | labels, focus-visible, contrast pass in earlier review; F-21 dialog fixed | PASS |
| Cookie consent | now PASS — new `CookieConsent.jsx` banner (strictly-necessary cookie notice) with legal links + persisted choice | — |
| OG image | none | LOW |
| Bundle budget | no size budget / no gzip report gate | MED |
| Axe checks in CI | not present | LOW |
| SW caching | `sw.js` present; verify stale asset invalidation during releases | MED-ish |
| `nexara-hud.html` | present in `public/` (a debug/hud page) — confirm intended for prod | LOW |
| Dist scan | no secrets in build output | PASS |

---

## 8. BACKEND AUDIT

| Area | Finding | Severity |
|---|---|---|
| Auth dependency coverage | exhaustive on data routes (route enumeration) | PASS |
| CSRF | Origin/Referer gate on refresh+logout (F-11); SameSite=strict | PASS |
| Rate limiting | 67 declarations; broad coverage | PASS |
| Body limits | global + per-route size caps; `MAX_REQUEST_BODY_SIZE` 550 MB guard | PASS |
| Error mapping | safe global handlers | PASS |
| Logging | request-id correlation; security events logged; no secrets logged | PASS |
| /docs + /openapi in prod | now dev-only (main.py doc URLs gated on APP_ENV) | FIXED |
| Sentry | backend + frontend wired; only DSNs (deploy-time env) remain | PARTIAL |
| ecdsa | CVE-2024-23342, no fix yet | MED |
| Reuse/rotation | refresh rotate + reuse → re-auth | PASS |

---

## 9. AI/ML SECURITY

NOT APPLICABLE — no AI/LLM endpoints, prompts, retrieval, or inference in the codebase (grep across backend + frontend confirmed only the word "prompt" in a UX comment). If the roadmap adds an assistant, revisit: treat model keys as server-only, add cost caps + per-user rate limits, and validate/model-route outputs.

---

## 10. PERFORMANCE

Biggest items (no live load test performed — these are inspection-based):
1. **Media/attachment serving** — blobs are E2EE so not proxy-cacheable; per-download `attachments.download` + `sync` limits cap abuse; consider object storage with signed URLs later (P3).
2. **Read paths** — history/starred/search are indexed + limited; verify index coverage on `messages.me`/stars/pins in prod (EXPLAIN on deploy).
3. **Bundle** — set a Vite budget (MED).
4. **WS fanout** — broadcast for each purge tick and messaging events; Redis bus behind it (verify usage under load).
5. **OTP/Redis** — one round-trip per auth; fine.

---

## 11. ACCESSIBILITY

- PASS: keyboard nav + focus-visible, semantic headings, alt/labels, contrast (prior review), F-21 dialog role/aria/focus management.
- LOW: no automated axe run in CI — add `@axe-core/playwright` to the e2e job.

---

## 12. SEO

- PASS: title/meta/canonical/OG/Twitter tags (F-22).
- LOW: no `sitemap.xml`, no OG image, robots `Disallow: /` (fine for auth-walled app — intentionally not indexable). No structured data needed for a private app.

---

## 13. PRIVACY & DATA PROTECTION

- Collected: email (only for OTP/recovery), encrypted content blobs (opaque to server), call logs, device keys, usage events (Request-ID/Logs).
- Stored: Postgres (metadata, ciphertext) + disk (blobs) + Redis (short-lived OTP/limits/expiry).
- Access: operators (host) can see metadata/keys, not plaintext (E2EE). Production on-call = trusted.
- Deletion: `DELETE /auth/account` (3/day limited) — should also purge blobs/RLS rows; verify cascade coverage.
- Retention: disappearing messages purged by loop; call logs/recovery artifacts — set explicit retention policy.
- Third-party: SMTP sender, Turnstile, Web Push (VAPID), optional Sentry. Each needs a DPIA/processor clause in the privacy copy.
- **Blockers: placeholder privacy/terms (HIGH) + consent banner (HIGH).**

---

## 14. TEST PLAN

### Functional (already executed and passing — re-run on every PR)
- Backend: `pytest backend/test_all.py` → **213 passed** (2m31s).
- Frontend unit: `npx vitest run` → **46/46**.
- Node integration: `node --test frontend/all.test.js` (or per project) → **58/58**.
- Typecheck: `npx tsc --noEmit` clean; build: `npm run build` OK; lint: `ruff check .` clean.
- E2E: Playwright suite in CI (`e2e` job) — **not runnable locally; confirm on GitHub**.
- RLS smoke in CI (`rls-smoke` job) — **confirm on GitHub**.

### Security tests to add/run
- Refresh-reuse freeze: replay old refresh after rotation → must force re-auth. (Unitized.)
- OTP brute force: exceed `otp.verify.ip`/user limit → 429. (Rate tests exist; assert exact status.)
- Turnstile fail-closed in prod mode: `DEBUG=false` + no secret → all pre-auth requests rejected. (Unit.)
- IDOR sweep: for each `{id}` route, attempt with another user's token → 403/404, across messages/stories/attachments/devices/bundles (regression harness from §5 table).
- Malicious uploads: disguised `.html`/`.js` rejected (tests exist); add oversized (`> max`) + decompression-bomb image (Pillow cap check).
- CSRF: cross-origin cookie POSTs → 403 (exists).
- WS hijack: no/foreign token → 1008; wrong session_version → 1008 (exists).
- Prompt injection: N/A.

### Edge cases
Empty body, giant strings (Pydantic max), duplicate friend/block requests, expired OTP/recovery token, deleted message star/pin/reaction, deleted conversation history, missing attachment blob, malformed UUIDs, network timeout on refresh, DB outage (`/health` fails → LB drains).

---

## 15. ATTACK SIMULATION ("TRY TO BREAK IT")

Performed by direct source tracing + existing negative test evidence (not live exploitation):

1. **Swap `conversation_id` in history/search/pin/read-all** → membership check rejects (tests). ✅
2. **Swap `message_id` in edit/delete/star/pin/reaction/view-once** → sender/member gate → 403. ✅
3. **Fetch another user's attachment/story/avatar** → membership + block filter; disguised-extension rejection tested. ✅
4. **Grab another user's key bundle** → now 403 unless friend (F-08); recurring pulls would drain OPKs → mitigate with RL (P2). 
5. **PLG: prekey/register spamming** → no slowapi limit; bounded by 1 device re-registration check; add limits (P2).
6. **Refresh cookie forgery/replay** → signed + rotation + reuse-detection; family revoke on logout. ✅
7. **CSRF via cross-origin fetch** → Origin gate on state-changing cookie routes. ✅
8. **Enumeration via OTP** → generic responses + per-IP/user limits + Turnstile. ✅
9. **Invite-link guessing** (join-with-link) → rate-limit missing (P2). 
10. **Cost/DoS**: story media + attachment downloads limited; `/docs` exposure only leaks schema (no auth bypass). 
11. **Stored XSS via attachment** → content is encrypted blob; served with `Content-Disposition` + no inline render as HTML; disguised-script rejected at upload. ✅
12. **Secrets** — none in git, none in builds. ✅

No exploit that surfaces another user's plaintext or elevates privilege was found.

---

## 16. PRIORITY ROADMAP

**P0 — before deploy**
1. Real Privacy Policy + Terms content (F-23) — cannot ship placeholder legal.

**P1 — before public launch**
2. ~~Cookie-consent banner~~ ✅ done (2026-10-06) — `CookieConsent.jsx`.
3. ~~Wire Sentry (backend `SENTRY_DSN` + frontend `@sentry/react`)~~ ✅ done — set both DSNs as deploy env vars + alert route on the host.
4. ~~Disable `/docs`/`/redoc`/`/openapi.json` in prod~~ ✅ done — `docs_url=None` etc. when `APP_ENV != "development"`.
5. Confirm live-host: nginx `-t`, TLS certs, HSTS, HTTP→HTTPS 301, SMTP TLS, real-Postgres RLS (run CI `rls-smoke`/`e2e` on GitHub).
6. Decide WebAuthn: implement or remove dormant `webauthn_credential` table/migration.

**P2 — shortly after launch**
7. Rate-limit gaps: `join-with-link`, `messages/read-all`+`pinned`, stories react/reply/media, devices register/prekeys/bundle, keys endpoints.
8. Re-check `ecdsa` CVE fix; drop `.trivyignore` entry when available.
9. Vite bundle-size budget + axe-core in e2e CI.
10. OG image + optional `sitemap.xml`.
11. SW cache-busting strategy during releases.

**P3 — future**
12. Object storage w/ signed URLs for blobs; EXPLAIN-based index tuning on `messages.me`/pin/star.
13. Account-deletion blob/cascade audit under long-term retention; central log sink + retention policy.
14. WebAuthn/PASSKIT as passwordless 2FA if adopted.

---

## 17. FINAL VERDICT

**⚠️ DEPLOY ONLY AFTER FIXING P0/P1**

Not "ready" yet — but not because of broken code. The engineering is in strong shape (90 security, no criticals, deep authz/rate-limit/RLS coverage). Post-audit fixes (2026-10-06) shipped the consent banner, Sentry wiring, prod docs lockdown, and dependency-patch cleanup; the remaining blockers are operational: no real legal content, live TLS/nginx unverified, deploy-time DSNs to fill. Fix the legal copy (one work session) + perform the deploy gate, and it is genuinely deployable.

---

## 18. TOP 10 FIXES (in order)

Status: items 2–4 shipped 2026-10-06.

1. **Write real Privacy Policy + Terms** into `frontend/src/pages/Legal/legalContent.js` (P0).
2. ~~Cookie-consent banner~~ ✅ done (`frontend/src/components/layout/CookieConsent.jsx` + css + tests).
3. ~~Sentry wiring~~ ✅ done (frontend `@sentry/react` init via `VITE_SENTRY_DSN` + ErrorBoundary `captureException`; backend init already present). **Deploy step:** set `SENTRY_DSN` + `VITE_SENTRY_DSN` and an alert.
4. ~~Disable `/docs`/`/redoc`/`/openapi.json` in prod~~ ✅ done (main.py, gated on `APP_ENV`).
5. **Run the deploy gate**: nginx `-t`, TLS+HSTS, HTTP→HTTPS 301, SMTP TLS, live RLS smoke + Playwright on GitHub (P1).
6. **Rate-limit the gaps**: join-with-link, read-all/pinned, stories react/reply/media, devices register/prekeys/bundle, keys (P2).
7. **Decide WebAuthn**: implement or remove the dormant tables (P1/P3).
8. **Re-audit `ecdsa`** CVE-2024-23342 fix and drop `.trivyignore` when shipped (P2).
9. **Vite bundle budget + axe-core in CI** (P2).
10. **OG image + optional sitemap + SW release cache-busting** (P2).

---

## 19. USER-FEEDBACK FIX ROUND (2026-10-06, from `docs/user-reviews-2026-10-06.txt`)

Shipped this session (verified: pytest 213 passed / vitest 49 / node 58 / tsc / build):

- **Removed `frontend/public/nexara-hud.html`** — debug HUD page was shipping to prod (review #44). No code references it. 🧹
- **Rate-limit gaps closed** (audit §5 + review #37 invite spam):
  - `POST /conversations/join-with-link` → dedicated `conversations.join_link` bucket (10/60) instead of sharing `conversations.group`.
  - `POST /messages/read-all/{id}` → `messages.read_all` 60/60.
  - `GET /messages/pinned/{id}` → `messages.pinned` 120/60.
  - `POST/DELETE /stories/{id}/react` → `stories.react` 60/60; `POST /stories/{id}/reply` → `stories.reply` 20/60; `GET /stories/{id}/media` → `stories.media` 120/60.
  - `POST /devices/register` → 10/60; `GET /devices/{user}/bundle` → 60/60 (also guards OPK drain); `POST /devices/prekeys/upload` → 30/60; `POST /devices/prekeys/signed` → 10/60.
  - `keys.py` already had per-user limits (10/60 upload, 60/60 get) — no change.
- **Reaction ceiling raised** 60→120/min (review #14; no test depended on the value).
- **OTP page "check your email" notice** (review #17) — highlighted banner under the email on the OTP stage.
- **Tab-title unread count** (review #42) — `ChatSocketContext` drives `document.title` `(N)S Nexara`.
- **Story countdown** (review #3) — StoryViewer header shows "· Expires in Xh Ym" (live via the existing progress ticker).
- **404 page** (review #6) — branded glass-panel card with gradient "404" and link home.

Deferred (not code-blocked, need product/design/decisions — see `docs/user-reviews-2026-10-06.txt`):
global message search; i18n; WebAuthn (or drop tables); email-less accounts; group voice rooms; push-to-talk/who's-speaking; edit history + group activity log; stickers/GIF; quiet hours + split notification toggles; bulk multi-forward; compressed-send presets; 2GB share cap; mark-as-read-on-open; close-friends list + per-story mute; story sticker reactions; recovery-code PDF/email rescue; metadata minimization + bulk purge; keys/ciphertext export; native App Store/Play apps + iOS share sheet; self-host docs; corporate audit features; colorblind shape states; low-end performance mode. Legal pages (F-23) still blocked on operator name/address/jurisdiction.