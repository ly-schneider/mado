import { findTaskKeys, findWikiLinks } from "@mado/contract";
import { docs, refs, tasks, type Tx } from "@mado/db";
import { Injectable } from "@nestjs/common";
import { and, eq, inArray, isNull } from "drizzle-orm";

/**
 * Keeps the refs table in sync: every [[Page]] and KEY-123 in a doc or task body becomes a row,
 * which powers backlinks ("Linked from") on both pages and tasks.
 */
@Injectable()
export class RefsService {
  async rebuild(tx: Tx, source: { type: "doc" | "task"; id: string; workspaceId: string }, text: string) {
    await tx.delete(refs).where(and(eq(refs.sourceType, source.type), eq(refs.sourceId, source.id)));
    const rows: (typeof refs.$inferInsert)[] = [];

    const keys = findTaskKeys(text);
    if (keys.length) {
      const found = await tx.select({ id: tasks.id }).from(tasks).where(and(inArray(tasks.key, keys), isNull(tasks.deletedAt)));
      for (const t of found) if (!(source.type === "task" && t.id === source.id)) rows.push({ sourceType: source.type, sourceId: source.id, targetType: "task", targetId: t.id });
    }

    const titles = findWikiLinks(text).map((t) => t.split("/").pop()!.trim().toLowerCase());
    if (titles.length) {
      const candidates = await tx
        .select({ id: docs.id, title: docs.title })
        .from(docs)
        .where(and(eq(docs.workspaceId, source.workspaceId), isNull(docs.deletedAt)));
      for (const d of candidates) {
        if (titles.includes(d.title.trim().toLowerCase()) && !(source.type === "doc" && d.id === source.id)) {
          rows.push({ sourceType: source.type, sourceId: source.id, targetType: "doc", targetId: d.id });
        }
      }
    }
    if (rows.length) await tx.insert(refs).values(rows).onConflictDoNothing();
  }
}
