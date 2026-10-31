#!/bin/sh
# Turns BACKUP_SCHEDULE / RESTORE_TEST_SCHEDULE into a crontab and runs crond in the foreground.
set -eu

BACKUP_SCHEDULE="${BACKUP_SCHEDULE:-15 2 * * *}"
RESTORE_TEST_SCHEDULE="${RESTORE_TEST_SCHEDULE:-0 4 1 * *}"

# busybox crond starts jobs with an empty environment, so hand them ours.
export -p > /etc/backup.env
# Job output goes to the container log.
run() { echo "$1 . /etc/backup.env; $2 > /proc/1/fd/1 2> /proc/1/fd/2"; }

{
  run "$BACKUP_SCHEDULE" /usr/local/bin/backup
  [ "$RESTORE_TEST_SCHEDULE" = "off" ] || run "$RESTORE_TEST_SCHEDULE" /usr/local/bin/restore-test
} > /etc/crontabs/root

echo "backup: schedule '$BACKUP_SCHEDULE', restore test '$RESTORE_TEST_SCHEDULE', offsite '${BACKUP_REMOTE:-off}'"
if [ "${BACKUP_ON_START:-false}" = "true" ]; then
  /usr/local/bin/backup || echo "backup: first run failed, cron keeps trying" >&2
fi
exec crond -f -l 8
