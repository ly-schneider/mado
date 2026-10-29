# mado

Self-hosted workspace (tasks, wiki, CRM, MCP for agents). Read `ROADMAP.md` for scope and `docs/AGENT_BRIEF.md` for the stack, design rules and where things live.

## Commits

Always use Conventional Commits: `type(scope): summary`.

- Types: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `test`, `perf`, `build`, `ci`, `revert`.
- Scopes follow the workspace layout: `api`, `web`, `desktop`, `db`, `contract`, `ui`, `ops`. Omit the scope for changes that span many.
- One short imperative subject line (≤ 72 chars), no body unless the change can't be understood without it, no trailers.
- `.githooks/commit-msg` rejects anything else; `bun install` points git at it (`core.hooksPath`).

## Checks before committing

- `bunx tsc -p <package>` for every package you touched
- `cd apps/api && bun test`
- `cd apps/web && bunx vite build` when web code changed
