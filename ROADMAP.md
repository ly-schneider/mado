# Roadmap

mado is a self-hosted wiki, task tracker and lightweight CRM for small teams and their coding agents. It aims to be fast, keyboard-first and safe to hand to agents.

## Principles

- **Agents are first-class users, never disguised.** Every agent connects through its own OAuth grant, acts under its own name and shows up as an agent in revisions and the audit log.
- **Nothing is ever really gone.** Soft delete, revisions on every change, an audit log, and a database role that cannot hard delete. That is what makes it safe to give agents delete rights.
- **Fast and calm.** Keyboard first, everything in the command palette, optimistic updates. A few neutral surfaces and one accent colour.
- **Simple to run.** One container plus Postgres. No telemetry, no required outbound calls.
- **Markdown is the source of truth** for the wiki, so content stays portable.

## Available now

- Workspaces and projects with short keys that prefix task IDs (`GAT-109`)
- Tasks, bugs and epics with status, priority, labels, assignees (people or agents), board and list views, filters
- Wiki with nested pages and folders, `[[links]]` with backlinks, task auto-links, Markdown live preview, export as Markdown or zip
- Full-text search across docs and tasks (German and English)
- Trash, revisions with restore, audit log
- MCP server with OAuth 2.1 (Dynamic Client Registration + PKCE); per-agent grants by project, level (read, write, delete) and resource type, with expiry
- Connected agents settings: edit or revoke grants, view activity, revert an agent session
- Guest share links for pages and folders: view or edit, revocable, optional expiry and PIN
- GitHub and GitLab linking: task keys in commits, branches and PRs link to the task; PRs move it to In review and Done
- Leads CRM with stages, notes, AI analysis and email drafts (sending stays outside mado)
- Built-in AI via OpenRouter with your own key
- macOS desktop app (Tauri 2) with quick capture and `mado://` links, iPhone PWA
- Docker images for amd64 and arm64, one compose file, and a backup sidecar (pg_dump, rclone offsite, monthly restore test)

## Next

- Realtime collaborative editing (Yjs), with Markdown staying canonical
- Signed desktop releases
- Desktop builds for Windows and Linux
- Show backup status in Settings

## Later

- More Git providers and import from other tools
- Public API documentation and webhooks out
- Mobile quick capture improvements

## Not planned

- Sprints, cycles, time tracking, Gantt charts
- An email client or sending email from mado
- Running code or agents inside mado
- Native mobile apps (the PWA covers mobile)

Ideas and requests are welcome as GitHub issues.
