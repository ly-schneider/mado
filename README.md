# mado

窓 *mado*, Japanese for "window". A self-hosted wiki and task tracker for a small team and their coding agents. Agents connect over MCP with their own OAuth grant, are always shown as agents, and can delete things because nothing is ever really gone: soft delete, revisions, an audit log, and a database role that can't hard delete.

One container serves the SPA, the oRPC API, the MCP endpoint and Git webhooks. Postgres is the only other service. The same SPA runs in the browser, as a macOS app (Tauri 2) and as an iPhone PWA.

```
apps/api         NestJS on Bun: oRPC, MCP, OAuth, webhooks, pg-boss jobs
apps/web         React 19 + Vite SPA (web, desktop, PWA)
apps/desktop     Tauri 2 shell: native menu, ⌥Space quick capture, mado:// links
packages/contract  oRPC contract, zod schemas, domain types
packages/db      Drizzle schema, migrations, roles.sql
packages/ui      Tokens and primitives
ops/             Dockerfile, compose, backups, Cloudflare notes
```

## Develop

Needs Bun 1.3 and Docker. Rust only for the desktop app.

```sh
bun install
bun run db:up        # Postgres 17 on :5442
bun run db:migrate
bun run db:seed      # optional sample workspace
bun run dev          # API on :4100 (watch mode), SPA on :5173 proxying /rpc /mcp /oauth /webhooks to it
```

Open http://localhost:5173. The first visit asks you to create the owner account.

Typecheck with `bunx tsc -p apps/api` and `bunx tsc -p apps/web`. Schema changes: edit `packages/db/src/schema.ts`, then `cd packages/db && bunx drizzle-kit generate --name <name> && bun src/migrate.ts`.

### Desktop app

```sh
cd apps/desktop
bun run desktop:dev     # starts Vite and opens the app against it
bun run desktop:build   # mado.app and a .dmg in src-tauri/target/release/bundle
```

On first start it asks for the server address (stored locally, change it under mado › Change server…). Quick capture is ⌥Space from any app. `mado://GAT-109` opens a task.

## Deploy

Docker Compose on a single VM. The reference setup exposes no ports and is reachable only through a Cloudflare Tunnel; any reverse proxy in front of `127.0.0.1:4100` works.

```sh
cp .env.example ops/.env          # fill in PUBLIC_URL, MADO_SECRET_KEY and the three passwords
docker compose -f ops/docker-compose.yml --env-file ops/.env up -d --build
```

The API container runs migrations as the owner role, then serves everything on `127.0.0.1:4100` as `mado_app`. Point `cloudflared` there and set up Access as described in [ops/cloudflare.md](ops/cloudflare.md).

Images for `linux/amd64` and `linux/arm64` are published to `ghcr.io/ly-schneider/mado` (`main`, and `x.y.z` per release) if you'd rather pull than build.

Backups, from cron on the host:

```sh
15 2 * * *  BACKUP_DIR=/mnt/backup/mado RCLONE_REMOTE=r2:mado-backups /opt/mado/ops/backup.sh
0 4 1 * *   BACKUP_DIR=/mnt/backup/mado /opt/mado/ops/restore-test.sh
```

`backup.sh` keeps 14 daily and 8 weekly `pg_dump` files, mirrors them offsite with rclone, and records the time shown in Settings. `restore-test.sh` restores the newest dump into a scratch database and compares row counts.

### Git

In project settings, add a repo to get a webhook URL and secret. GitHub: content type `application/json`, events *Pushes*, *Pull requests*, *Branch or tag creation*. GitLab: *Push events* and *Merge request events*, secret token as given. Keys like `GAT-109` in commit messages, PR titles and branch names (`gat-109-rrule`) link to the task. An opened PR moves it to In review, a merged one to Done.

## Connect an agent

```sh
claude mcp add --transport http mado https://mado.example.ch/mcp
```

Claude Code opens the consent screen in your browser. You choose the projects, the level (read, write, delete) and the resource types. Every grant shows up under Connected agents, where you can narrow or revoke it.

## Keyboard

Everything is a command, so ⌘K finds any action. Lists move with j/k. Shortcuts don't fire while you type in a field.

| Keys | Action |
| --- | --- |
| ⌘K, / | Command palette, search |
| C | Create task |
| ⌥Space | Quick capture from any app (desktop) |
| ⌘\ | Toggle sidebar |
| J / K | Move down / up |
| Enter / Esc | Open / close |
| S · P · A · L | Status · priority · assignee · labels |
| E | Edit description |
| M | Comment |
| ⌘⇧, | Copy link |
| ⌘⇧. | Copy git branch name |
| V B / V L | Board / list |
| F | Add filter |
| G I · G M · G B · G W | Go to inbox · my tasks · board · wiki |
| G C · G T · G A · G S | Go to leads · trash · agents · settings |
| 1 · 2 · 3 | My tasks: assigned · created · agents |

## Contributing

Issues and pull requests are welcome. See [ROADMAP.md](ROADMAP.md) for what's planned and read [CONTRIBUTING.md](CONTRIBUTING.md) first; security reports go through [SECURITY.md](SECURITY.md).

## License

mado is source-available under the [Business Source License 1.1](LICENSE), not an OSI open source license.

- **Free** for individuals, non-profits, schools, and organizations with fewer than 50 people and less than USD 5M annual revenue, including self-hosting it for your own team in production.
- **Not allowed** without a commercial license: offering mado to others as a hosted or managed service, or embedding it in a product you sell.
- **Larger organizations** need a commercial license for production use. Contact levyn.schneider@leys.ch.
- Each version converts to the GNU AGPL v3.0 or later four years after it is published.

Reading, modifying and running mado for development, testing and evaluation is always allowed.
