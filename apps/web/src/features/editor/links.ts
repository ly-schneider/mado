import type { DocNode } from "@mado/contract";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { client, orpc, queryClient } from "../../lib/orpc";
import { openExternal } from "../../lib/external";
import { toast } from "../../lib/toast";
import { linkTitle } from "./markdown";

export type LinkTarget = { type: "page"; title: string } | { type: "task"; key: string } | { type: "url"; href: string };
export type OpenLink = (target: LinkTarget, opts?: { newTab?: boolean }) => void;

export function findByTitle(tree: DocNode[] | undefined, raw: string) {
  const title = linkTitle(raw).toLowerCase();
  return tree?.find((n) => n.title.toLowerCase() === title);
}

/**
 * Everything the editor and the view need to turn [[Page]] and MAD-109 into links: the page titles for
 * autocomplete, the project keys that make a token a task key, and the navigation handler.
 */
export function useLinkContext({ workspaceId, wsSlug, onOpenLink }: { workspaceId?: string; wsSlug?: string; onOpenLink?: OpenLink }) {
  const params = useParams({ strict: false }) as { ws?: string };
  const slug = wsSlug ?? params.ws;
  const navigate = useNavigate();
  const { data: workspaces } = useQuery(orpc.workspace.list.queryOptions({ enabled: !!(workspaceId || slug), staleTime: 60_000 }));
  const ws = workspaces?.find((w) => (workspaceId ? w.id === workspaceId : w.slug === slug));
  const wsId = workspaceId ?? ws?.id;
  const { data: tree } = useQuery(orpc.doc.tree.queryOptions({ input: { workspaceId: wsId ?? "" }, enabled: !!wsId }));

  const projectKeys = useMemo(() => (ws ? new Set(ws.projects.map((p) => p.key)) : null), [ws]);
  const titles = useMemo(() => (tree ?? []).map((n) => n.title).filter(Boolean), [tree]);

  const open: OpenLink = (target, opts = {}) => {
    if (onOpenLink) return onOpenLink(target, opts);
    if (target.type === "url") {
      void openExternal(target.href);
      return;
    }
    if (!slug || !wsId) return;
    if (target.type === "task") {
      if (opts.newTab) window.open(`/${slug}/t/${target.key}`, "_blank");
      else navigate({ to: "/$ws/t/$taskKey", params: { ws: slug, taskKey: target.key } });
      return;
    }
    const go = (id: string) => {
      if (opts.newTab) window.open(`/${slug}/wiki/${id}`, "_blank");
      else navigate({ to: "/$ws/wiki/$docId", params: { ws: slug, docId: id } });
    };
    const hit = findByTitle(tree, target.title);
    if (hit) return go(hit.id);
    client.doc
      .resolveTitle({ workspaceId: wsId, title: linkTitle(target.title) })
      .then((res) => {
        if (res) return go(res.id);
        toast(`No page “${linkTitle(target.title)}” yet`, {
          action: {
            label: "Create",
            run: async () => {
              const node = await client.doc.create({ workspaceId: wsId, projectId: ws?.projects[0]?.id ?? null, title: linkTitle(target.title) });
              await queryClient.invalidateQueries({ queryKey: orpc.doc.tree.key() });
              go(node.id);
            },
          },
        });
      })
      .catch(() => toast.error("Could not open the link"));
  };

  return { projectKeys, titles, open, workspace: ws, tree };
}
