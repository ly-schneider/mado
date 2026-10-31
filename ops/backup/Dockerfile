# Backup sidecar: pg_dump on a cron schedule, local rotation, optional offsite copy with rclone.
# Major version must match the server's, or pg_dump refuses to run.
FROM postgres:18-alpine
RUN apk add --no-cache rclone tzdata && mkdir -p /root/.config/rclone && touch /root/.config/rclone/rclone.conf
COPY backup.sh /usr/local/bin/backup
COPY restore-test.sh /usr/local/bin/restore-test
COPY entrypoint.sh /usr/local/bin/backup-entrypoint
RUN chmod +x /usr/local/bin/backup /usr/local/bin/restore-test /usr/local/bin/backup-entrypoint
VOLUME /backups
ENTRYPOINT ["/usr/local/bin/backup-entrypoint"]
