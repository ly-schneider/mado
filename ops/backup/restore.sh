#!/bin/sh
# Replaces the live database with a dump (the newest one by default). Stop the api first.
# Drops and recreates the database instead of pg_restore --clean, which can't drop pg-boss's partitioned tables.
# Runs as the bootstrap superuser (only it may drop and create databases); the objects end up owned by
# mado_owner, which is not a superuser, so the app's migrations keep working on them.
set -eu

DIR="${BACKUP_PATH:-/backups}"
DB="${PGDATABASE:-mado}"
OWNER="${MADO_OWNER_ROLE:-mado_owner}"

dump="${1:-$(find "$DIR/daily" -maxdepth 1 -name 'mado-*.dump' | sort -r | head -n 1)}"
[ -n "$dump" ] && [ -f "$dump" ] || { echo "restore: no dump found in $DIR/daily" >&2; exit 1; }

active="$(psql -d postgres -At -c "SELECT count(*) FROM pg_stat_activity WHERE datname = '$DB' AND usename <> current_user")"
if [ "$active" -gt 0 ]; then
  echo "restore: the api is still connected to $DB. Run 'docker compose stop api' first." >&2
  exit 1
fi

echo "restore: $dump into $DB"
dropdb --force --if-exists "$DB"
createdb --owner="$OWNER" "$DB"
# Older dumps still contain pg-boss; the app recreates it as its own role.
pg_restore -d "$DB" --no-owner --role="$OWNER" --exclude-schema=pgboss --exit-on-error "$dump"
echo "restore ok. Start the app again with 'docker compose start api'."
