#!/usr/bin/env bash
# Nightly backup: pg_dump (custom format) to a second disk, then offsite via rclone (R2 or B2).
# Keeps 14 daily and 8 weekly dumps. Records the time in settings "backup.last" (shown in Settings).
#
# Run from cron or a systemd timer on the VM, e.g.
#   15 2 * * *  BACKUP_DIR=/mnt/backup/mado RCLONE_REMOTE=r2:mado-backups /opt/mado/ops/backup.sh
#
# Env:
#   BACKUP_DIR      second disk path (required)
#   RCLONE_REMOTE   rclone remote:path for offsite copies (optional)
#   COMPOSE_FILE    defaults to the compose file next to this script
#   KEEP_DAILY      default 14
#   KEEP_WEEKLY     default 8
set -euo pipefail

: "${BACKUP_DIR:?set BACKUP_DIR to the backup disk, e.g. /mnt/backup/mado}"
KEEP_DAILY="${KEEP_DAILY:-14}"
KEEP_WEEKLY="${KEEP_WEEKLY:-8}"
HERE="$(cd "$(dirname "$0")" && pwd)"
export COMPOSE_FILE="${COMPOSE_FILE:-$HERE/docker-compose.yml}"

compose() { docker compose "$@"; }
psql_owner() { compose exec -T postgres psql -v ON_ERROR_STOP=1 -U mado_owner -d mado -At "$@"; }

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly"
stamp="$(date -u +%Y-%m-%dT%H%MZ)"
file="$BACKUP_DIR/daily/mado-$stamp.dump"
tmp="$file.partial"

compose exec -T postgres pg_dump -U mado_owner -d mado --format=custom --compress=9 --no-owner >"$tmp"
# A dump that pg_restore can't list is not a backup.
compose exec -T postgres pg_restore --list >/dev/null <"$tmp"
mv "$tmp" "$file"
size="$(wc -c <"$file" | tr -d ' ')"

# Sundays also go to weekly/.
if [ "$(date -u +%u)" = "7" ]; then
  cp "$file" "$BACKUP_DIR/weekly/"
fi

prune() {
  local dir="$1" keep="$2"
  # File names carry a UTC timestamp, so name order is age order.
  find "$dir" -maxdepth 1 -name 'mado-*.dump' | sort -r | tail -n +"$((keep + 1))" | while read -r old; do rm -f -- "$old"; done
}
prune "$BACKUP_DIR/daily" "$KEEP_DAILY"
prune "$BACKUP_DIR/weekly" "$KEEP_WEEKLY"

offsite=false
if [ -n "${RCLONE_REMOTE:-}" ]; then
  # sync mirrors the rotation, so the offsite copy never grows past 14 + 8 dumps.
  rclone sync "$BACKUP_DIR/daily" "$RCLONE_REMOTE/daily" --include "mado-*.dump"
  rclone sync "$BACKUP_DIR/weekly" "$RCLONE_REMOTE/weekly" --include "mado-*.dump"
  offsite=true
fi

psql_owner -v file="$(basename "$file")" -v size="$size" -v offsite="$offsite" <<'SQL' >/dev/null
INSERT INTO settings (key, value, updated_at)
VALUES ('backup.last', jsonb_build_object('at', now(), 'file', :'file', 'bytes', :'size'::bigint, 'offsite', :'offsite'::boolean), now())
ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now();
SQL

echo "backup ok: $file ($size bytes, offsite=$offsite)"
