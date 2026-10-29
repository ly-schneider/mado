import type { Project, Workspace } from "@mado/contract";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { orpc } from "./orpc";

export function useMe() {
  return useQuery(orpc.auth.me.queryOptions({ staleTime: 60_000 }));
}

export function useWorkspaces() {
  return useQuery(orpc.workspace.list.queryOptions({ staleTime: 60_000 }));
}

/** The workspace in the URL (/$ws/...). Only call inside the workspace layout, where it is guaranteed to exist. */
export function useWorkspace(): Workspace {
  const { ws } = useParams({ strict: false }) as { ws?: string };
  const { data } = useWorkspaces();
  const found = data?.find((w) => w.slug === ws);
  if (!found) throw new Error("useWorkspace outside a loaded workspace");
  return found;
}

export function useProject(key: string): Project | undefined {
  const ws = useWorkspace();
  return ws.projects.find((p) => p.key === key.toUpperCase());
}

/** Project for a task key like GAT-109. */
export function useProjectForTaskKey(taskKey: string): Project | undefined {
  return useProject(taskKey.split("-")[0] ?? "");
}

export function workspaceInitials(name: string) {
  return name.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2).toLowerCase() || "ws";
}
