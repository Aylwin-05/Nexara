#!/bin/bash
# ============================================================
# Nexara Database Restore Script
# ============================================================
# Restores a backup created by backup-db.sh.
#
# Usage:
#   chmod +x scripts/restore-db.sh
#   ./scripts/restore-db.sh backups/nexara_20260903_120000.sql.gz
#
# WARNING: This will DROP and recreate the database.
# ============================================================

set -euo pipefail

BACKUP_FILE="${1:?Usage: $0 <backup-file.sql.gz>}"
DB_USER="nexara"
DB_NAME="nexara"

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "ERROR: Backup file not found: ${BACKUP_FILE}"
  exit 1
fi

echo "WARNING: This will DROP and recreate the '${DB_NAME}' database."
echo "Backup file: ${BACKUP_FILE}"
read -p "Continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

echo "==> Dropping existing database..."
docker compose exec -T postgres psql -U "${DB_USER}" -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB_NAME}' AND pid <> pg_backend_pid();" || true
docker compose exec -T postgres psql -U "${DB_USER}" -d postgres -c \
  "DROP DATABASE IF EXISTS ${DB_NAME};"
docker compose exec -T postgres psql -U "${DB_USER}" -d postgres -c \
  "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"

echo "==> Restoring from ${BACKUP_FILE}..."
gunzip -c "${BACKUP_FILE}" | docker compose exec -T postgres psql -U "${DB_USER}" -d "${DB_NAME}" -q

echo "==> Running alembic migrations..."
docker compose exec -T backend alembic upgrade head

echo "==> Restore complete."
