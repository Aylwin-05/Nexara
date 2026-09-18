# Contributing to Nexara

Thanks for your interest in improving Nexara — a privacy-first,
end-to-end encrypted messaging platform.

## Development Setup

### Backend (FastAPI + PostgreSQL)

```bash
cd backend
python -m venv .venv && .venv\Scripts\activate   # or source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env                              # fill in values
alembic upgrade head
uvicorn app.main:app --reload                     # http://localhost:8000
```

Prerequisites: PostgreSQL 14+ on `:5432` with a `nexara` database.
Redis is optional; without `REDIS_URL` the app falls back to in-memory rate
limiting (single-instance only).

### Frontend (React 19 + Vite)

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173, proxies /api and /ws to :8000
```

## Running Tests

```bash
cd backend  && python -m pytest test_all.py   # full API + crypto suite (205 tests)
cd frontend && npm test                       # Vitest (34 tests)
```

The backend suite is consolidated in `backend/test_all.py`; sections are labeled
with their origin. The frontend ships unit tests in `frontend/src` (e.g.
`signalService.test.js`, `appLock.test.js`, `avatar.test.js`, `theme.test.js`,
`Sidebar.test.jsx`) plus the consolidated `frontend/all.test.js`.

Please make sure both suites pass before opening a pull request, and add
tests for any new behavior — especially anything touching the crypto layer.
New backend tests go in `backend/test_all.py` (append a clearly-labeled
section); new frontend tests go in a co-located `*.test.js(x)` file under
`frontend/src` alongside the code they cover.

## Architecture Notes

- **Crypto happens only in the browser.** The server stores ciphertext,
  wrapped keys, and metadata. Never move key material or plaintext handling
  server-side.
- Client Signal implementation lives in `frontend/src/crypto/signal/` and is
  mirrored in Python under `backend/app/crypto/signal/` for wire-compatibility
  tests. Changes must stay in sync across both.
- Database changes require an Alembic migration (`alembic revision
  --autogenerate`), reviewed for fresh-install correctness as well as
  upgrade-from-previous-head correctness.

## Pull Requests

1. Fork the repo and create a feature branch from `main`.
2. Keep commits focused; write clear commit messages.
3. Update documentation (`README.md`, docstrings) alongside behavior changes.
4. Ensure migrations, tests, and lint-clean code are included.

## Reporting Security Issues

Found a vulnerability? Please do **not** open a public issue. Contact the
maintainers directly via GitHub so it can be triaged and patched responsibly.
