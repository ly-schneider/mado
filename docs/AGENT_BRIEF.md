# Mado build brief (shared by all parallel work streams)

Read `ROADMAP.md` first. Figma file key `Q0njSllqKRnt7nnpPvMO0X`; screenshots of every designed screen are in `design/figma/*.png` (Read them as images). Use the Figma MCP (`get_design_context` with skillNames "resource:figma-design-to-code", `get_screenshot`) for exact specs of the screen you build. Load the figma-design-to-code guidance first (ReadMcpResourceTool server "figma", uri "skill://figma/figma-design-to-code/SKILL.md").

## Designed screens (Figma node IDs)
Web: 19:2 Board · 22:595 Task detail · 24:820 Wiki page · 38:3305 Wiki (light) · 26:1005 List + Command palette · 27:1548 Agent consent (OAuth)
Desktop (Tauri): 28:2 My tasks (list + detail split, status bar) · 29:546 Wiki revision history · 30:721 Quick capture (⌥Space) · 31:751 Connected agents · 32:977 Leads (CRM)
iOS PWA (393×852): 34:2 My tasks · 35:186 Quick capture sheet · 34:213 Task detail · 37:277 Wiki reading (light) · 35:351 Search
Foundations 9:2, Components 9:3, Logo 9:7.

Screens NOT in Figma must be designed by you on the same foundation, using the Mobbin MCP (`mcp__mobbin__search_screens`, platform web or ios, output_destination "code") for references (Linear, Notion, Attio, Plane are good sources). Keep them consistent with the Figma screens: same sidebar, 52px header with breadcrumb, 32px rows, raised cards with edge borders, greyscale with one accent.

## Hard design rules (from the user, non-negotiable)
- Greyscale surfaces and text, ONE accent (tokens `accent`, `state-selected`) only for links, focus and selection. Labels are greyscale chips.
- Depth through tone (page/panel/raised/overlay/edge), no shadows except on floating overlays.
- No hover transitions. Motion only on press and open/close, 120–300 ms ease-out (`animate-pop`, `animate-fade`, `animate-sheet`).
- NO MONOSPACE anywhere: IDs, kbd and code all use the sans font.
- Control height 32px desktop, 36px touch (hit area 44pt), 4px grid. iOS inputs use 17px text (`text-touch`).
- Keyboard first: every action registered with `useCommands` (apps/web/src/lib/shortcuts.ts) so it shows in the ⌘K palette. j/k to move. Only 2–3 visible buttons per screen.
- Dark and light are pure token swaps. Only use semantic Tailwind tokens (`bg-page bg-panel bg-raised bg-overlay border-edge text-ink text-ink-muted text-ink-subtle text-ink-faint text-accent bg-state-hover bg-state-active bg-state-selected text-on-ink bg-ink`, text sizes `text-display text-title text-base text-prose text-sm text-label text-kbd text-touch`, `h-control h-touch`). Never raw colours.
- Agents are ink squares with the bot glyph (`<Avatar type="agent">`), never disguised as people. Every agent action is shown as the agent.
- Comments: only where something is non-obvious (the why). No narration comments.

## Stack and layout
- Monorepo (Bun workspaces): `packages/contract` (oRPC contract + zod + domain constants + output types — the API surface, READ `src/contract.ts` and `src/types.ts`), `packages/db` (Drizzle schema `src/schema.ts`; roles.sql makes the app role unable to DELETE core tables → soft delete via deleted_at), `packages/ui` (tokens.css + primitives: Button, IconButton, Kbd, Badge, LabelChip, Avatar, Checkbox, Switch, Segmented, Input, Textarea, Field, Select, Menu, Popover, Dialog, Tooltip, Card, CardRow, EmptyState, Spinner, StatusIcon, PriorityIcon, AgentGlyph, MadoMark, MadoWordmark, cn).
- `apps/api`: NestJS 12 on Bun + oRPC. `src/rpc/<domain>.ts` implement contract procedures by calling `src/services/<domain>.service.ts`. Each service method takes an `Actor` (src/lib/actor.ts: user | agent | guest | system). ALL authorization goes through `AccessService` (requireProject(actor, projectId, level, resource), requireDoc, requireWorkspace, requireOwner, requireUser, readableProjectIds). ALL writes go in a transaction and call `AuditService.record(tx, actor, …)`; docs/tasks/leads also `AuditService.revision(...)`; `AuditService.notify` for inbox; `RefsService.rebuild` after saving doc/task text. Throw AppError helpers from src/lib/errors.ts. Deletes are soft (`deletedAt/deletedByType/deletedById`). Never hard delete except the purge path via `DbService.purgeDb`.
- `RouterService.clientFor(actor)` gives an in-process typed oRPC client — MCP uses it so agents hit the same authz as the UI.
- Services and controllers are already registered in `app.module.ts` / `rpc/router.service.ts`. Add constructor deps freely (Nest DI by type). Do NOT edit app.module.ts, router.service.ts, services.ts, rpc/router.ts, rpc/base.ts unless your brief says so.
- `apps/web`: Vite 8 + React 19 + TanStack Router (code-based, `src/router.tsx` — routes and search params are already defined; don't change paths) + TanStack Query with oRPC utils (`orpc` from src/lib/orpc.ts: `orpc.task.list.queryOptions({ input })`, `.mutationOptions()`, `.key()`, `client.task.create(...)`). Optimistic updates on every write (onMutate setQueryData, rollback onError). Toasts: `toast()` from src/lib/toast.tsx. Global UI store src/lib/ui.ts (openPalette, openCapture, pushRecent). Workspace hooks src/lib/workspace.ts (useWorkspace, useProject, useMe). Page chrome: `PageHeader` + `MobileTitle` in src/features/shell/PageHeader.tsx. Time helpers src/lib/time.ts. Platform: src/lib/platform.ts (isTauri, isMac).
- Shared Markdown components with a FIXED API: `src/features/editor/MarkdownEditor.tsx` and `MarkdownView.tsx` (stubs now; the wiki stream implements them). Import them, don't fork them.
- Responsive: one SPA. < md (768px) is the iPhone PWA layout from the iOS designs (the shell already renders the floating tab bar + capture FAB; leave ~120px bottom padding on scrolling screens). md+ is web/desktop.
- Dev DB: `docker compose -f ops/docker-compose.dev.yml up -d` (port 5442, already running). Migrations: edit schema, then `cd packages/db && bunx drizzle-kit generate --name <name> && bun src/migrate.ts`. Only the backend-core stream may change the schema; others ask in their final report if they need a column.
- API dev: `cd apps/api && bun src/main.ts` (port 4100). Web dev: `cd apps/web && bunx vite` (5173, proxies /rpc /mcp /oauth /.well-known /webhooks /export to 4100). Several streams run at once: if 4100/5173 are taken, use `PORT=41xx` for your own API instance and `API_URL=http://localhost:41xx bunx vite --port 51xx`; kill what you start.
- Typecheck: `bunx tsc -p apps/api` / `bunx tsc -p apps/web`. Other streams edit other files concurrently, so ignore errors outside your files; your files must be clean.
- Do not commit. Do not run `git` write commands. Do not install new deps unless needed; if you do, use `bun add` in the right package and say so in your report.

## Finish
End with a short report: what you built (files), what you verified and how, what is left or deviates from the roadmap/design.
