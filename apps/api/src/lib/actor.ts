import type { GrantLevel, ResourceType } from "@mado/contract";

export interface LoadedGrant {
  id: string;
  userId: string;
  agentName: string;
  projectScope: "listed" | "all";
  allLevel: GrantLevel;
  projects: Map<string, GrantLevel>;
  resourceTypes: ResourceType[];
}

/**
 * Who is acting. Every service method takes one, so the same code path serves the UI (user),
 * MCP (agent, with its grant checked on every call) and share links (guest).
 */
export type Actor =
  | { type: "user"; userId: string; name: string }
  | {
      type: "agent";
      userId: string; // the user who granted access; a grant never exceeds their rights
      grant: LoadedGrant;
      name: string;
      sessionId: string | null;
    }
  | {
      type: "guest";
      linkId: string;
      name: string; // «Guest via <link name>»
      workspaceId: string;
      rootDocId: string;
      canEdit: boolean;
    }
  | { type: "system"; name: string };

export function actorId(actor: Actor): string {
  switch (actor.type) {
    case "user":
      return actor.userId;
    case "agent":
      return actor.grant.id;
    case "guest":
      return actor.linkId;
    case "system":
      return "system";
  }
}

export function actorSession(actor: Actor): string | null {
  return actor.type === "agent" ? actor.sessionId : null;
}

/** The user whose membership bounds this actor's rights. */
export function actorUserId(actor: Actor): string | null {
  return actor.type === "user" || actor.type === "agent" ? actor.userId : null;
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
