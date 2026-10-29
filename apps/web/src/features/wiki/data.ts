import type { Doc, DocNode, Workspace } from "@mado/contract";
import { useNavigate } from "@tanstack/react-router";
import { strToU8, zipSync } from "fflate";
import { client, errorMessage, orpc, queryClient } from "../../lib/orpc";
import { toast } from "../../lib/toast";

export function childrenMap(tree: DocNode[]) {
  const map = new Map<string | null, DocNode[]>();
  for (const n of tree) {
    const list = map.get(n.parentId) ?? [];
    list.push(n);
    map.set(n.parentId, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
  return map;
}

export function descendants(tree: DocNode[], id: string) {
  const kids = childrenMap(tree);
  const out = new Set<string>([id]);
  const walk = (pid: string) => {
    for (const c of kids.get(pid) ?? []) {
      out.add(c.id);
      walk(c.id);
    }
  };
  walk(id);
  return out;
}

const treeKey = (workspaceId: string) => orpc.doc.tree.queryKey({ input: { workspaceId } });
const docKey = (id: string) => orpc.doc.get.queryKey({ input: { id } });

export function patchTree(workspaceId: string, fn: (tree: DocNode[]) => DocNode[]) {
  const key = treeKey(workspaceId);
  const prev = queryClient.getQueryData<DocNode[]>(key);
  if (prev) queryClient.setQueryData<DocNode[]>(key, fn(prev));
  return () => queryClient.setQueryData(key, prev);
}

export function patchDoc(id: string, patch: Partial<Doc>) {
  const key = docKey(id);
  const prev = queryClient.getQueryData<Doc>(key);
  if (prev) queryClient.setQueryData<Doc>(key, { ...prev, ...patch });
  return () => queryClient.setQueryData(key, prev);
}

export function invalidateTree() {
  return queryClient.invalidateQueries({ queryKey: orpc.doc.tree.key() });
}

/** Create a page optimistically: the client picks the ID, so we can navigate before the server answers. */
export function useCreateDoc(ws: Workspace) {
  const navigate = useNavigate();
  return async (opts: { projectId?: string | null; parentId?: string | null; title?: string } = {}) => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const tree = queryClient.getQueryData<DocNode[]>(treeKey(ws.id)) ?? [];
    const parent = opts.parentId ? tree.find((n) => n.id === opts.parentId) : undefined;
    const projectId = parent ? parent.projectId : (opts.projectId ?? ws.projects[0]?.id ?? null);
    const siblings = tree.filter((n) => n.parentId === (opts.parentId ?? null));
    const node: DocNode = {
      id,
      title: opts.title ?? "Untitled",
      parentId: opts.parentId ?? null,
      projectId,
      sortOrder: Math.max(0, ...siblings.map((s) => s.sortOrder)) + 1,
      hasChildren: false,
      updatedAt: now,
    };
    const rollback = patchTree(ws.id, (t) => [...t.map((n) => (n.id === node.parentId ? { ...n, hasChildren: true } : n)), node]);
    const project = ws.projects.find((p) => p.id === projectId);
    queryClient.setQueryData<Doc>(docKey(id), {
      id,
      workspaceId: ws.id,
      projectId,
      parentId: node.parentId,
      title: node.title,
      content: "",
      path: parent ? [{ id: parent.id, title: parent.title }] : [],
      revisionNumber: 0,
      revisionCount: 0,
      updatedAt: now,
      updatedBy: null,
      favorite: false,
      backlinks: [],
      shareLinks: 0,
      canEdit: true,
    });
    navigate({ to: "/$ws/wiki/$docId", params: { ws: ws.slug, docId: id } });
    try {
      await client.doc.create({ workspaceId: ws.id, projectId, parentId: node.parentId, title: node.title, clientId: id });
      await Promise.all([invalidateTree(), queryClient.invalidateQueries({ queryKey: docKey(id) })]);
    } catch (e) {
      rollback();
      queryClient.removeQueries({ queryKey: docKey(id) });
      toast.error(`Could not create the page: ${errorMessage(e)}`);
      navigate({ to: "/$ws/wiki", params: { ws: ws.slug }, search: { project: project?.key } });
    }
  };
}

export function useDeleteDoc(ws: Workspace) {
  const navigate = useNavigate();
  return async (node: { id: string; title: string; parentId: string | null; projectId: string | null }) => {
    const tree = queryClient.getQueryData<DocNode[]>(treeKey(ws.id)) ?? [];
    const gone = descendants(tree, node.id);
    const rollback = patchTree(ws.id, (t) => t.filter((n) => !gone.has(n.id)));
    const project = ws.projects.find((p) => p.id === node.projectId);
    if (node.parentId) navigate({ to: "/$ws/wiki/$docId", params: { ws: ws.slug, docId: node.parentId } });
    else navigate({ to: "/$ws/wiki", params: { ws: ws.slug }, search: { project: project?.key } });
    try {
      await client.doc.delete({ id: node.id });
      invalidateTree();
      toast(`Moved “${node.title || "Untitled"}” to trash`, {
        action: {
          label: "Undo",
          run: async () => {
            try {
              await client.trash.restore({ entityType: "doc", id: node.id });
              await invalidateTree();
              navigate({ to: "/$ws/wiki/$docId", params: { ws: ws.slug, docId: node.id } });
            } catch (e) {
              toast.error(errorMessage(e));
            }
          },
        },
      });
    } catch (e) {
      rollback();
      toast.error(`Could not delete: ${errorMessage(e)}`);
    }
  };
}

export async function toggleFavorite(doc: Pick<Doc, "id" | "workspaceId" | "favorite">) {
  const on = !doc.favorite;
  const rollback = patchDoc(doc.id, { favorite: on });
  try {
    await client.doc.favorite({ id: doc.id, on });
    queryClient.invalidateQueries({ queryKey: orpc.doc.favorites.key() });
  } catch (e) {
    rollback();
    toast.error(errorMessage(e));
  }
}

export async function moveDoc(workspaceId: string, id: string, parentId: string | null) {
  const tree = queryClient.getQueryData<DocNode[]>(treeKey(workspaceId)) ?? [];
  const sortOrder = Math.max(0, ...tree.filter((n) => n.parentId === parentId).map((n) => n.sortOrder)) + 1;
  const rollback = patchTree(workspaceId, (t) =>
    t.map((n) => (n.id === id ? { ...n, parentId, sortOrder } : n.id === parentId ? { ...n, hasChildren: true } : n)),
  );
  try {
    await client.doc.move({ id, parentId, sortOrder });
    await Promise.all([invalidateTree(), queryClient.invalidateQueries({ queryKey: docKey(id) })]);
  } catch (e) {
    rollback();
    toast.error(`Could not move: ${errorMessage(e)}`);
  }
}

export function safeName(title: string) {
  return title.replace(/[/\\:*?"<>|\n\r]+/g, "-").trim() || "Untitled";
}

export async function downloadZip(name: string, files: { path: string; content: string }[]) {
  const zip = zipSync(Object.fromEntries(files.map((f) => [f.path, strToU8(f.content)])));
  const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeName(name)}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportDoc(workspaceId: string, doc: { id: string; title: string }) {
  try {
    const { files } = await client.doc.export({ workspaceId, docId: doc.id });
    await downloadZip(doc.title, files);
  } catch (e) {
    toast.error(`Export failed: ${errorMessage(e)}`);
  }
}
