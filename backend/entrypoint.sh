#!/bin/sh
set -e

MAX_RETRIES=30
RETRY_INTERVAL=2

echo "[entrypoint] Waiting for database..."

i=0
until python -c "
import asyncio, sqlalchemy
from sqlalchemy.ext.asyncio import create_async_engine
async def _check():
    e = create_async_engine('${DATABASE_URL}', pool_pre_ping=True)
    async with e.connect() as conn:
        await conn.execute(sqlalchemy.text('SELECT 1'))
    await e.dispose()
asyncio.run(_check())
" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -ge "$MAX_RETRIES" ]; then
    echo "[entrypoint] ERROR: Database not ready after ${MAX_RETRIES} attempts"
    exit 1
  fi
  echo "[entrypoint] Database not ready (attempt ${i}/${MAX_RETRIES}), retrying in ${RETRY_INTERVAL}s..."
  sleep "$RETRY_INTERVAL"
done

echo "[entrypoint] Database is ready"

echo "[entrypoint] Running migrations..."
alembic upgrade head

echo "[entrypoint] Starting server..."

WEB_CONCURRENCY="${WEB_CONCURRENCY:-1}"

if [ "$WEB_CONCURRENCY" -gt 1 ]; then
  exec gunicorn app.main:app \
      -c gunicorn.conf.py \
      --workers "$WEB_CONCURRENCY"
else
  exec uvicorn app.main:app \
      --host 0.0.0.0 \
      --port 8000 \
      --proxy-headers \
      --forwarded-allow-ips="${FORWARDED_ALLOW_IPS:-127.0.0.1}"
fi
