#!/bin/sh
# pg_dump (custom format) into /backups, keep KEEP_DAILY daily and KEEP_WEEKLY weekly dumps,
# mirror them to BACKUP_REMOTE with rclone, and record the run in settings "backup.last".
# Connection comes from the standard PGHOST / PGUSER / PGPASSWORD / PGDATABASE variables.
set -eu

DIR="${BACKUP_PATH:-/backups}"
KEEP_DAILY="${KEEP_DAILY:-14}"
KEEP_WEEKLY="${KEEP_WEEKLY:-8}"

mkdir -p "$DIR/daily" "$DIR/weekly"
file="$DIR/daily/mado-$(date -u +%Y-%m-%dT%H%MZ).dump"

pg_dump --format=custom --compress=9 --no-owner --file="$file.partial"
# A dump that pg_restore can't list is not a backup.
pg_restore --list "$file.partial" > /dev/null
mv "$file.partial" "$file"
size="$(wc -c < "$file" | tr -d ' ')"

if [ "$(date -u +%u)" = "7" ]; then
  cp "$file" "$DIR/weekly/"
fi

prune() {
  # File names carry a UTC timestamp, so name order is age order.
  find "$1" -maxdepth 1 -name 'mado-*.dump' | sort -r | tail -n +"$(($2 + 1))" | xargs -r rm -f --
}
prune "$DIR/daily" "$KEEP_DAILY"
prune "$DIR/weekly" "$KEEP_WEEKLY"

offsite=false
if [ -n "${BACKUP_REMOTE:-}" ]; then
  # sync mirrors the rotation, so the offsite copy never grows past KEEP_DAILY + KEEP_WEEKLY dumps.
  rclone sync "$DIR/daily" "$BACKUP_REMOTE/daily" --include 'mado-*.dump'
  rclone sync "$DIR/weekly" "$BACKUP_REMOTE/weekly" --include 'mado-*.dump'
  offsite=true
fi

psql -v ON_ERROR_STOP=1 -q -v file="$(basename "$file")" -v size="$size" -v offsite="$offsite" <<'SQL'
INSERT INTO settings (key, value, updated_at)
VALUES ('backup.last', jsonb_build_object('at', now(), 'file', :'file', 'bytes', :'size'::bigint, 'offsite', :'offsite'::boolean), now())
ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now();
SQL

echo "backup ok: $file ($size bytes, offsite=$offsite)"
