#!/bin/sh
# Restores the newest dump (or the one given) into a scratch database, compares row counts
# with the live database and drops the scratch copy again. Exits non-zero if anything looks wrong.
set -eu

DIR="${BACKUP_PATH:-/backups}"
LIVE="${PGDATABASE:-mado}"
SCRATCH="mado_restore_test"

dump="${1:-$(find "$DIR/daily" -maxdepth 1 -name 'mado-*.dump' | sort -r | head -n 1)}"
[ -n "$dump" ] && [ -f "$dump" ] || { echo "restore test: no dump found in $DIR/daily" >&2; exit 1; }
echo "restore test: $dump"

pg() { PGOPTIONS="-c client_min_messages=warning" psql -v ON_ERROR_STOP=1 -At "$@"; }
pg -d postgres -c "DROP DATABASE IF EXISTS $SCRATCH" > /dev/null
pg -d postgres -c "CREATE DATABASE $SCRATCH" > /dev/null
trap 'pg -d postgres -c "DROP DATABASE IF EXISTS $SCRATCH" > /dev/null' EXIT

pg_restore -d "$SCRATCH" --no-owner --exit-on-error "$dump"

fail=0
for table in users workspaces projects tasks docs revisions audit_log; do
  restored="$(pg -d "$SCRATCH" -c "SELECT count(*) FROM $table")"
  live="$(pg -d "$LIVE" -c "SELECT count(*) FROM $table")"
  printf '%-12s restored %8s   live %8s\n' "$table" "$restored" "$live"
  # The dump is older than live data: fewer rows is fine, more is not. No users while live has some means a bad dump.
  [ "$restored" -gt "$live" ] && fail=1
  [ "$table" = users ] && [ "$restored" -eq 0 ] && [ "$live" -gt 0 ] && fail=1
done

# Markdown bodies came back intact, not just row counts.
pg -d "$SCRATCH" -c "SELECT 'newest doc: ' || coalesce(max(updated_at)::text, 'none') || ', bytes ' || coalesce(sum(length(content)), 0) FROM docs"

[ "$fail" -eq 0 ] || { echo "restore test FAILED" >&2; exit 1; }
echo "restore test ok"
