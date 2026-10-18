#!/bin/bash
# Daily backup: mysqldump (gzip) of the database + tar of server/storage.
# Keeps 14 days locally, deletes anything older. Run as a cron job on the
# production VPS (see docs/deploy.md section 8 for the crontab line) - this
# file is the real script; docs/deploy.md just shows how to install it.
#
# Reads DB credentials from server/.env (the same file the app itself uses)
# so there's only one place to keep them in sync. Never run this against a
# database other than the one that .env points at - on a dev machine, make
# sure .env's DB_NAME is the TEST database before testing this script.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$APP_DIR/server/.env}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/conference-cms}"
KEEP_DAYS="${KEEP_DAYS:-14}"
DATE="$(date +%F_%H%M%S)"

if [ ! -f "$ENV_FILE" ]; then
  echo "backup.sh: $ENV_FILE not found" >&2
  exit 1
fi

# Pull just the DB_* lines out of .env without sourcing the whole file
# (.env may contain values with characters that aren't safe to `source`).
db_value() {
  grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2-
}
DB_HOST="$(db_value DB_HOST)"
DB_PORT="$(db_value DB_PORT)"
DB_USER="$(db_value DB_USER)"
DB_PASSWORD="$(db_value DB_PASSWORD)"
DB_NAME="$(db_value DB_NAME)"
DB_PORT="${DB_PORT:-3306}"

MYSQLDUMP_BIN="${MYSQLDUMP_BIN:-mysqldump}"

mkdir -p "$BACKUP_DIR"

echo "[$DATE] Backing up database '$DB_NAME' ..."
# --no-tablespaces: the app's DB user (deploy.md's `cms_app`) only has
# SELECT/INSERT/UPDATE/DELETE, not the PROCESS privilege mysqldump otherwise
# wants for tablespace metadata it doesn't need anyway - without this flag
# the dump fails outright with "Access denied ... PROCESS privilege(s)".
"$MYSQLDUMP_BIN" \
  --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" --password="$DB_PASSWORD" \
  --single-transaction --routines --triggers --no-tablespaces \
  "$DB_NAME" | gzip > "$BACKUP_DIR/db-$DB_NAME-$DATE.sql.gz"

echo "[$DATE] Backing up server/storage ..."
if [ -d "$APP_DIR/server/storage" ]; then
  tar -czf "$BACKUP_DIR/storage-$DATE.tar.gz" -C "$APP_DIR/server" storage
else
  echo "  (no server/storage directory - skipped, nothing uploaded yet)"
fi

echo "[$DATE] Pruning backups older than $KEEP_DAYS days ..."
find "$BACKUP_DIR" -maxdepth 1 -name '*.gz' -mtime "+$KEEP_DAYS" -print -delete

# Optional second copy (another server or a cloud bucket) - off by default.
# Set REMOTE_BACKUP_DEST to an rclone remote (e.g. "s3:my-bucket/cms-backups/")
# or an rsync/scp target (e.g. "user@otherhost:/backups/cms/") and this will
# copy the two files just created there too. Needs rclone or rsync installed
# and already configured/authenticated - this script does not set that up.
if [ -n "${REMOTE_BACKUP_DEST:-}" ]; then
  echo "[$DATE] Copying to $REMOTE_BACKUP_DEST ..."
  if command -v rclone >/dev/null 2>&1; then
    rclone copy "$BACKUP_DIR/db-$DB_NAME-$DATE.sql.gz" "$REMOTE_BACKUP_DEST"
    [ -f "$BACKUP_DIR/storage-$DATE.tar.gz" ] && rclone copy "$BACKUP_DIR/storage-$DATE.tar.gz" "$REMOTE_BACKUP_DEST"
  elif command -v rsync >/dev/null 2>&1; then
    rsync -a "$BACKUP_DIR/db-$DB_NAME-$DATE.sql.gz" "$REMOTE_BACKUP_DEST"
    [ -f "$BACKUP_DIR/storage-$DATE.tar.gz" ] && rsync -a "$BACKUP_DIR/storage-$DATE.tar.gz" "$REMOTE_BACKUP_DEST"
  else
    echo "  REMOTE_BACKUP_DEST is set but neither rclone nor rsync is installed - skipped." >&2
  fi
fi

echo "[$DATE] Done: $BACKUP_DIR/db-$DB_NAME-$DATE.sql.gz"
