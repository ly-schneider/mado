# Backup sidecar: pg_dump on a cron schedule, local rotation, optional offsite copy with rclone.
# Major version must match the server's, or pg_dump refuses to run.
FROM postgres:18.6-alpine@sha256:9ba53c7d41ea093baf5c1ba635ba5434c4f979880527d49bb7d9237d3193085b
RUN apk add --no-cache rclone tzdata && mkdir -p /root/.config/rclone && touch /root/.config/rclone/rclone.conf
COPY backup.sh /usr/local/bin/backup
COPY restore-test.sh /usr/local/bin/restore-test
COPY restore.sh /usr/local/bin/restore
COPY upgrade-roles.sh /usr/local/bin/upgrade-roles
COPY entrypoint.sh /usr/local/bin/backup-entrypoint
RUN chmod +x /usr/local/bin/backup /usr/local/bin/restore-test /usr/local/bin/restore /usr/local/bin/upgrade-roles /usr/local/bin/backup-entrypoint
VOLUME /backups
ENTRYPOINT ["/usr/local/bin/backup-entrypoint"]
