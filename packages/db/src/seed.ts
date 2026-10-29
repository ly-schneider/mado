/**
 * Demo data matching the Figma screens. `bun run db:seed` seeds an empty instance;
 * `bun run db:seed -- --reset` truncates every table first. Runs as the owner role.
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
  const taken = await client`select key from projects where key in ('GAT', 'TAV', 'LIB')`;
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
// Sam is also in Gather because the board design assigns GAT-115 to SK.
const wsGat = await workspace("Gather", "gather", [[alex, "owner"], [sam, "member"]]);
const wsTav = await workspace("Tavola", "tavola", [[alex, "owner"]]);
const wsLib = await workspace("Library app", "library-app", [[alex, "owner"], [sam, "member"]]);

async function project(workspaceId: string, name: string, key: string, description: string) {
  const [p] = await db.insert(s.projects).values({ workspaceId, name, key, description, createdAt: days(30) }).returning();
  return p!;
}
const GAT = await project(wsGat, "Gather", "GAT", "Community events and member management.");
const TAV = await project(wsTav, "Tavola", "TAV", "POS and kitchen display for small restaurants.");
const LIB = await project(wsLib, "Library app", "LIB", "Web-App für eine Schulbibliothek, Teamprojekt.");

async function labelSet(projectId: string, list: [string, string][]) {
  const rows = await db
    .insert(s.labels)
    .values(list.map(([name, color]) => ({ projectId, name, color, createdAt: days(30) })))
    .returning();
  return Object.fromEntries(rows.map((r) => [r.name, r.id])) as Record<string, string>;
}
const gatLabels = await labelSet(GAT.id, [
  ["Backend", "blue"],
  ["Frontend", "violet"],
  ["Bug", "red"],
  ["Feature", "green"],
  ["Infra", "amber"],
  ["Events", "teal"],
]);
const tavLabels = await labelSet(TAV.id, [
  ["Kitchen", "amber"],
  ["Checkout", "green"],
  ["Hardware", "grey"],
  ["Floor", "blue"],
  ["Menu", "pink"],
]);
const libLabels = await labelSet(LIB.id, [
  ["Doku", "grey"],
  ["Frontend", "violet"],
  ["Backend", "blue"],
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
  { grantId: G_CODE, projectId: GAT.id, level: "write" },
  { grantId: G_CODE, projectId: TAV.id, level: "read" },
  { grantId: G_ASSIST, projectId: GAT.id, level: "write" },
  { grantId: G_CI, projectId: TAV.id, level: "read" },
]);
await db.insert(s.agentSessions).values([
  { id: "7f3a", grantId: G_CODE, writes: 9, lastTaskKey: "GAT-109", startedAt: min(36), lastActiveAt: min(2) },
  { id: "2c19", grantId: G_CODE, writes: 3, lastTaskKey: "GAT-102", startedAt: hrs(45), lastActiveAt: hrs(44) },
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

const EVENTS = `Events are the core object in Gather. One event row owns its schedule; occurrences are computed, never stored. Recurrence follows RFC 5545 and is decided in [[ADR-004 RRULE storage]].

## Data model

An event stores **rrule**, **dtstart** and **tz**. The API expands occurrences for the requested range (max 2 years), so a calendar view costs one query. Work on this lives in GAT-109.

\`\`\`ts
export const events = pgTable("events", {
  id: uuid().primaryKey(),
  title: text().notNull(),
  dtstart: timestamp({ withTimezone: true }).notNull(),
  tz: text().notNull(),          // IANA, e.g. Europe/Zurich
  rrule: text(),                 // RFC 5545, null = one-off
  deletedAt: timestamp(),        // soft delete only
});
\`\`\`

## Editing a series

- **This event only** — store an exception date on the series.
- **This and following** — end the series and start a new one, see [[Recurrence rules]].
- **All events** — rewrite the rule; reminders are rescheduled by a **pg-boss** job.

> **Agents:** read this page before you touch the events module. Open questions go into a comment, not into the code.

Timezones are stored per event, never per user. Reminder offsets are computed per occurrence, so DST changes stay correct; the open bug is GAT-119.

Reminders: a pg-boss job runs every minute and picks occurrences starting in the next reminder window. Each member chooses 1 hour, 1 day or both. Sending is idempotent per occurrence and member.`;

const EVENTS_BEFORE_AGENT = EVENTS.replace(/\n\nTimezones are stored[\s\S]*$/, "\n\nTimezones are stored per event, never per user. DST bugs go to GAT-119.");

const ADR_004 = `**Status:** accepted · October 2026

## Context

Recurring events need a rule that survives DST changes and edits to single occurrences. [[Events]] describes the data model.

## Decision

Store the RFC 5545 **RRULE** string, **dtstart** and an IANA **tz** on the event row. Expand occurrences on read, capped at 2 years per request. Exceptions (EXDATE) live in a small \`event_exceptions\` table.

## Consequences

- One query per calendar view, no occurrence table to keep in sync.
- Editing "this and following" splits the series into two rows.
- Reminders must compute offsets per occurrence, see GAT-119.

## Alternatives

- **Materialised occurrences:** fast reads, but every edit rewrites hundreds of rows.
- **Cron strings:** no standard for exceptions and no calendar client understands them.`;

const AUTH = `Sessions are plain cookies backed by a \`sessions\` table. No JWTs.

## Login

- Passwords are hashed with argon2id.
- The cookie holds a random 256-bit token; the table only stores its sha256.
- Sessions last 60 days and die on logout.

## Roles

Owner and member per workspace. Members read and write docs and tasks; only the owner purges from the trash.

## Agents

Agents never use cookies. They connect through OAuth 2.1 with PKCE and get one grant per client. The grant is re-read on every MCP call, so edits apply immediately. Tunnel and Access settings are in [[Deploy]].

Invites for teammates are tracked in GAT-105.`;

const DEPLOY = `Gather runs as Docker Compose on a single VM. Cloudflare Tunnel, no open ports.

## Services

- **api** — NestJS, serves the SPA, oRPC, MCP and webhooks
- **postgres** — the only other container

## Deploy

\`\`\`sh
ssh app-host
cd /srv/gather && git pull
docker compose up -d --build
\`\`\`

Check the health endpoint afterwards. Recurring jobs ([[Events]] reminders) run in pg-boss inside the api container.

## Backups

Nightly pg_dump to the second disk and to Backblaze B2. Restore steps: [[Postgres restore]]. The first setup is GAT-101.`;

const RESTORE_OLD = `Nightly **pg_dump** runs at 02:30 to the second disk and to Backblaze B2. A restore is tested on the first Monday of every month.

## Steps

\`\`\`sh
docker compose stop api
gunzip -c /backup/mado-2026-11-02.sql.gz \\
  | docker compose exec -T postgres psql -U mado mado
docker compose start api
\`\`\`

After the restore, open [[Deploy]] and check the health endpoint. Log the test in GAT-101.`;

const RESTORE = `Nightly **pg_dump** runs at 02:30 to the second disk and to Backblaze B2. A restore is tested on the first Monday of every month.

## Steps

\`\`\`sh
docker compose stop api
gunzip -c /backup/mado-2026-11-02.sql.gz \\
  | docker compose exec -T postgres psql -U mado_owner mado
docker compose start api
\`\`\`

Run the restore as **mado_owner**. The app role has no **DELETE** on core tables, so it cannot restore over them — that is on purpose.

After the restore, open [[Deploy]] and check the health endpoint. Log the test in GAT-101.`;

const OLD_RRULE_NOTES = `Scratch notes before ADR-004. Superseded by [[ADR-004 RRULE storage]].

- rrule.js vs. own parser?
- store occurrences for 1 year ahead?`;

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

const eventsHistory = longHistory(22, days(14), min(40), [AM, AM, AM, CC(null)]);
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
  { actor: AM, at: hrs(4), content: RESTORE_OLD.replace("02:30", "02:30 (Europe/Zurich)") },
  { actor: AM, at: hrs(3), content: RESTORE.replace("Run the restore as **mado_owner**.", "Run the restore as mado_owner."), summary: "Edited steps" },
  { actor: CC("7f3a"), at: min(8), content: RESTORE },
];

const docSeeds: DocSeed[] = [
  {
    key: "arch",
    workspaceId: wsGat,
    projectId: GAT.id,
    title: "Architecture",
    content: "How Gather is built. Start with [[Events]], then [[Auth & sessions]] and [[Deploy]].",
    history: [{ actor: AM, at: days(20) }],
  },
  {
    key: "events",
    workspaceId: wsGat,
    projectId: GAT.id,
    parent: "arch",
    title: "Events",
    content: EVENTS,
    history: [
      ...eventsHistory.map((h, i) => (i === eventsHistory.length - 1 ? { ...h, content: EVENTS_BEFORE_AGENT } : h)),
      { actor: CC("7f3a"), at: min(12) },
    ],
  },
  { key: "auth", workspaceId: wsGat, projectId: GAT.id, parent: "arch", title: "Auth & sessions", content: AUTH, history: longHistory(6, days(19), days(4), [AM]) },
  { key: "deploy", workspaceId: wsGat, projectId: GAT.id, parent: "arch", title: "Deploy", content: DEPLOY, history: longHistory(9, days(18), days(1), [AM, AM, CC(null)]) },
  {
    key: "decisions",
    workspaceId: wsGat,
    projectId: GAT.id,
    title: "Decisions",
    content: "Architecture decision records. One page per decision, numbered, never rewritten — a new ADR supersedes an old one.",
    history: [{ actor: AM, at: days(20) }],
  },
  { key: "adr4", workspaceId: wsGat, projectId: GAT.id, parent: "decisions", title: "ADR-004 RRULE storage", content: ADR_004, history: longHistory(5, days(9), days(2), [AM, CC(null)]) },
  {
    key: "oldnotes",
    workspaceId: wsGat,
    projectId: GAT.id,
    parent: "decisions",
    title: "Old RRULE notes",
    content: OLD_RRULE_NOTES,
    history: [{ actor: AM, at: days(12) }],
    deleted: { actor: CC("7f3a"), at: min(10) },
  },
  {
    key: "runbooks",
    workspaceId: wsGat,
    projectId: GAT.id,
    title: "Runbooks",
    content: "Step by step for when something breaks. Keep them short and test them.",
    history: [{ actor: AM, at: days(20) }],
  },
  { key: "restore", workspaceId: wsGat, projectId: GAT.id, parent: "runbooks", title: "Postgres restore", content: RESTORE, history: restoreHistory },

  {
    key: "c-arch",
    workspaceId: wsTav,
    projectId: TAV.id,
    title: "Architecture",
    content: "Tavola runs on one tablet per station plus a small bridge box for printers. See [[Printer bridge]], [[Offline mode]] and [[Kitchen display]].",
    history: [{ actor: AM, at: days(25) }],
  },
  {
    key: "c-printer",
    workspaceId: wsTav,
    projectId: TAV.id,
    parent: "c-arch",
    title: "Printer bridge",
    content:
      "A Raspberry Pi next to the receipt printer speaks ESC/POS over USB and exposes a tiny HTTP API to the tablets.\n\n## Failure modes\n\n- Paper out: the bridge reports it, the tablet shows a banner.\n- Bridge offline: jobs wait in the retry queue (TAV-35).\n\nOld printers without cut command need a manual tear.",
    history: longHistory(4, days(24), days(6), [AM]),
  },
  {
    key: "c-offline",
    workspaceId: wsTav,
    projectId: TAV.id,
    parent: "c-arch",
    title: "Offline mode",
    content:
      "Orders must work without internet. Every tablet keeps a local queue and syncs when the connection is back.\n\n## Rules\n\n- The kitchen display is the source of truth for order state.\n- Payments are never taken offline.\n- Split bills (TAV-28) work offline because they are just order lines.",
    history: longHistory(3, days(22), days(8), [AM]),
  },
  {
    key: "c-kds",
    workspaceId: wsTav,
    projectId: TAV.id,
    parent: "c-arch",
    title: "Kitchen display",
    content:
      "One screen per station. Tickets appear in order, colour-free, oldest top left.\n\n## Bump bar\n\nA USB bump bar sends keys 1–8 to bump a ticket. Shortcuts are tracked in TAV-31.",
    history: longHistory(3, days(21), days(2), [AM]),
  },
  { key: "c-decisions", workspaceId: wsTav, projectId: TAV.id, title: "Decisions", content: "Decisions for Tavola, newest first.", history: [{ actor: AM, at: days(25) }] },
  { key: "c-runbooks", workspaceId: wsTav, projectId: TAV.id, title: "Runbooks", content: "What to do on a Friday night when the printer stops.", history: [{ actor: AM, at: days(25) }] },

  {
    key: "m-auftrag",
    workspaceId: wsLib,
    projectId: LIB.id,
    title: "Projektauftrag",
    content:
      "Wir bauen eine kleine Web-App für die Bibliothek der Schule: Ausleihen, Rückgaben und Mahnungen.\n\n## Team\n\n- Alex: Backend und Datenbank\n- Sam: Frontend und Doku\n\n## Abgabe\n\nSprint-Review am 4. Dezember. Board und [[Protokolle]] sind hier.",
    history: longHistory(3, days(10), days(3), [AM, SK]),
  },
  {
    key: "m-protokolle",
    workspaceId: wsLib,
    projectId: LIB.id,
    title: "Protokolle",
    content: "## Sprint 1 Planning\n\n- User Stories geschätzt, siehe LIB-1 bis LIB-4.\n- Daily um 08:15.",
    history: [{ actor: SK, at: days(5) }],
  },
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
  workspaceId: wsGat,
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
  { userId: alex, docId: docIds.get("events")! },
  { userId: alex, docId: docIds.get("restore")! },
]);

// ── Tasks ───────────────────────────────────────────────────────────────

const GAT_109 = `Events can repeat. Store the rule as an RFC 5545 **RRULE** next to the event and expand occurrences on read, never on write. Background in [[Events]] and [[ADR-004 RRULE storage]]. Reminders depend on GAT-119.

## Acceptance criteria

- [x] Store **rrule**, **dtstart** and **tz** on events
- [x] API expands occurrences for a date range (max 2 years)
- [ ] Editing “this and following” splits the series
- [ ] Reminders respect DST — blocked by GAT-119`;

const GAT_119 = `Reminders for recurring events fire one hour late after the switch to winter time. The reminder job computes the offset once at series creation instead of per occurrence, using the same tz helper as the RRULE expansion. Blocks GAT-109.

Background: [[Events]].`;

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

const gatTasks: TaskSeed[] = [
  { n: 99, title: "Postgres full-text search, DE + EN", status: "done", priority: "high", assignee: AM, labels: ["Backend"], due: "2026-10-30", createdAt: days(16), pr: { number: 29, state: "merged" }, description: "Search across tasks and docs with the simple, English and German configs. Must stay under 200 ms." },
  { n: 100, title: "Events v2", type: "epic", status: "in_progress", priority: "high", assignee: AM, labels: ["Events"], createdAt: days(15), description: "Recurring events, reminders that respect DST and a public events API. Design lives in [[Events]]." },
  { n: 101, title: "Docker Compose deploy", status: "done", priority: "none", assignee: AM, labels: ["Infra"], due: "2026-10-30", createdAt: days(15), pr: { number: 31, state: "merged" }, description: "api + postgres in one compose file, behind the Cloudflare Tunnel. See [[Deploy]]." },
  { n: 102, title: "Project keys and task IDs", status: "done", priority: "medium", assignee: CC(null), labels: ["Backend"], due: "2026-10-31", createdAt: hrs(44), createdBy: CC("2c19"), pr: { number: 33, state: "merged" }, description: "Keys are 2 to 5 letters, unique per instance. Task numbers are a per-project sequence and never reused." },
  { n: 103, title: "Markdown export for a whole project", status: "backlog", priority: "low", labels: ["Backend"], createdAt: days(14) },
  { n: 104, title: "Soft delete and trash for docs", status: "in_review", priority: "high", assignee: CC(null), labels: ["Backend"], due: "2026-11-03", createdAt: days(13), pr: { number: 42, state: "open" }, description: "Deleted pages go to the trash for 30 days with their sub-pages. Only the owner can purge." },
  { n: 105, title: "Invite teammates by link", status: "backlog", priority: "medium", labels: ["Backend", "Feature"], createdAt: days(13) },
  { n: 106, title: "Calendar sync with Google", status: "backlog", priority: "low", labels: ["Feature", "Events"], createdAt: days(12), deleted: { actor: AM, at: days(3) } },
  { n: 107, title: "Command palette: rank recent items first", status: "in_review", priority: "medium", assignee: AM, labels: ["Frontend"], due: "2026-11-05", createdAt: days(11), pr: { number: 45, state: "open" } },
  { n: 108, title: "Notion import from Markdown export", status: "canceled", priority: "none", labels: ["Feature"], createdAt: days(11), description: "Dropped. Fresh start instead." },
  { n: 109, title: "Recurring events: RRULE support", status: "in_progress", priority: "high", assignee: CC(null), labels: ["Backend"], epic: 100, due: "2026-11-06", createdAt: hrs(1), description: GAT_109, branch: "gat-109-rrule" },
  { n: 110, title: "Backlinks panel for wiki pages", status: "in_progress", priority: "medium", assignee: AM, labels: ["Frontend"], due: "2026-11-07", createdAt: days(9) },
  { n: 111, title: "Revert one agent session", status: "backlog", priority: "medium", labels: ["Backend"], createdAt: days(9) },
  { n: 112, title: "Rate-limit the public events API", status: "todo", priority: "high", assignee: CC(null), labels: ["Backend"], epic: 100, due: "2026-11-08", createdAt: days(8) },
  { n: 113, title: "Deep links app://GAT-109 in the desktop app", status: "backlog", priority: "low", labels: ["Frontend"], createdAt: days(8) },
  { n: 114, title: "Realtime collaboration with Yjs", status: "backlog", priority: "none", labels: ["Frontend", "Backend"], createdAt: days(7) },
  { n: 115, title: "Weekly digest email for upcoming events", status: "todo", priority: "low", assignee: SK, labels: ["Feature"], epic: 100, due: "2026-11-12", createdAt: days(7) },
  { n: 116, title: "iCal feed per calendar", status: "backlog", priority: "medium", labels: ["Feature"], createdAt: days(6) },
  { n: 117, title: "Push notifications for reminders", status: "canceled", priority: "low", labels: ["Feature"], createdAt: days(6), description: "Not before the PWA ships." },
  { n: 118, title: "Image uploads in wiki pages", status: "backlog", priority: "low", labels: ["Frontend"], createdAt: days(5) },
  { n: 119, title: "Fix timezone drift in event reminders", type: "bug", status: "todo", priority: "urgent", assignee: AM, labels: ["Bug"], epic: 100, due: "2026-11-04", createdAt: days(2), description: GAT_119, branch: "gat-119-dst-offset" },
  { n: 120, title: "Sort order for the wiki sidebar", status: "backlog", priority: "low", labels: ["Frontend"], createdAt: days(2) },
  { n: 121, title: "Export member list as CSV", status: "todo", priority: "low", assignee: AM, labels: ["Feature"], createdAt: days(1) },
];

const tavTasks: TaskSeed[] = [
  { n: 22, title: "Offline queue for the waiter app", status: "done", priority: "high", assignee: AM, labels: ["Floor"], createdAt: days(24), description: "See [[Offline mode]]." },
  { n: 24, title: "Printer bridge for ESC/POS", status: "done", priority: "high", assignee: AM, labels: ["Hardware"], createdAt: days(23), description: "See [[Printer bridge]]." },
  { n: 26, title: "Table map drag and drop", status: "in_review", priority: "medium", assignee: AM, labels: ["Floor"], due: "2026-11-03", createdAt: days(12), pr: { number: 18, state: "open" } },
  { n: 28, title: "Split the bill by seat", status: "todo", priority: "high", assignee: AM, labels: ["Checkout"], due: "2026-11-09", createdAt: days(10), description: "Bistro Musterplatz's main ask. Each order line gets a seat number; the bill can be split by seat or by line." },
  { n: 31, title: "Kitchen display: bump-bar shortcuts", status: "in_progress", priority: "high", assignee: AM, labels: ["Kitchen"], due: "2026-11-06", createdAt: days(9), description: "Keys 1–8 bump the ticket in that slot. See [[Kitchen display]]." },
  { n: 35, title: "Retry queue for offline receipt printers", status: "todo", priority: "medium", assignee: AM, labels: ["Hardware"], due: "2026-11-14", createdAt: days(6), description: "Old receipt printers drop off USB. Jobs should wait and retry instead of failing. See [[Printer bridge]]." },
  { n: 40, title: "Allergen filter on the guest menu", status: "backlog", priority: "none", assignee: AM, labels: ["Menu"], createdAt: days(2) },
];

const libTasks: TaskSeed[] = [
  { n: 1, title: "User Stories für Ausleihe schreiben", status: "done", priority: "medium", assignee: SK, labels: ["Doku"], createdAt: days(9), createdBy: SK },
  { n: 2, title: "Datenbankschema Bücher und Ausleihen", status: "in_progress", priority: "high", assignee: SK, labels: ["Backend"], due: "2026-11-10", createdAt: days(8) },
  { n: 3, title: "Login-Seite gestalten", status: "todo", priority: "medium", assignee: SK, labels: ["Frontend"], due: "2026-11-12", createdAt: days(8), createdBy: SK },
  { n: 4, title: "Mahnungen per E-Mail", status: "backlog", priority: "low", labels: ["Backend"], createdAt: days(7) },
];

const taskIds = new Map<string, string>();
const allTasks: { seed: TaskSeed; project: typeof GAT; workspaceId: string; labels: Record<string, string> }[] = [
  ...gatTasks.map((seed) => ({ seed, project: GAT, workspaceId: wsGat, labels: gatLabels })),
  ...tavTasks.map((seed) => ({ seed, project: TAV, workspaceId: wsTav, labels: tavLabels })),
  ...libTasks.map((seed) => ({ seed, project: LIB, workspaceId: wsLib, labels: libLabels })),
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
  revision(creator, seed.createdAt, { entityType: "task", entityId: id, snapshot: { ...snapshot, status: key === "GAT-109" ? "todo" : seed.status }, added: description ? description.split("\n").length : 0, summary: "Created" });
  audit(creator, seed.createdAt, {
    workspaceId,
    projectId: project.id,
    action: "task.create",
    entityType: "task",
    entityId: id,
    entityLabel: `${key} ${seed.title}`,
    after: { ...snapshot, ...(key === "GAT-109" ? { status: "todo", fromDraft: true } : {}), assigneeName: assignee?.name ?? null },
  });
  if (seed.deleted) {
    audit(seed.deleted.actor, seed.deleted.at, { workspaceId, projectId: project.id, action: "task.delete", entityType: "task", entityId: id, entityLabel: `${key} ${seed.title}` });
  }
}

await db.update(s.projects).set({ nextNumber: 122 }).where(sql`${s.projects.id} = ${GAT.id}`);
await db.update(s.projects).set({ nextNumber: 41 }).where(sql`${s.projects.id} = ${TAV.id}`);
await db.update(s.projects).set({ nextNumber: 5 }).where(sql`${s.projects.id} = ${LIB.id}`);

const tid = (key: string) => taskIds.get(key)!;
const did = (key: string) => docIds.get(key)!;

// GAT-109: agent picked it up in session 7f3a, read the docs, moved it, pushed two commits.
{
  const id = tid("GAT-109");
  const label = "GAT-109 Recurring events: RRULE support";
  const base = { workspaceId: wsGat, projectId: GAT.id, entityType: "task", entityId: id, entityLabel: label };
  audit(CC("7f3a"), min(34), { ...base, action: "task.read", after: { docs: 2 } });
  audit(CC("7f3a"), min(34), { ...base, action: "task.update", before: { status: "todo" }, after: { status: "in_progress" } });
  revision(CC("7f3a"), min(34), {
    entityType: "task",
    entityId: id,
    snapshot: { key: "GAT-109", title: "Recurring events: RRULE support", description: GAT_109, type: "task", status: "in_progress", priority: "high", assignee: `agent:${G_CODE}`, labelIds: [gatLabels.Backend, gatLabels.Events].sort(), epicId: tid("GAT-100"), dueDate: "2026-11-06" },
  });
  audit({ type: "system", id: "system", name: "GitHub" }, min(14), { ...base, action: "task.git_link", after: { provider: "github", kind: "commit", count: 2, branch: "gat-109-rrule" } });
}
audit(CC("7f3a"), min(4), {
  workspaceId: wsGat,
  projectId: GAT.id,
  action: "task.update",
  entityType: "task",
  entityId: tid("GAT-104"),
  entityLabel: "GAT-104 Soft delete and trash for docs",
  before: { status: "in_progress" },
  after: { status: "in_review" },
});

await db.insert(s.taskDocs).values([
  { taskId: tid("GAT-109"), docId: did("events"), lastReadByAgentAt: min(34), createdAt: hrs(1) },
  { taskId: tid("GAT-109"), docId: did("adr4"), lastReadByAgentAt: min(34), createdAt: hrs(1) },
  { taskId: tid("GAT-119"), docId: did("events"), createdAt: days(2) },
  { taskId: tid("GAT-104"), docId: did("restore"), createdAt: days(13) },
  { taskId: tid("TAV-35"), docId: did("c-printer"), createdAt: days(6) },
  { taskId: tid("TAV-31"), docId: did("c-kds"), createdAt: days(9) },
]);

// ── Git ─────────────────────────────────────────────────────────────────

await db.insert(s.repos).values([
  { projectId: GAT.id, provider: "github", fullName: "acme/gather", secretEnc: encrypt("demo-webhook-secret-gather"), lastEventAt: min(14), createdAt: days(15) },
  { projectId: TAV.id, provider: "github", fullName: "acme/tavola", secretEnc: encrypt("demo-webhook-secret-tavola"), lastEventAt: days(1), createdAt: days(24) },
]);
const gh = (repo: string, path: string) => `https://github.com/${repo}/${path}`;
const gitRows: (typeof s.gitLinks.$inferInsert)[] = [
  { taskId: tid("GAT-109"), provider: "github", kind: "branch", externalId: "gat-109-rrule", title: "gat-109-rrule", url: gh("acme/gather", "tree/gat-109-rrule"), repo: "acme/gather", authoredAt: min(33), createdAt: min(33) },
  { taskId: tid("GAT-109"), provider: "github", kind: "commit", externalId: "7be03d1", title: "GAT-109 add rrule columns + migration", url: gh("acme/gather", "commit/7be03d1"), repo: "acme/gather", authoredAt: min(32), createdAt: min(14) },
  { taskId: tid("GAT-109"), provider: "github", kind: "commit", externalId: "a41f9c2", title: "GAT-109 expand occurrences per range", url: gh("acme/gather", "commit/a41f9c2"), repo: "acme/gather", authoredAt: min(14), createdAt: min(14) },
];
for (const { seed, project } of allTasks) {
  if (!seed.pr) continue;
  const key = `${project.key}-${seed.n}`;
  const repo = project.key === "GAT" ? "acme/gather" : "acme/tavola";
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
  { task: "GAT-109", actor: AM, at: min(50), body: "Keep the expansion cap at 2 years, the calendar never asks for more." },
  {
    task: "GAT-109",
    actor: CC("7f3a"),
    at: min(6),
    body: "Range expansion is done and tested up to 2 years. DST handling waits on GAT-119, because reminders share the same **tz** helper. Want me to pick up GAT-119 next?",
  },
  { task: "GAT-119", actor: CC("7f3a"), at: min(6), body: "Want me to pick this up next? GAT-109 is waiting on it." },
  { task: "GAT-115", actor: SK, at: hrs(5), body: "I can do the email template. Sunday evening or Monday morning?" },
  { task: "TAV-28", actor: AM, at: days(1), body: "Bistro Musterplatz wants to test this on a Tuesday." },
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

const leadSeeds: LeadSeed[] = [
  {
    company: "Bistro Musterplatz",
    location: "Musterwil",
    details: "40 seats",
    website: "bistro-musterplatz.example",
    contact: "Jonas Muster",
    role: "owner",
    email: "hallo@bistro-musterplatz.example",
    stage: "replied",
    source: "Referral from Café Platzhalter",
    lastContactAt: "2026-10-28",
    lastContactNote: "replied to intro",
    notes: "Two terminals. Paper order tickets on Fridays because the old POS cannot split bills. Wants to test on a quiet day.",
    createdAt: days(9),
    analysis: {
      rows: [
        { label: "Fit", text: "High. Split by seat (TAV-28) is their main ask." },
        { label: "Timing", text: "Offer a Tuesday pilot, not the Friday rush." },
        { label: "Risk", text: "Old receipt printer — depends on TAV-35." },
      ],
      model: "anthropic/claude-sonnet-5",
      ms: 4120,
    },
    draft: {
      subject: "Split-Bill für eure Freitage",
      body: "Hoi Jonas\n\nDanke für die schnelle Antwort. Rechnungen nach Platz teilen ist ab nächster Woche drin, genau für eure Freitage. Hast du am Dienstag um 15 Uhr 20 Minuten für eine kurze Demo am Terminal?\n\nLiebe Grüsse, Alex\n\nKein Interesse? Eine kurze Antwort genügt.",
      language: "de",
      model: "anthropic/claude-sonnet-5",
    },
  },
  { company: "Café Platzhalter", location: "Musterwil", details: "28 seats", contact: "Sara Beispiel", role: "owner", email: "sara@cafe-platzhalter.example", stage: "replied", source: "Email", lastContactAt: "2026-10-27", lastContactNote: "asked for pricing", notes: "Happy with the demo. Sent us Bistro Musterplatz.", createdAt: days(20) },
  { company: "Hotel Beispielsee", location: "Beispielsee", details: "Restaurant + terrace, 120 seats", contact: "Anna Probst", role: "F&B manager", email: "a.probst@beispielsee.example", stage: "qualified", source: "Event", lastContactAt: "2026-10-20", lastContactNote: "site visit", notes: "Met at a trade fair. Needs table map for the terrace (TAV-26).", createdAt: days(14) },
  { company: "Ristorante Esempio", location: "Testlingen", details: "60 seats", contact: "Gino Esempio", role: "owner", stage: "contacted", source: "Walk-in", lastContactAt: "2026-10-24", lastContactNote: "left a flyer", notes: "Busy kitchen, interested in the kitchen display.", createdAt: days(8) },
  { company: "Taverne zum Musterbär", location: "Probstadt", details: "45 seats", contact: "Urs Testa", role: "Wirt", stage: "contacted", source: "via agent", lastContactAt: "2026-10-22", lastContactNote: "intro email", notes: "Found by the agent in the Probstadt restaurant list.", createdBy: CC(null), createdAt: days(9) },
  { company: "Ramen Tamesu", location: "Musterwil", details: "22 seats", contact: "Rei Tamesu", role: "chef", stage: "new", source: "via agent", notes: "Counter service only. Might not need table map.", createdBy: CC(null), createdAt: days(4) },
  { company: "Pasta Prova", location: "Beispielberg", details: "35 seats", contact: "Lea Prova", stage: "new", source: "Instagram", notes: "Replied to a story. Wants a quote.", createdAt: days(3) },
  { company: "Bäckerei Musterbrot", location: "Testlingen", details: "Café, 18 seats", contact: "Peter Brotmann", role: "owner", stage: "won", source: "Referral", lastContactAt: "2026-10-02", lastContactNote: "contract signed", notes: "Live since October. Uses one terminal.", createdAt: days(40) },
  { company: "Pizzeria Fittizia", location: "Probstadt", details: "50 seats", contact: "Marco Finto", role: "owner", stage: "lost", source: "Email", lastContactAt: "2026-09-18", lastContactNote: "went with a competitor", createdAt: days(50) },
  { company: "Café Probe", location: "Beispielberg", details: "20 seats", contact: "Frieda Probe", stage: "new", source: "Email", createdAt: days(12), deleted: { actor: AM, at: days(5) } },
];

for (const [i, l] of leadSeeds.entries()) {
  const [company] = await db
    .insert(s.companies)
    .values({ projectId: TAV.id, name: l.company, location: l.location, details: l.details, website: l.website ?? "", createdAt: l.createdAt })
    .returning();
  const [contact] = await db
    .insert(s.contacts)
    .values({ projectId: TAV.id, companyId: company!.id, name: l.contact, role: l.role ?? "", email: l.email ?? "", createdAt: l.createdAt })
    .returning();
  const creator = l.createdBy ?? AM;
  const [lead] = await db
    .insert(s.leads)
    .values({
      projectId: TAV.id,
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
  audit(creator, l.createdAt, { workspaceId: wsTav, projectId: TAV.id, action: "lead.create", entityType: "lead", entityId: lead!.id, entityLabel: l.company, after: { stage: l.stage } });
  if (l.deleted) audit(l.deleted.actor, l.deleted.at, { workspaceId: wsTav, projectId: TAV.id, action: "lead.delete", entityType: "lead", entityId: lead!.id, entityLabel: l.company });
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
  note({ kind: "commented", task: "GAT-109", actor: CC("7f3a"), at: min(6), body: commentSeeds[1]!.body }),
  note({ kind: "commented", task: "GAT-119", actor: CC("7f3a"), at: min(6), body: commentSeeds[2]!.body }),
  note({ kind: "commented", task: "GAT-115", actor: SK, at: hrs(5), body: commentSeeds[3]!.body }),
  note({ kind: "status", task: "GAT-104", actor: CC("7f3a"), at: min(4), body: "In progress → In review", read: true }),
  note({ kind: "commented", task: "LIB-3", actor: SK, at: days(2), body: "Login-Seite ist im Figma, schau mal drüber.", read: true }),
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
await db
  .insert(s.settings)
  .values({ key: "seed.at", value: new Date().toISOString() })
  .onConflictDoUpdate({ target: s.settings.key, set: { value: new Date().toISOString() } });

console.log(
  `seeded: ${allTasks.length} tasks, ${docSeeds.length} pages, ${leadSeeds.length} leads, ${revisionRows.length} revisions, ${auditRows.length} audit entries, ${refRows.length} refs`,
);
console.log("login: alex@example.com / mado-demo-2026");
await client.end();
