/**
 * Demo data matching the Figma screens: mado tracking its own development. `bun run db:seed` seeds
 * an empty instance; `bun run db:seed -- --reset` truncates every table first. Runs as the owner role.
 */
import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "./schema";

const url = process.env.DATABASE_OWNER_URL ?? "postgres://mado_owner:mado@localhost:5442/mado";
const reset = process.argv.includes("--reset");
const client = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(client, { schema: s, casing: "snake_case" });

// Same derivation as apps/api/src/lib/crypto.ts so the API can decrypt seeded secrets.
const secretKey = createHash("sha256")
  .update(process.env.MADO_SECRET_KEY ?? "dev-only-secret-key-change-me-0123456789")
  .digest();
function encrypt(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

const now = Date.now();
const min = (n: number) => new Date(now - n * 60_000);
const hrs = (n: number) => min(n * 60);
const days = (n: number) => min(n * 1440);

// ── Reset / guard ───────────────────────────────────────────────────────

if (reset) {
  const tables = await client<{ tablename: string }[]>`select tablename from pg_tables where schemaname = 'public'`;
  await client.unsafe(`truncate ${tables.map((t) => `"${t.tablename}"`).join(", ")} restart identity cascade`);
  console.log(`reset: truncated ${tables.length} tables`);
} else {
  const taken = await client`select key from projects where key in ('MAD', 'WEB')`;
  if (taken.length) {
    console.log(`Projects ${taken.map((t) => t.key).join(", ")} already exist. Run with --reset to recreate the demo data.`);
    await client.end();
    process.exit(0);
  }
}

// ── Users ───────────────────────────────────────────────────────────────

async function ensureUser(name: string, email: string) {
  const [existing] = await db.select().from(s.users).where(sql`${s.users.email} = ${email}`);
  if (existing) return existing.id;
  const [u] = await db
    .insert(s.users)
    .values({ name, email, passwordHash: await Bun.password.hash("mado-demo-2026", { algorithm: "argon2id" }), theme: "dark", createdAt: days(30) })
    .returning();
  return u!.id;
}
const alex = await ensureUser("Alex Meyer", "alex@example.com");
const sam = await ensureUser("Sam Keller", "sam@example.com");

type ActorRef = { type: s.ActorType; id: string; name: string; sessionId?: string | null };
const AM: ActorRef = { type: "user", id: alex, name: "Alex Meyer" };
const SK: ActorRef = { type: "user", id: sam, name: "Sam Keller" };

// ── Workspaces, projects, labels ────────────────────────────────────────

async function workspace(name: string, slug: string, members: [string, s.Role][]) {
  const [ws] = await db.insert(s.workspaces).values({ name, slug, createdAt: days(30) }).returning();
  await db.insert(s.memberships).values(members.map(([userId, role]) => ({ workspaceId: ws!.id, userId, role, createdAt: days(30) })));
  return ws!.id;
}
// Sam is in both workspaces because the board design assigns MAD-115 to SK.
const wsMad = await workspace("mado", "mado", [[alex, "owner"], [sam, "member"]]);
const wsWeb = await workspace("Website", "website", [[alex, "owner"], [sam, "member"]]);

async function project(workspaceId: string, name: string, key: string, description: string) {
  const [p] = await db.insert(s.projects).values({ workspaceId, name, key, description, createdAt: days(30) }).returning();
  return p!;
}
const MAD = await project(wsMad, "mado", "MAD", "Self-hosted wiki, tasks and CRM for small teams and their agents.");
const WEB = await project(wsWeb, "Website", "WEB", "Landing page, docs and the license page.");

async function labelSet(projectId: string, list: [string, string][]) {
  const rows = await db
    .insert(s.labels)
    .values(list.map(([name, color]) => ({ projectId, name, color, createdAt: days(30) })))
    .returning();
  return Object.fromEntries(rows.map((r) => [r.name, r.id])) as Record<string, string>;
}
const madLabels = await labelSet(MAD.id, [
  ["Backend", "blue"],
  ["Frontend", "violet"],
  ["Bug", "red"],
  ["Feature", "green"],
  ["Infra", "amber"],
  ["Agents", "teal"],
]);
const webLabels = await labelSet(WEB.id, [
  ["Design", "pink"],
  ["Content", "grey"],
  ["Docs", "blue"],
]);

// ── Agents ──────────────────────────────────────────────────────────────

await db.insert(s.oauthClients).values([
  { clientId: "claude-code", name: "Claude Code", redirectUris: ["http://localhost:33418/callback"], verified: false, createdAt: days(3) },
  { clientId: "claude-app", name: "Claude app", redirectUris: ["https://claude.ai/api/mcp/auth_callback"], verified: true, createdAt: days(18) },
]);

const G_CODE = "g_41c2";
const G_DESKTOP = "g_7d0e";
const G_ASSIST = "g_m4d0";
const G_CI = "g_c1a9";
await db.insert(s.agentGrants).values([
  {
    id: G_CODE,
    userId: alex,
    kind: "oauth",
    clientId: "claude-code",
    clientName: "Claude Code",
    agentName: "Claude Code · MacBook Pro",
    projectScope: "listed",
    allLevel: "read",
    resourceTypes: ["docs", "tasks", "comments", "crm"],
    expiresAt: days(-27),
    lastUsedAt: min(2),
    lastIp: "192.168.1.24",
    createdAt: days(3),
  },
  {
    id: G_DESKTOP,
    userId: alex,
    kind: "oauth",
    clientId: "claude-app",
    clientName: "Claude app",
    agentName: "Claude Desktop",
    projectScope: "all",
    allLevel: "read",
    resourceTypes: ["docs", "tasks", "comments", "crm"],
    expiresAt: days(-12),
    lastUsedAt: hrs(26),
    lastIp: "192.168.1.31",
    createdAt: days(18),
  },
  {
    id: G_ASSIST,
    userId: alex,
    kind: "builtin",
    clientName: "Built-in · OpenRouter",
    agentName: "mado assistant",
    projectScope: "listed",
    allLevel: "read",
    resourceTypes: ["docs", "tasks", "comments", "crm"],
    expiresAt: null,
    createdAt: days(20),
  },
  {
    id: G_CI,
    userId: alex,
    kind: "pat",
    clientName: "Claude Code",
    agentName: "Claude Code · CI",
    projectScope: "listed",
    allLevel: "read",
    resourceTypes: ["tasks", "comments"],
    expiresAt: days(17),
    lastUsedAt: days(18),
    createdAt: days(47),
  },
]);
await db.insert(s.agentGrantProjects).values([
  { grantId: G_CODE, projectId: MAD.id, level: "write" },
  { grantId: G_CODE, projectId: WEB.id, level: "read" },
  { grantId: G_ASSIST, projectId: MAD.id, level: "write" },
  { grantId: G_CI, projectId: MAD.id, level: "read" },
]);
await db.insert(s.agentSessions).values([
  { id: "7f3a", grantId: G_CODE, writes: 9, lastTaskKey: "MAD-109", startedAt: min(36), lastActiveAt: min(2) },
  { id: "2c19", grantId: G_CODE, writes: 3, lastTaskKey: "MAD-102", startedAt: hrs(45), lastActiveAt: hrs(44) },
]);
const CC = (sessionId: string | null): ActorRef => ({ type: "agent", id: G_CODE, name: "Claude Code · MacBook Pro", sessionId });

// ── History helpers ─────────────────────────────────────────────────────

function diffStats(before: string, after: string) {
  const counts = new Map<string, number>();
  for (const line of before.split("\n")) counts.set(line, (counts.get(line) ?? 0) + 1);
  let added = 0;
  for (const line of after.split("\n")) {
    const n = counts.get(line) ?? 0;
    if (n > 0) counts.set(line, n - 1);
    else added++;
  }
  let removed = 0;
  for (const n of counts.values()) removed += n;
  return { added, removed };
}

const auditRows: (typeof s.auditLog.$inferInsert)[] = [];
function audit(
  actor: ActorRef,
  at: Date,
  e: { workspaceId: string; projectId?: string | null; action: string; entityType: string; entityId: string; entityLabel: string; before?: unknown; after?: unknown },
) {
  auditRows.push({
    ...e,
    projectId: e.projectId ?? null,
    before: (e.before ?? null) as object | null,
    after: (e.after ?? null) as object | null,
    actorType: actor.type,
    actorId: actor.id,
    actorName: actor.name,
    sessionId: actor.sessionId ?? null,
    createdAt: at,
  });
}

const revisionRows: (typeof s.revisions.$inferInsert)[] = [];
const revisionCounter = new Map<string, number>();
function revision(actor: ActorRef, at: Date, e: { entityType: "doc" | "task" | "lead"; entityId: string; snapshot: unknown; added?: number; removed?: number; summary?: string | null }) {
  const number = (revisionCounter.get(e.entityId) ?? 0) + 1;
  revisionCounter.set(e.entityId, number);
  revisionRows.push({
    entityType: e.entityType,
    entityId: e.entityId,
    number,
    snapshot: e.snapshot as object,
    added: e.added ?? 0,
    removed: e.removed ?? 0,
    summary: e.summary ?? null,
    actorType: actor.type,
    actorId: actor.id,
    actorName: actor.name,
    sessionId: actor.sessionId ?? null,
    createdAt: at,
  });
  return number;
}

// ── Wiki ────────────────────────────────────────────────────────────────

const SAFETY = `Agents get delete rights because nothing they delete is really gone. Each layer below holds on its own, so a bug in one of them doesn't lose data.

## Soft delete

Every entity has **deleted_at** and **deleted_by**. Deleted items stay in the trash for 30 days together with their sub-pages, then the purge job removes them. Trash for docs is MAD-104.

## Revisions

Append-only. A full Markdown snapshot per doc save and a JSON snapshot per task change. Any revision can be restored.

## Database roles

\`\`\`sql
-- The app connects as mado_app and can never hard delete core data.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM mado_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO mado_app;
-- Only the purge job connects as mado_purge.
GRANT SELECT, DELETE ON ALL TABLES IN SCHEMA public TO mado_purge;
\`\`\`

> **Agents:** read this page before you touch deletes or migrations. Open questions go into a comment, not into the code.

Backups are the last layer: a sidecar container dumps the database every night and mirrors it offsite, see [[Deploy]] and MAD-109. Restore steps are in [[Postgres restore]].`;

const SAFETY_BEFORE_AGENT = SAFETY.replace(/\n\nBackups are the last layer[\s\S]*$/, "\n\nBackups run from cron on the host. Moving them into a container is MAD-109.");

const ADR_004 = `**Status:** accepted · October 2026

## Context

Backups ran as shell scripts from cron on the host. Every self-hoster had to copy them, install rclone and set up cron. [[Deploy]] describes the setup.

## Decision

Ship backups as a second container next to the app: Postgres client tools plus rclone, configured only through environment variables. It dumps on a cron schedule, rotates locally and mirrors to any rclone remote. A monthly restore test runs in the same container.

## Consequences

- One \`docker compose up\` gives a working backup; offsite takes three more variables.
- pg_dump must match the server's major version, so the sidecar image follows Postgres upgrades.
- The last run is written to settings, where the app can show it (MAD-119).

## Alternatives

- **A pg-boss job in the app:** the app image would need Postgres client tools and storage credentials.
- **Host cron scripts:** what we had. Easy to forget on a new server.`;

const AGENTS = `Agents never use cookies. They connect through OAuth 2.1 with PKCE and Dynamic Client Registration, and get one grant per client.

## Grants

- Projects, a level per project (read, write, delete) and resource types.
- The token carries the grant ID, not the privileges. Every MCP call re-reads the grant, so edits apply immediately.
- A missing privilege returns **insufficient_scope** with the exact privilege needed. No self-escalation.

## Sessions

Writes from one agent run share a session ID, so a whole run can be reverted at once (MAD-111).

## People

People log in with a password (argon2id) and get a plain cookie session backed by a \`sessions\` table. Invites by link are MAD-105.`;

const DEPLOY = `mado runs as Docker Compose: the app, Postgres and a backup sidecar. No open ports, a reverse proxy in front.

## Services

- **api** — serves the web app, oRPC, MCP and webhooks
- **postgres** — the only database
- **backup** — pg_dump on a schedule, rclone for the offsite copy

## Update

\`\`\`sh
ssh app-host
cd /srv/mado && docker compose pull
docker compose up -d
\`\`\`

Migrations run when the app container starts. Jobs (trash purge, session cleanup) run in pg-boss inside it.

## Backups

Nightly dump, 14 daily and 8 weekly kept, mirrored to an S3 bucket. Decided in [[ADR-004 Backups as a sidecar]]. Restore steps: [[Postgres restore]]. The first setup was MAD-101.`;

const RESTORE_OLD = `The backup sidecar dumps at 02:15 and mirrors to the offsite bucket. A restore test runs on the 1st of every month.

## Steps

\`\`\`sh
docker compose stop api
docker compose exec backup pg_restore -d mado --clean --if-exists \\
  /backups/daily/mado-2026-11-02T0215Z.dump
docker compose start api
\`\`\`

After the restore, open [[Deploy]] and check the health endpoint. Log the test in MAD-101.`;

const RESTORE = `The backup sidecar dumps at 02:15 and mirrors to the offsite bucket. A restore test runs on the 1st of every month.

## Steps

\`\`\`sh
docker compose stop api
docker compose exec backup pg_restore -d mado --clean --if-exists --no-owner \\
  /backups/daily/mado-2026-11-02T0215Z.dump
docker compose start api
\`\`\`

The sidecar restores as **mado_owner**. The app role has no **DELETE** on core tables, so it cannot restore over them — that is on purpose.

After the restore, open [[Deploy]] and check the health endpoint. Log the test in MAD-101.`;

const OLD_BACKUP_NOTES = `Scratch notes before ADR-004. Superseded by [[ADR-004 Backups as a sidecar]].

- restic or rclone?
- dump every hour?`;

const SITE_PLAN = `One page for the product, one for the license, docs from the repo.

## Pages

- **Home** — what mado is, one screenshot, self-hosting in three commands
- **License** — who can use it for free and how to buy a commercial license (WEB-4)
- **Docs** — rendered from the Markdown in the repo (WEB-5)

Launch steps are in [[Launch checklist]].`;

const LAUNCH = `- [x] Repository public, license in place
- [ ] Images on GHCR (MAD-112)
- [ ] Hero screenshot (WEB-3)
- [ ] First release notes`;

type DocSeed = {
  key: string;
  workspaceId: string;
  projectId: string | null;
  parent?: string;
  title: string;
  content: string;
  /** Oldest first. The last entry is the current revision. */
  history: { actor: ActorRef; at: Date; content?: string; summary?: string }[];
  deleted?: { actor: ActorRef; at: Date };
};

/** Earlier revisions grow the page section by section until it reaches its final content. */
function growth(content: string, n: number, i: number) {
  const blocks = content.split("\n\n");
  const take = Math.max(1, Math.ceil((blocks.length * (i + 1)) / n));
  return blocks.slice(0, take).join("\n\n");
}

function longHistory(n: number, start: Date, end: Date, actors: ActorRef[]) {
  const span = end.getTime() - start.getTime();
  return Array.from({ length: n }, (_, i) => ({ actor: actors[i % actors.length]!, at: new Date(start.getTime() + (span * i) / Math.max(1, n - 1)) }));
}

const safetyHistory = longHistory(22, days(14), min(40), [AM, AM, AM, CC(null)]);
const restoreHistory: DocSeed["history"] = [
  { actor: CC("2c19"), at: hrs(44), content: growth(RESTORE_OLD, 1, 0), summary: "created the page" },
  ...longHistory(15, hrs(43), hrs(30), [AM]).map((h, i) => ({ ...h, content: growth(RESTORE_OLD, 16, i + 1) })),
  { actor: AM, at: hrs(29), content: RESTORE_OLD, summary: "Revision 17" },
  {
    actor: { type: "guest", id: "", name: "Guest via “Ops review”" },
    at: hrs(20),
    content: `${RESTORE_OLD}\n\nAsk Alex before restoring on a weekday.`,
  },
  { actor: AM, at: hrs(6), content: `${RESTORE_OLD}\n\nAsk Alex before restoring on a weekday.` },
  { actor: AM, at: hrs(5), content: RESTORE_OLD },
  { actor: AM, at: hrs(4), content: RESTORE_OLD.replace("02:15", "02:15 (server time)") },
  { actor: AM, at: hrs(3), content: RESTORE.replace("The sidecar restores as **mado_owner**.", "The sidecar restores as mado_owner."), summary: "Edited steps" },
  { actor: CC("7f3a"), at: min(8), content: RESTORE },
];

const docSeeds: DocSeed[] = [
  {
    key: "arch",
    workspaceId: wsMad,
    projectId: MAD.id,
    title: "Architecture",
    content: "How mado is built. Start with [[Data safety]], then [[Agent access]] and [[Deploy]].",
    history: [{ actor: AM, at: days(20) }],
  },
  {
    key: "safety",
    workspaceId: wsMad,
    projectId: MAD.id,
    parent: "arch",
    title: "Data safety",
    content: SAFETY,
    history: [
      ...safetyHistory.map((h, i) => (i === safetyHistory.length - 1 ? { ...h, content: SAFETY_BEFORE_AGENT } : h)),
      { actor: CC("7f3a"), at: min(12) },
    ],
  },
  { key: "agents", workspaceId: wsMad, projectId: MAD.id, parent: "arch", title: "Agent access", content: AGENTS, history: longHistory(6, days(19), days(4), [AM]) },
  { key: "deploy", workspaceId: wsMad, projectId: MAD.id, parent: "arch", title: "Deploy", content: DEPLOY, history: longHistory(9, days(18), days(1), [AM, AM, CC(null)]) },
  {
    key: "decisions",
    workspaceId: wsMad,
    projectId: MAD.id,
    title: "Decisions",
    content: "Architecture decision records. One page per decision, numbered, never rewritten — a new ADR supersedes an old one.",
    history: [{ actor: AM, at: days(20) }],
  },
  { key: "adr4", workspaceId: wsMad, projectId: MAD.id, parent: "decisions", title: "ADR-004 Backups as a sidecar", content: ADR_004, history: longHistory(5, days(9), days(2), [AM, CC(null)]) },
  {
    key: "oldnotes",
    workspaceId: wsMad,
    projectId: MAD.id,
    parent: "decisions",
    title: "Old backup notes",
    content: OLD_BACKUP_NOTES,
    history: [{ actor: AM, at: days(12) }],
    deleted: { actor: CC("7f3a"), at: min(10) },
  },
  {
    key: "runbooks",
    workspaceId: wsMad,
    projectId: MAD.id,
    title: "Runbooks",
    content: "Step by step for when something breaks. Keep them short and test them.",
    history: [{ actor: AM, at: days(20) }],
  },
  { key: "restore", workspaceId: wsMad, projectId: MAD.id, parent: "runbooks", title: "Postgres restore", content: RESTORE, history: restoreHistory },

  { key: "w-plan", workspaceId: wsWeb, projectId: WEB.id, title: "Site plan", content: SITE_PLAN, history: longHistory(4, days(12), days(3), [AM, SK]) },
  { key: "w-launch", workspaceId: wsWeb, projectId: WEB.id, title: "Launch checklist", content: LAUNCH, history: longHistory(3, days(6), days(1), [SK, AM]) },
];

const docIds = new Map<string, string>();
for (const d of docSeeds) docIds.set(d.key, randomUUID());

// Guest edits come from a share link, so the link has to exist before its revision.
const shareToken = "demo-ops-review-share-token-0123456789abcdef";
const SHARE_ID = randomUUID();
for (const h of restoreHistory) if (h.actor.type === "guest") h.actor.id = SHARE_ID;

for (const d of docSeeds) {
  const id = docIds.get(d.key)!;
  let prev = "";
  const n = d.history.length;
  d.history.forEach((h, i) => {
    const content = h.content ?? (i === n - 1 ? d.content : growth(d.content, n, i));
    const stats = diffStats(prev, content);
    revision(h.actor, h.at, { entityType: "doc", entityId: id, snapshot: { title: d.title, content }, ...stats, summary: h.summary ?? (i === 0 ? "created the page" : null) });
    if (i === 0) {
      audit(h.actor, h.at, { workspaceId: d.workspaceId, projectId: d.projectId, action: "doc.create", entityType: "doc", entityId: id, entityLabel: d.title, after: { title: d.title } });
    } else if ((h.actor.type !== "user" || i === n - 1) && stats.added + stats.removed > 0) {
      audit(h.actor, h.at, { workspaceId: d.workspaceId, projectId: d.projectId, action: "doc.save", entityType: "doc", entityId: id, entityLabel: d.title, after: stats });
    }
    prev = content;
  });
  const last = d.history[n - 1]!;
  await db.insert(s.docs).values({
    id,
    workspaceId: d.workspaceId,
    projectId: d.projectId,
    parentId: d.parent ? docIds.get(d.parent)! : null,
    title: d.title,
    content: d.content,
    sortOrder: docSeeds.indexOf(d),
    revisionNumber: n,
    updatedByType: last.actor.type,
    updatedById: last.actor.id,
    createdAt: d.history[0]!.at,
    updatedAt: last.at,
    ...(d.deleted ? { deletedAt: d.deleted.at, deletedByType: d.deleted.actor.type, deletedById: d.deleted.actor.id } : {}),
  });
  if (d.deleted) {
    audit(d.deleted.actor, d.deleted.at, { workspaceId: d.workspaceId, projectId: d.projectId, action: "doc.delete", entityType: "doc", entityId: id, entityLabel: d.title });
  }
}

await db.insert(s.shareLinks).values({
  id: SHARE_ID,
  workspaceId: wsMad,
  docId: docIds.get("runbooks")!,
  name: "Ops review",
  type: "edit",
  tokenHash: sha256(shareToken),
  tokenEnc: encrypt(shareToken),
  pinHash: await Bun.password.hash("4821", { algorithm: "argon2id" }),
  expiresAt: days(-7),
  lastUsedAt: hrs(20),
  createdById: alex,
  createdAt: days(2),
});
await db.insert(s.favorites).values([
  { userId: alex, docId: docIds.get("safety")! },
  { userId: alex, docId: docIds.get("restore")! },
]);

// ── Tasks ───────────────────────────────────────────────────────────────

const MAD_109 = `Backups move from host cron scripts into a sidecar container: Postgres client tools plus rclone, configured through environment variables. Background in [[Deploy]] and [[ADR-004 Backups as a sidecar]]. Showing the last run depends on MAD-119.

## Acceptance criteria

- [x] Image with pg_dump, pg_restore and rclone
- [x] Daily and weekly rotation, offsite mirror
- [ ] Monthly restore test inside the container
- [ ] Last backup time visible in Settings — blocked by MAD-119`;

const MAD_119 = `The API returns **lastBackupAt** from the settings row the backup writes, but Settings never shows it, so nobody notices when backups stop. Blocks MAD-109.

Background: [[Deploy]].`;

type TaskSeed = {
  n: number;
  title: string;
  type?: s.TaskType;
  status: s.TaskStatus;
  priority: s.Priority;
  assignee?: ActorRef | null;
  labels: string[];
  epic?: number;
  due?: string;
  description?: string;
  createdBy?: ActorRef;
  createdAt: Date;
  branch?: string;
  pr?: { number: number; state: "open" | "merged" | "closed"; title?: string };
  deleted?: { actor: ActorRef; at: Date };
};

const madTasks: TaskSeed[] = [
  { n: 99, title: "Postgres full-text search, DE + EN", status: "done", priority: "high", assignee: AM, labels: ["Backend"], due: "2026-10-30", createdAt: days(16), pr: { number: 29, state: "merged" }, description: "Search across tasks and docs with the simple, English and German configs. Must stay under 200 ms." },
  { n: 100, title: "Self-hosting v1", type: "epic", status: "in_progress", priority: "high", assignee: AM, labels: ["Infra"], createdAt: days(15), description: "Prebuilt images, one compose file, backups in a container and a short guide. Setup lives in [[Deploy]]." },
  { n: 101, title: "Docker Compose deploy", status: "done", priority: "none", assignee: AM, labels: ["Infra"], due: "2026-10-30", createdAt: days(15), pr: { number: 31, state: "merged" }, description: "App and Postgres in one compose file, behind a reverse proxy. See [[Deploy]]." },
  { n: 102, title: "Project keys and task IDs", status: "done", priority: "medium", assignee: CC(null), labels: ["Backend"], due: "2026-10-31", createdAt: hrs(44), createdBy: CC("2c19"), pr: { number: 33, state: "merged" }, description: "Keys are 2 to 5 letters, unique per instance. Task numbers are a per-project sequence and never reused." },
  { n: 103, title: "Markdown export for a whole project", status: "done", priority: "low", assignee: AM, labels: ["Backend"], createdAt: days(14), pr: { number: 34, state: "merged" } },
  { n: 104, title: "Soft delete and trash for docs", status: "in_review", priority: "high", assignee: CC(null), labels: ["Backend"], due: "2026-11-03", createdAt: days(13), pr: { number: 42, state: "open" }, description: "Deleted pages go to the trash for 30 days with their sub-pages. Only the owner can purge. See [[Data safety]]." },
  { n: 105, title: "Invite teammates by link", status: "backlog", priority: "medium", labels: ["Backend", "Feature"], createdAt: days(13) },
  { n: 106, title: "Calendar view for due dates", status: "backlog", priority: "low", labels: ["Feature", "Frontend"], createdAt: days(12), deleted: { actor: AM, at: days(3) } },
  { n: 107, title: "Command palette: rank recent items first", status: "in_review", priority: "medium", assignee: AM, labels: ["Frontend"], due: "2026-11-05", createdAt: days(11), pr: { number: 45, state: "open" } },
  { n: 108, title: "Notion import from Markdown export", status: "canceled", priority: "none", labels: ["Feature"], createdAt: days(11), description: "Dropped. Markdown export goes the other way, that is enough." },
  { n: 109, title: "Rclone backup sidecar", status: "in_progress", priority: "high", assignee: CC(null), labels: ["Backend"], epic: 100, due: "2026-11-06", createdAt: hrs(1), description: MAD_109, branch: "mad-109-rclone-backup-sidecar" },
  { n: 110, title: "Backlinks panel for wiki pages", status: "in_progress", priority: "medium", assignee: AM, labels: ["Frontend"], due: "2026-11-07", createdAt: days(9) },
  { n: 111, title: "Revert one agent session", status: "backlog", priority: "medium", labels: ["Agents"], createdAt: days(9), description: "One click undoes every write of an agent run. See [[Agent access]]." },
  { n: 112, title: "Publish multi-arch images to GHCR", status: "todo", priority: "high", assignee: CC(null), labels: ["Infra"], epic: 100, due: "2026-11-08", createdAt: days(8) },
  { n: 113, title: "Deep links mado://MAD-109 in the desktop app", status: "backlog", priority: "low", labels: ["Frontend"], createdAt: days(8) },
  { n: 114, title: "Realtime collaboration with Yjs", status: "backlog", priority: "none", labels: ["Frontend", "Backend"], createdAt: days(7) },
  { n: 115, title: "Self-hosting guide", status: "todo", priority: "low", assignee: SK, labels: ["Feature"], epic: 100, due: "2026-11-12", createdAt: days(7) },
  { n: 116, title: "Desktop builds for Windows and Linux", status: "backlog", priority: "medium", labels: ["Feature"], createdAt: days(6) },
  { n: 117, title: "Push notifications on iPhone", status: "canceled", priority: "low", labels: ["Feature"], createdAt: days(6), description: "Web push on iOS is too limited for now." },
  { n: 118, title: "Image uploads in wiki pages", status: "backlog", priority: "low", labels: ["Frontend"], createdAt: days(5) },
  { n: 119, title: "Last backup time never shows in Settings", type: "bug", status: "todo", priority: "urgent", assignee: AM, labels: ["Bug"], epic: 100, due: "2026-11-04", createdAt: days(2), description: MAD_119, branch: "mad-119-last-backup-time" },
  { n: 120, title: "Sort order for the wiki sidebar", status: "backlog", priority: "low", labels: ["Frontend"], createdAt: days(2) },
  { n: 121, title: "Export the audit log as CSV", status: "todo", priority: "low", assignee: AM, labels: ["Feature"], createdAt: days(1) },
];

const webTasks: TaskSeed[] = [
  { n: 1, title: "Domain and DNS", status: "done", priority: "medium", assignee: AM, labels: ["Content"], createdAt: days(12) },
  { n: 2, title: "Landing page layout", status: "in_review", priority: "high", assignee: SK, labels: ["Design"], due: "2026-11-05", createdAt: days(10), createdBy: SK, pr: { number: 7, state: "open" } },
  { n: 3, title: "Hero screenshot of the board", status: "in_progress", priority: "medium", assignee: SK, labels: ["Design"], due: "2026-11-07", createdAt: days(8), createdBy: SK },
  { n: 4, title: "License page: free and commercial use", status: "todo", priority: "high", assignee: AM, labels: ["Content"], due: "2026-11-10", createdAt: days(6), description: "Plain-language summary of the license grant and how to buy a commercial license. See [[Site plan]]." },
  { n: 5, title: "Render docs from the repo Markdown", status: "backlog", priority: "low", labels: ["Docs"], createdAt: days(5) },
  { n: 6, title: "Changelog from GitHub releases", status: "backlog", priority: "low", labels: ["Docs"], createdAt: days(4) },
  { n: 7, title: "Dark and light screenshots", status: "backlog", priority: "none", labels: ["Design"], createdAt: days(3) },
  { n: 8, title: "Newsletter signup", status: "canceled", priority: "none", labels: ["Content"], createdAt: days(3), description: "No newsletter. GitHub releases are enough." },
];

const taskIds = new Map<string, string>();
const allTasks: { seed: TaskSeed; project: typeof MAD; workspaceId: string; labels: Record<string, string> }[] = [
  ...madTasks.map((seed) => ({ seed, project: MAD, workspaceId: wsMad, labels: madLabels })),
  ...webTasks.map((seed) => ({ seed, project: WEB, workspaceId: wsWeb, labels: webLabels })),
];
for (const t of allTasks) taskIds.set(`${t.project.key}-${t.seed.n}`, randomUUID());

for (const [i, { seed, project, workspaceId, labels }] of allTasks.entries()) {
  const key = `${project.key}-${seed.n}`;
  const id = taskIds.get(key)!;
  const epicId = seed.epic ? taskIds.get(`${project.key}-${seed.epic}`)! : null;
  const epicSeed = seed.epic ? allTasks.find((t) => t.project.key === project.key && t.seed.n === seed.epic)!.seed : null;
  // A task under an epic carries the epic's labels too.
  const labelNames = [...new Set([...seed.labels, ...(epicSeed?.labels ?? [])])];
  const labelIds = labelNames.map((n) => labels[n]!);
  const creator = seed.createdBy ?? AM;
  const assignee = seed.assignee ?? null;
  const description = seed.description ?? "";
  const closed = seed.status === "done" || seed.status === "canceled";
  const type = seed.type ?? (labelNames.includes("Bug") ? "bug" : "task");
  await db.insert(s.tasks).values({
    id,
    projectId: project.id,
    number: seed.n,
    key,
    type,
    title: seed.title,
    description,
    status: seed.status,
    priority: seed.priority,
    assigneeUserId: assignee?.type === "user" ? assignee.id : null,
    assigneeGrantId: assignee?.type === "agent" ? assignee.id : null,
    epicId,
    dueDate: seed.due ?? null,
    branch: seed.branch ?? null,
    sortOrder: i,
    createdByType: creator.type,
    createdById: creator.id,
    completedAt: closed ? new Date(seed.createdAt.getTime() + 86_400_000) : null,
    createdAt: seed.createdAt,
    updatedAt: closed ? new Date(seed.createdAt.getTime() + 86_400_000) : seed.createdAt,
    ...(seed.deleted ? { deletedAt: seed.deleted.at, deletedByType: seed.deleted.actor.type, deletedById: seed.deleted.actor.id } : {}),
  });
  if (labelIds.length) await db.insert(s.taskLabels).values(labelIds.map((labelId) => ({ taskId: id, labelId })));
  const snapshot = {
    key,
    title: seed.title,
    description,
    type,
    status: seed.status,
    priority: seed.priority,
    assignee: assignee ? `${assignee.type}:${assignee.id}` : null,
    labelIds: [...labelIds].sort(),
    epicId,
    dueDate: seed.due ?? null,
  };
  revision(creator, seed.createdAt, { entityType: "task", entityId: id, snapshot: { ...snapshot, status: key === "MAD-109" ? "todo" : seed.status }, added: description ? description.split("\n").length : 0, summary: "Created" });
  audit(creator, seed.createdAt, {
    workspaceId,
    projectId: project.id,
    action: "task.create",
    entityType: "task",
    entityId: id,
    entityLabel: `${key} ${seed.title}`,
    after: { ...snapshot, ...(key === "MAD-109" ? { status: "todo", fromDraft: true } : {}), assigneeName: assignee?.name ?? null },
  });
  if (seed.deleted) {
    audit(seed.deleted.actor, seed.deleted.at, { workspaceId, projectId: project.id, action: "task.delete", entityType: "task", entityId: id, entityLabel: `${key} ${seed.title}` });
  }
}

await db.update(s.projects).set({ nextNumber: 122 }).where(sql`${s.projects.id} = ${MAD.id}`);
await db.update(s.projects).set({ nextNumber: 9 }).where(sql`${s.projects.id} = ${WEB.id}`);

const tid = (key: string) => taskIds.get(key)!;
const did = (key: string) => docIds.get(key)!;

// MAD-109: agent picked it up in session 7f3a, read the docs, moved it, pushed two commits.
{
  const id = tid("MAD-109");
  const label = "MAD-109 Rclone backup sidecar";
  const base = { workspaceId: wsMad, projectId: MAD.id, entityType: "task", entityId: id, entityLabel: label };
  audit(CC("7f3a"), min(34), { ...base, action: "task.read", after: { docs: 2 } });
  audit(CC("7f3a"), min(34), { ...base, action: "task.update", before: { status: "todo" }, after: { status: "in_progress" } });
  revision(CC("7f3a"), min(34), {
    entityType: "task",
    entityId: id,
    snapshot: { key: "MAD-109", title: "Rclone backup sidecar", description: MAD_109, type: "task", status: "in_progress", priority: "high", assignee: `agent:${G_CODE}`, labelIds: [madLabels.Backend, madLabels.Infra].sort(), epicId: tid("MAD-100"), dueDate: "2026-11-06" },
  });
  audit({ type: "system", id: "system", name: "GitHub" }, min(14), { ...base, action: "task.git_link", after: { provider: "github", kind: "commit", count: 2, branch: "mad-109-rclone-backup-sidecar" } });
}
audit(CC("7f3a"), min(4), {
  workspaceId: wsMad,
  projectId: MAD.id,
  action: "task.update",
  entityType: "task",
  entityId: tid("MAD-104"),
  entityLabel: "MAD-104 Soft delete and trash for docs",
  before: { status: "in_progress" },
  after: { status: "in_review" },
});

await db.insert(s.taskDocs).values([
  { taskId: tid("MAD-109"), docId: did("deploy"), lastReadByAgentAt: min(34), createdAt: hrs(1) },
  { taskId: tid("MAD-109"), docId: did("adr4"), lastReadByAgentAt: min(34), createdAt: hrs(1) },
  { taskId: tid("MAD-119"), docId: did("deploy"), createdAt: days(2) },
  { taskId: tid("MAD-104"), docId: did("safety"), createdAt: days(13) },
  { taskId: tid("WEB-4"), docId: did("w-plan"), createdAt: days(6) },
  { taskId: tid("WEB-3"), docId: did("w-launch"), createdAt: days(8) },
]);

// ── Git ─────────────────────────────────────────────────────────────────

await db.insert(s.repos).values([
  { projectId: MAD.id, provider: "github", fullName: "example/mado", secretEnc: encrypt("demo-webhook-secret-mado"), lastEventAt: min(14), createdAt: days(15) },
  { projectId: WEB.id, provider: "github", fullName: "example/website", secretEnc: encrypt("demo-webhook-secret-website"), lastEventAt: days(1), createdAt: days(12) },
]);
const gh = (repo: string, path: string) => `https://github.com/${repo}/${path}`;
const gitRows: (typeof s.gitLinks.$inferInsert)[] = [
  { taskId: tid("MAD-109"), provider: "github", kind: "branch", externalId: "mad-109-rclone-backup-sidecar", title: "mad-109-rclone-backup-sidecar", url: gh("example/mado", "tree/mad-109-rclone-backup-sidecar"), repo: "example/mado", authoredAt: min(33), createdAt: min(33) },
  { taskId: tid("MAD-109"), provider: "github", kind: "commit", externalId: "7be03d1", title: "MAD-109 add backup image with pg_dump and rclone", url: gh("example/mado", "commit/7be03d1"), repo: "example/mado", authoredAt: min(32), createdAt: min(14) },
  { taskId: tid("MAD-109"), provider: "github", kind: "commit", externalId: "a41f9c2", title: "MAD-109 rotate daily and weekly dumps", url: gh("example/mado", "commit/a41f9c2"), repo: "example/mado", authoredAt: min(14), createdAt: min(14) },
];
for (const { seed, project } of allTasks) {
  if (!seed.pr) continue;
  const key = `${project.key}-${seed.n}`;
  const repo = project.key === "MAD" ? "example/mado" : "example/website";
  gitRows.push({
    taskId: tid(key),
    provider: "github",
    kind: "pr",
    externalId: String(seed.pr.number),
    title: `${key} ${seed.title}`,
    url: gh(repo, `pull/${seed.pr.number}`),
    state: seed.pr.state,
    repo,
    authoredAt: new Date(seed.createdAt.getTime() + 3_600_000),
    createdAt: new Date(seed.createdAt.getTime() + 3_600_000),
  });
}
await db.insert(s.gitLinks).values(gitRows);

// ── Comments ────────────────────────────────────────────────────────────

const commentSeeds: { task: string; actor: ActorRef; at: Date; body: string }[] = [
  { task: "MAD-109", actor: AM, at: min(50), body: "Keep the defaults at 14 daily and 8 weekly, same as the old scripts." },
  {
    task: "MAD-109",
    actor: CC("7f3a"),
    at: min(6),
    body: "Rotation and the offsite mirror are done and tested against a local rclone remote. The Settings part waits on MAD-119, because the web app doesn't read **lastBackupAt** yet. Want me to pick up MAD-119 next?",
  },
  { task: "MAD-119", actor: CC("7f3a"), at: min(6), body: "Want me to pick this up next? MAD-109 is waiting on it." },
  { task: "MAD-115", actor: SK, at: hrs(5), body: "I can write the guide. Pulling images first, or building from source?" },
  { task: "WEB-4", actor: AM, at: days(1), body: "Example Robotics asked for exactly this page." },
];
for (const c of commentSeeds) {
  const [row] = await db
    .insert(s.comments)
    .values({ taskId: tid(c.task), body: c.body, actorType: c.actor.type, actorId: c.actor.id, sessionId: c.actor.sessionId ?? null, createdAt: c.at, updatedAt: c.at })
    .returning();
  const t = allTasks.find((x) => `${x.project.key}-${x.seed.n}` === c.task)!;
  audit(c.actor, c.at, {
    workspaceId: t.workspaceId,
    projectId: t.project.id,
    action: "comment.create",
    entityType: "comment",
    entityId: row!.id,
    entityLabel: `${c.task} ${t.seed.title}`,
    after: { taskId: tid(c.task), body: c.body },
  });
}

// ── CRM ─────────────────────────────────────────────────────────────────

type LeadSeed = {
  company: string;
  location: string;
  details: string;
  website?: string;
  contact: string;
  role?: string;
  email?: string;
  stage: s.LeadStage;
  source: string;
  lastContactAt?: string;
  lastContactNote?: string;
  notes?: string;
  createdBy?: ActorRef;
  createdAt: Date;
  deleted?: { actor: ActorRef; at: Date };
  analysis?: (typeof s.leads.$inferInsert)["analysis"];
  draft?: (typeof s.leads.$inferInsert)["draft"];
};

// Every company, person and domain here is made up.
const leadSeeds: LeadSeed[] = [
  {
    company: "Example Robotics",
    location: "Example City",
    details: "120 people, 3 dev teams",
    website: "example-robotics.example",
    contact: "Jordan Doe",
    role: "Head of Engineering",
    email: "jordan@example-robotics.example",
    stage: "replied",
    source: "GitHub issue",
    lastContactAt: "2026-10-28",
    lastContactNote: "replied to intro",
    notes: "Self-hosts everything. Wants coding agents on their tasks without giving them hard delete. Above the free limit, so a commercial license.",
    createdAt: days(9),
    analysis: {
      rows: [
        { label: "Fit", text: "High. Per-project agent grants and session revert (MAD-111) are their main ask." },
        { label: "Timing", text: "Offer a two-week pilot with one team before the license." },
        { label: "Risk", text: "They asked about SSO, which is not planned." },
      ],
      model: "anthropic/claude-sonnet-5",
      ms: 4120,
    },
    draft: {
      subject: "A mado pilot for your platform team",
      body: "Hi Jordan\n\nThanks for the quick reply. Reverting a whole agent session is next on our list, which fits what you described. Do you have 20 minutes on Tuesday at 3 pm for a short demo on your own data?\n\nBest, Alex\n\nNot interested? A short reply is enough.",
      language: "en",
      model: "anthropic/claude-sonnet-5",
    },
  },
  { company: "Sample Agency", location: "Sampletown", details: "25 people", website: "sample-agency.example", contact: "Taylor Sample", role: "owner", email: "taylor@sample-agency.example", stage: "replied", source: "Email", lastContactAt: "2026-10-27", lastContactNote: "asked about the license", notes: "Under the free limit. Wants to know whether client work counts as production use. Sent us Example Robotics.", createdAt: days(20) },
  { company: "Demo Health", location: "Testville", details: "Clinic group, 300 people", contact: "Morgan Test", role: "CTO", email: "morgan@demo-health.example", stage: "qualified", source: "Event", lastContactAt: "2026-10-20", lastContactNote: "call with IT", notes: "Met at a meetup. Needs everything on their own servers and backups they can prove (MAD-109).", createdAt: days(14) },
  { company: "Placeholder Labs", location: "Example City", details: "Research lab, 60 people", contact: "Casey Placeholder", role: "lab manager", stage: "contacted", source: "Website", lastContactAt: "2026-10-24", lastContactNote: "sent license summary", notes: "If they are a non-profit, it's free. Waiting for their legal form.", createdAt: days(8) },
  { company: "Mock Media", location: "Sampletown", details: "Studio, 40 people", contact: "Riley Mock", role: "producer", stage: "contacted", source: "via agent", lastContactAt: "2026-10-22", lastContactNote: "intro email", notes: "Found by the agent in a list of studios looking for a self-hosted wiki.", createdBy: CC(null), createdAt: days(9) },
  { company: "Fictional Foods", location: "Testville", details: "Startup, 15 people", contact: "Avery Fiction", role: "founder", stage: "new", source: "via agent", notes: "Small team, would be free. Interested in the CRM.", createdBy: CC(null), createdAt: days(4) },
  { company: "Dummy Design Studio", location: "Remote", details: "8 people", contact: "Quinn Dummy", stage: "new", source: "Social", notes: "Replied to a post. Wants the desktop app on Linux (MAD-116).", createdAt: days(3) },
  { company: "Specimen Software", location: "Example City", details: "200 people", contact: "Drew Specimen", role: "VP Engineering", stage: "won", source: "Referral", lastContactAt: "2026-10-02", lastContactNote: "license signed", notes: "Commercial license since October. Two workspaces.", createdAt: days(40) },
  { company: "Prototype Press", location: "Sampletown", details: "Publisher, 90 people", contact: "Sky Prototype", role: "IT lead", stage: "lost", source: "Email", lastContactAt: "2026-09-18", lastContactNote: "chose a hosted tool", createdAt: days(50) },
  { company: "Trial Tours", location: "Testville", details: "12 people", contact: "Robin Trial", stage: "new", source: "Email", createdAt: days(12), deleted: { actor: AM, at: days(5) } },
];

for (const [i, l] of leadSeeds.entries()) {
  const [company] = await db
    .insert(s.companies)
    .values({ projectId: MAD.id, name: l.company, location: l.location, details: l.details, website: l.website ?? "", createdAt: l.createdAt })
    .returning();
  const [contact] = await db
    .insert(s.contacts)
    .values({ projectId: MAD.id, companyId: company!.id, name: l.contact, role: l.role ?? "", email: l.email ?? "", createdAt: l.createdAt })
    .returning();
  const creator = l.createdBy ?? AM;
  const [lead] = await db
    .insert(s.leads)
    .values({
      projectId: MAD.id,
      companyId: company!.id,
      contactId: contact!.id,
      stage: l.stage,
      source: l.source,
      notes: l.notes ?? "",
      lastContactAt: l.lastContactAt ?? null,
      lastContactNote: l.lastContactNote ?? "",
      analysis: l.analysis ?? null,
      analyzedAt: l.analysis ? hrs(2) : null,
      draft: l.draft ?? null,
      draftedAt: l.draft ? hrs(2) : null,
      sortOrder: i,
      createdByType: creator.type,
      createdById: creator.id,
      createdAt: l.createdAt,
      updatedAt: l.createdAt,
      ...(l.deleted ? { deletedAt: l.deleted.at, deletedByType: l.deleted.actor.type, deletedById: l.deleted.actor.id } : {}),
    })
    .returning();
  revision(creator, l.createdAt, { entityType: "lead", entityId: lead!.id, snapshot: { company: l.company, contact: l.contact, stage: l.stage, source: l.source, notes: l.notes ?? "" }, summary: "Created" });
  audit(creator, l.createdAt, { workspaceId: wsMad, projectId: MAD.id, action: "lead.create", entityType: "lead", entityId: lead!.id, entityLabel: l.company, after: { stage: l.stage } });
  if (l.deleted) audit(l.deleted.actor, l.deleted.at, { workspaceId: wsMad, projectId: MAD.id, action: "lead.delete", entityType: "lead", entityId: lead!.id, entityLabel: l.company });
}

// ── Notifications ───────────────────────────────────────────────────────

const note = (n: { kind: string; task: string; actor: ActorRef; at: Date; body: string; read?: boolean; workspaceId?: string }) => {
  const t = allTasks.find((x) => `${x.project.key}-${x.seed.n}` === n.task)!;
  return {
    userId: alex,
    workspaceId: n.workspaceId ?? t.workspaceId,
    kind: n.kind,
    entityType: "task",
    entityId: tid(n.task),
    title: `${n.task} ${t.seed.title}`,
    body: n.body,
    actorType: n.actor.type,
    actorId: n.actor.id,
    actorName: n.actor.name,
    readAt: n.read ? n.at : null,
    createdAt: n.at,
  };
};
await db.insert(s.notifications).values([
  note({ kind: "commented", task: "MAD-109", actor: CC("7f3a"), at: min(6), body: commentSeeds[1]!.body }),
  note({ kind: "commented", task: "MAD-119", actor: CC("7f3a"), at: min(6), body: commentSeeds[2]!.body }),
  note({ kind: "commented", task: "MAD-115", actor: SK, at: hrs(5), body: commentSeeds[3]!.body }),
  note({ kind: "status", task: "MAD-104", actor: CC("7f3a"), at: min(4), body: "In progress → In review", read: true }),
  note({ kind: "commented", task: "WEB-3", actor: SK, at: days(2), body: "The hero screenshot is in Figma, have a look.", read: true }),
]);

// ── Refs (same rules as RefsService) ────────────────────────────────────

const TASK_KEY_RE = /\b([A-Z][A-Z0-9]{1,4})-(\d+)\b/g;
const WIKI_LINK_RE = /\[\[([^\]\n]+?)\]\]/g;
const liveTaskKeys = new Map(allTasks.filter((t) => !t.seed.deleted).map((t) => [`${t.project.key}-${t.seed.n}`, { id: tid(`${t.project.key}-${t.seed.n}`) }]));
const liveDocs = docSeeds.filter((d) => !d.deleted);
const refRows: (typeof s.refs.$inferInsert)[] = [];
function addRefs(source: { type: "doc" | "task"; id: string; workspaceId: string }, text: string) {
  for (const m of text.matchAll(TASK_KEY_RE)) {
    const t = liveTaskKeys.get(`${m[1]}-${m[2]}`);
    if (t && !(source.type === "task" && t.id === source.id)) refRows.push({ sourceType: source.type, sourceId: source.id, targetType: "task", targetId: t.id });
  }
  const titles = [...text.matchAll(WIKI_LINK_RE)].map((m) => m[1]!.trim().split("/").pop()!.trim().toLowerCase());
  for (const d of liveDocs) {
    const id = did(d.key);
    if (d.workspaceId === source.workspaceId && titles.includes(d.title.toLowerCase()) && !(source.type === "doc" && id === source.id)) {
      refRows.push({ sourceType: source.type, sourceId: source.id, targetType: "doc", targetId: id });
    }
  }
}
for (const d of liveDocs) addRefs({ type: "doc", id: did(d.key), workspaceId: d.workspaceId }, d.content);
for (const t of allTasks) {
  if (t.seed.deleted) continue;
  const key = `${t.project.key}-${t.seed.n}`;
  const bodies = commentSeeds.filter((c) => c.task === key).map((c) => c.body);
  addRefs({ type: "task", id: tid(key), workspaceId: t.workspaceId }, [t.seed.description ?? "", ...bodies].join("\n"));
}
if (refRows.length) await db.insert(s.refs).values(refRows).onConflictDoNothing();

// ── Flush history ───────────────────────────────────────────────────────

auditRows.sort((a, b) => a.createdAt!.getTime() - b.createdAt!.getTime());
for (let i = 0; i < revisionRows.length; i += 500) await db.insert(s.revisions).values(revisionRows.slice(i, i + 500));
for (let i = 0; i < auditRows.length; i += 500) await db.insert(s.auditLog).values(auditRows.slice(i, i + 500));
// Empty parent pages (Architecture, Decisions, Runbooks) are folders.
await client`UPDATE docs d SET kind = 'folder' WHERE btrim(d.content) = '' AND EXISTS (SELECT 1 FROM docs c WHERE c.parent_id = d.id)`;
await db
  .insert(s.settings)
  .values({ key: "seed.at", value: new Date().toISOString() })
  .onConflictDoUpdate({ target: s.settings.key, set: { value: new Date().toISOString() } });

console.log(
  `seeded: ${allTasks.length} tasks, ${docSeeds.length} pages, ${leadSeeds.length} leads, ${revisionRows.length} revisions, ${auditRows.length} audit entries, ${refRows.length} refs`,
);
console.log("login: alex@example.com / mado-demo-2026");
await client.end();
