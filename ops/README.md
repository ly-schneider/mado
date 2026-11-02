# Self-hosting

mado runs as three containers: the app (API, web app, MCP and webhooks in one image), Postgres, and a small backup sidecar. You need Docker with Compose v2.24 or newer, and a domain behind a reverse proxy with TLS.

## Run

```sh
git clone https://github.com/ly-schneider/mado.git && cd mado/ops
cp ../.env.example .env      # set PUBLIC_URL, MADO_SECRET_KEY and the four passwords
docker compose up -d
```

Generate secrets with `openssl rand -hex 32`. The app container runs database migrations on every start.

Until the owner account exists, setup needs a one-time token, so nobody who finds the URL before you can claim the instance. The app prints a setup link with the token on start:

```sh
docker compose logs api | grep Setup
# Setup: https://mado.example.com/setup?token=…
```

Open it and create the owner account; the token stops working once setup is done. A restart before that prints a new one. For automated installs, set `MADO_SETUP_TOKEN` in `.env` instead and pass it to `/setup?token=…`.

You only need `docker-compose.yml` and `.env`, so copying those two files to a server works just as well as cloning. The app creates its database roles and sets their passwords from `.env` on every start.

### Database roles and containers

| Role | Used by | Can |
| --- | --- | --- |
| `postgres` (`POSTGRES_PASSWORD`) | the postgres and backup containers only | everything: it's the superuser |
| `mado_owner` (`MADO_OWNER_PASSWORD`) | migrations on app start | owns the `mado` database and creates the two roles below, but is not a superuser and can't create databases |
| `mado_app` (`MADO_APP_PASSWORD`) | the app | read and write, no hard deletes of core data |
| `mado_purge` (`MADO_PURGE_PASSWORD`) | the nightly trash purge | delete |

The app container never gets the superuser password, so code running in it can't run commands on the database host (`COPY … PROGRAM`). It runs with a read-only root filesystem, all Linux capabilities dropped, `no-new-privileges` and a 768 MB memory limit. Postgres and the backup sidecar drop everything but the few capabilities their entrypoints need.

Outside Docker, set `HOST=127.0.0.1` so the app only listens on loopback behind your proxy.

### Upgrading from 0.1

Older installs created `mado_owner` as the Postgres superuser. Add `MADO_OWNER_PASSWORD` to `.env`, then `docker compose pull && docker compose up -d` as usual. On start, the backup container renames the old superuser to `postgres` (its password stays `POSTGRES_PASSWORD`), creates a new `mado_owner` without superuser rights, and hands it the database. The app waits for that step. You can check with `docker compose logs backup | grep upgrade-roles`.

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

### Client IPs

mado records the client IP on sign-in (shown under Settings › Account › Sessions) and rate-limits by it, so it has to see the real one. It reads `X-Forwarded-For` only from peers in `TRUST_PROXY`, and the default `loopback, uniquelocal` covers a proxy on the same host or Docker network. Set it to the proxy's address or CIDR (`TRUST_PROXY=172.18.0.0/16`) or a hop count (`TRUST_PROXY=1`) if yours runs elsewhere.

If the proxy passes the client IP in its own header, set `CLIENT_IP_HEADER`. mado reads that header only from a trusted proxy, and ignores it from anyone else.

| Proxy | Settings |
| --- | --- |
| Caddy (`reverse_proxy 127.0.0.1:4100`) | none, Caddy sets `X-Forwarded-For` |
| nginx | `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` |
| cloudflared on the same host | `CLIENT_IP_HEADER=CF-Connecting-IP` |
| Caddy or nginx behind a Cloudflare Tunnel | `CLIENT_IP_HEADER=CF-Connecting-IP` (the proxy forwards the header unchanged) |

Docker publishes ports through its own proxy, so every connection to `MADO_BIND` seems to come from the Docker network and is trusted. Keep `MADO_BIND` on loopback or a private interface that only your proxy can reach, or anyone who reaches the port directly can set their own client IP.

If you put a login wall (Cloudflare Access, an auth proxy) in front of the app, let these paths through, because they have their own auth or must be public:

| Path | Why |
| --- | --- |
| `/mcp`, `/oauth/*`, `/.well-known/*` | Agents sign in with OAuth 2.1 |
| `/webhooks/*` | GitHub and GitLab, verified by signature or token |
| `/s/*`, `/rpc/guest/*` | Guest share links |
| `/assets/*`, `/theme.js`, `/manifest.webmanifest`, `/sw.js`, `/favicon*`, `/icon-*`, `/apple-touch-icon.png` | Static files for share links and the PWA |

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

Replace the live database with a dump (the newest one if you leave out the file):

```sh
docker compose stop api
docker compose exec backup restore /backups/daily/mado-<timestamp>.dump
docker compose start api
```

The restore runs as the `postgres` superuser, the only role that may drop and create databases, and recreates `mado` owned by `mado_owner`. Dumps leave out pg-boss's job queue; the app rebuilds it on start.
