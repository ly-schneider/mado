# Backup sidecar: pg_dump on a cron schedule, local rotation, optional offsite copy with rclone.
# Major version must match the server's, or pg_dump refuses to run.
FROM postgres:18.6-alpine@sha256:10a5c69a83035ab5239f5620d708520e8b28f5aa1f2b20143e6024532edadfb5
RUN apk add --no-cache rclone tzdata && mkdir -p /root/.config/rclone && touch /root/.config/rclone/rclone.conf
COPY backup.sh /usr/local/bin/backup
COPY restore-test.sh /usr/local/bin/restore-test
COPY restore.sh /usr/local/bin/restore
COPY entrypoint.sh /usr/local/bin/backup-entrypoint
RUN chmod +x /usr/local/bin/backup /usr/local/bin/restore-test /usr/local/bin/restore /usr/local/bin/backup-entrypoint
VOLUME /backups
ENTRYPOINT ["/usr/local/bin/backup-entrypoint"]
