# Self-hosting

mado runs as three containers: the app (API, web app, MCP and webhooks in one image), Postgres, and a small backup sidecar. You need Docker with Compose v2.24 or newer, and a domain behind a reverse proxy with TLS.

## Run

```sh
git clone https://github.com/ly-schneider/mado.git && cd mado/ops
cp ../.env.example .env      # set PUBLIC_URL, MADO_SECRET_KEY and the three passwords
docker compose up -d
```

Generate secrets with `openssl rand -hex 32`. Then open `PUBLIC_URL`; the first visit asks you to create the owner account. The app container runs database migrations on every start.

You only need `docker-compose.yml` and `.env`, so copying those two files to a server works just as well as cloning. The app creates its database roles and sets their passwords from `.env` on every start.

Images are published for `linux/amd64` and `linux/arm64`:

| Image | Tags |
| --- | --- |
| `ghcr.io/ly-schneider/mado` | `latest`, release versions like `0.1.0`, `main` |
| `ghcr.io/ly-schneider/mado-backup` | same |

Pin a version with `MADO_VERSION` in `.env`. To update: `docker compose pull && docker compose up -d`.

To build from source instead of pulling:

```sh
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

## Reverse proxy

The app listens on `127.0.0.1:4100` (change with `MADO_BIND`). Point Caddy, nginx, Traefik or a Cloudflare Tunnel at it and set `PUBLIC_URL` to the public origin; links, OAuth metadata and the MCP URL are built from it. Keep long responses open for `/mcp` (streamable HTTP).

If you put a login wall (Cloudflare Access, an auth proxy) in front of the app, let these paths through, because they have their own auth or must be public:

| Path | Why |
| --- | --- |
| `/mcp`, `/oauth/*`, `/.well-known/*` | Agents sign in with OAuth 2.1 |
| `/webhooks/*` | GitHub and GitLab, verified by signature or token |
| `/s/*`, `/rpc/guest/*` | Guest share links |
| `/assets/*`, `/manifest.webmanifest`, `/sw.js`, `/favicon*`, `/icon-*`, `/apple-touch-icon.png` | Static files for share links and the PWA |

The desktop app calls the API directly, so it must be able to reach it without the login wall too.

## Backups

The `backup` container dumps the database with `pg_dump` on a schedule, keeps 14 daily and 8 weekly dumps, and once a month restores the newest one into a scratch database to check it. Everything is configured in `.env`; see the Backups section of `.env.example`.

- **Where:** the `backups` Docker volume, or a host path such as a second disk with `BACKUP_DIR=/mnt/backup/mado`.
- **When:** `BACKUP_SCHEDULE` and `RESTORE_TEST_SCHEDULE` are cron expressions, in `TZ`.
- **Offsite:** set `BACKUP_REMOTE` to any [rclone](https://rclone.org/overview/) remote and configure it with rclone's `RCLONE_CONFIG_<NAME>_*` variables. The remote mirrors the local rotation.

Run them by hand:

```sh
docker compose exec backup backup          # dump now
docker compose exec backup restore-test    # restore the newest dump into a scratch database and compare
docker compose logs backup
```

Restore a dump into the live database:

```sh
docker compose stop api
docker compose exec backup pg_restore -d mado --clean --if-exists --no-owner /backups/daily/mado-<timestamp>.dump
docker compose start api
```

The restore runs as `mado_owner`. The app's own database role can't delete core data, so it couldn't restore over it.
