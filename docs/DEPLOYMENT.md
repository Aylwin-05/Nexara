# Nexara Deployment

Two supported profiles, both in this repository:

| Profile | File | Use |
|---|---|---|
| Single node | `docker-compose.yml` | Small deployments, local, self-hosted |
| Scaled/hardened | `docker-compose.prod.yml` | Multi-worker backend, Redis fan-out, TLS via certbot |

Docker host with `docker compose` (v2+) is the only prerequisite. Postgres and Redis
run as containers; nginx serves the SPA and proxies `/api` and `/ws` to the backend.

## 1. Configure

Copy the template and fill every value:

```bash
cp .env.example .env
```

Required in production (the backend **fails fast** if these are wrong or missing):

- `SECRET_KEY` — `python -c "import secrets; print(secrets.token_urlsafe(48))"`
- `TURN_SECRET` — `openssl rand -hex 32`
- `POSTGRES_PASSWORD`, `BACKUP_PASSPHRASE`
- `ALLOWED_HOSTS`, `CORS_ORIGINS`, `FRONTEND_URL` — your real domain(s)
- `SMTP_*` — a working SMTP account (Gmail App Password recommended)
- `REDIS_URL` — `redis://redis:6379/0`
- `WEBAUTHN_RP_ID` — your real domain, matching the origin

Keep `.env` out of git (it is). `POSTGRES_PASSWORD` must match between `.env` and the
`postgres` service of the base compose file.

## 2. Single node

```bash
docker compose up --build -d
```

- `alembic upgrade head` runs automatically at backend boot.
- Uploads live in the `uploads` named volume; Postgres data in `pgdata`; Redis in the
  container FS (ephemeral by design — it is a cache).

## 3. Scaled (multi-worker) profile

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```

Differences:
- Backend runs **2 replicas** (override `WEB_CONCURRENCY` / `deploy.replicas`).
- `REDIS_URL` is mandatory — workers share presence/event fan-out over Redis.
- `COOKIE_SECURE=true`, `DEBUG=false`, pinned `ALLOWED_HOSTS`/`CORS_ORIGINS`.
- certbot container provisions/renews Let's Encrypt certificates; renewals are
  file-based (no port conflict with :80 ACME).

### TLS first run

1. Start nginx with plain HTTP once (comment-out the HTTPS `server` block or start
   without the cert mount) so ACME challenges answer.
2. `docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm certbot`
   (the env supplies your domain/email context).
3. Revert to `nginx.prod.conf` (which expects
   `/etc/letsencrypt/live/$domain/fullchain.pem`) and restart nginx.

`$domain` in `nginx.prod.conf` is a literal placeholder — substitute your domain in a
fork/mount of the file (it is not shell-substituted).

## 4. Backups

The `postgres-backup` service (base file) runs `scripts/backup-db.sh` on a schedule;
the prod profile instead dumps → gzip → AES-256-CBC (`openssl enc`, 100k pbkdf2
iterations) into the `pgbackups` volume, rotated at 30 days. Restore from a `.enc`
file:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -salt -pass env:BACKUP_PASSPHRASE \
  -in nexara_<ts>.sql.gz.enc | gunzip | pg_restore --no-owner -d nexara
```

## 5. TURN / calls

Calls use public STUN by default. For reliable calls behind symmetric NATs deploy the
bundled coturn image (`coturn/`, already in compose) with `TURN_SECRET` and
`TURN_REALM` set. When `TURN_SECRET` is set on the backend, `GET /api/v1/call/config`
mints short-lived per-user credentials instead of sharing the static pair.
See [TURN_SERVER_SETUP.md](TURN_SERVER_SETUP.md) for a standalone setup.

## 6. Health checks

- `/healthz` — load-balancer probe (DB only), 200/503
- `/health` — structured (degraded = 503) with database/redis/uptime
- nginx and backend containers expose `HEALTHCHECK` directives; compose wiring is under
  `depends_on: condition: service_healthy`.

## 7. Hardening checklist

- Firewall: expose only `443` (and `80` for ACME) plus TURN UDP/TCP 3478 and the relay
  range (49152–65535) if you run your own coturn.
- `COOKIE_SECURE=true`, `ALLOWED_HOSTS` pinned, `DEBUG=false` (backend refuses to boot
  otherwise).
- Access tokens never persist; refresh cookie alias `__Secure-` prefix when served under
  HTTPS.
- Curator `/metrics` behind auth in production (already wired).
- Secrets live solely in `.env` and Docker secrets — never in the repo. gitleaks runs in
  pre-commit.