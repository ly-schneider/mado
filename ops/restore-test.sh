#!/usr/bin/env bash
# Monthly restore test: restores the newest dump into a scratch database next to the live one,
# compares row counts and drops it again. Exits non-zero if anything looks wrong.
#
#   0 4 1 * *  BACKUP_DIR=/mnt/backup/mado /opt/mado/ops/restore-test.sh
set -euo pipefail

: "${BACKUP_DIR:?set BACKUP_DIR}"
HERE="$(cd "$(dirname "$0")" && pwd)"
export COMPOSE_FILE="${COMPOSE_FILE:-$HERE/docker-compose.yml}"
SCRATCH="mado_restore_test"

latest="$(find "$BACKUP_DIR/daily" -maxdepth 1 -name 'mado-*.dump' | sort -r | head -n 1)"
[ -n "$latest" ] || { echo "no dump found in $BACKUP_DIR/daily" >&2; exit 1; }
echo "restoring $latest"

pg() { docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U mado_owner -At "$@"; }

pg -d postgres -c "DROP DATABASE IF EXISTS $SCRATCH" >/dev/null
pg -d postgres -c "CREATE DATABASE $SCRATCH" >/dev/null
trap 'pg -d postgres -c "DROP DATABASE IF EXISTS $SCRATCH" >/dev/null' EXIT

docker compose exec -T postgres pg_restore -U mado_owner -d "$SCRATCH" --no-owner --exit-on-error <"$latest"

count() { pg -d "$1" -c "SELECT count(*) FROM $2"; }
fail=0
for table in users workspaces projects tasks docs revisions audit_log; do
  restored="$(count "$SCRATCH" "$table")"
  live="$(count mado "$table")"
  printf '%-12s restored %8s   live %8s\n' "$table" "$restored" "$live"
  # The dump is older than live data, so it may have fewer rows, never more. No users while live has some means a bad dump.
  if [ "$restored" -gt "$live" ]; then fail=1; fi
  if [ "$table" = "users" ] && [ "$restored" -eq 0 ] && [ "$live" -gt 0 ]; then fail=1; fi
done

# Spot check that Markdown bodies came back intact, not just row counts.
pg -d "$SCRATCH" -c "SELECT 'newest doc: ' || coalesce(max(updated_at)::text, 'none') || ', bytes ' || coalesce(sum(length(content)), 0) FROM docs"

if [ "$fail" -ne 0 ]; then
  echo "restore test FAILED" >&2
  exit 1
fi
echo "restore test ok"
