#!/bin/bash
# ============================================================
# Nexara Database Backup Script
# ============================================================
# Creates timestamped pg_dump backups, gzip-compressed and then
# AES-256-CBC encrypted with openssl (fail-closed: refuses to
# write plaintext when BACKUP_PASSPHRASE is missing).
#
# Usage:
#   BACKUP_PASSPHRASE=<secret> chmod +x scripts/backup-db.sh
#   BACKUP_PASSPHRASE=<secret> ./scripts/backup-db.sh            # dump to ./backups/
#   BACKUP_PASSPHRASE=<secret> ./scripts/backup-db.sh /mnt/s3-mount
#
# Restore:
#   BACKUP_PASSPHRASE=<secret> openssl enc -d -aes-256-cbc \
#     -pbkdf2 -iter 100000 -pass env:BACKUP_PASSPHRASE \
#     -in backups/nexara_...sql.gz.enc | gunzip \
#     | docker compose exec -T postgres psql -U nexara -d nexara
# ============================================================

set -euo pipefail

: "${BACKUP_PASSPHRASE:?Set BACKUP_PASSPHRASE to encrypt backups (refusing to write plaintext)}"

BACKUP_DIR="${1:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="nexara_${TIMESTAMP}.sql.gz.enc"
CONTAINER="nexara-postgres-1"
DB_USER="nexara"
DB_NAME="nexara"

mkdir -p "${BACKUP_DIR}"

echo "==> Backing up ${DB_NAME} to ${BACKUP_DIR}/${FILENAME} (AES-256-CBC)"

docker compose exec -T postgres pg_dump \
  -U "${DB_USER}" \
  -d "${DB_NAME}" \
  --no-owner \
  --no-acl \
  -Fc \
  | gzip \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt \
      -pass env:BACKUP_PASSPHRASE \
  > "${BACKUP_DIR}/${FILENAME}"

SIZE=$(du -h "${BACKUP_DIR}/${FILENAME}" | cut -f1)
echo "==> Backup complete: ${FILENAME} (${SIZE})"

# Prune backups older than 30 days
echo "==> Pruning backups older than 30 days..."
find "${BACKUP_DIR}" -name "nexara_*.sql.gz.enc" -mtime +30 -delete 2>/dev/null || true

echo "==> Done."
