#!/bin/sh
# Replaces the live database with a dump (the newest one by default). Stop the api first.
# Drops and recreates the database instead of pg_restore --clean, which can't drop pg-boss's partitioned tables.
set -eu

DIR="${BACKUP_PATH:-/backups}"
DB="${PGDATABASE:-mado}"

dump="${1:-$(find "$DIR/daily" -maxdepth 1 -name 'mado-*.dump' | sort -r | head -n 1)}"
[ -n "$dump" ] && [ -f "$dump" ] || { echo "restore: no dump found in $DIR/daily" >&2; exit 1; }

active="$(psql -d postgres -At -c "SELECT count(*) FROM pg_stat_activity WHERE datname = '$DB' AND usename <> current_user")"
if [ "$active" -gt 0 ]; then
  echo "restore: the api is still connected to $DB. Run 'docker compose stop api' first." >&2
  exit 1
fi

echo "restore: $dump into $DB"
dropdb --force --if-exists "$DB"
createdb "$DB"
pg_restore -d "$DB" --no-owner --exit-on-error "$dump"
echo "restore ok. Start the app again with 'docker compose start api'."
