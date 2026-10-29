import type { DocNode, Workspace } from "@mado/contract";
import { type ActionEntry, ActionMenu, cn, ContextArea } from "@mado/ui";
import {
  ChevronRight,
  Copy,
  FileDown,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  Link2,
  Pencil,
  Plus,
  Star,
  Trash2,
} from "@mado/ui/fluent";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { type DragEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { apiOrigin } from "../../lib/platform";
import { client, errorMessage, orpc, queryClient } from "../../lib/orpc";
import { toast } from "../../lib/toast";
import { setUi, useUi } from "../../lib/ui";
import { childrenMap, descendants, exportDoc, moveDocTo, renameDoc, useCreateDoc, useDeleteDoc } from "./data";

/** Nodes nest without limit; this only guards against cycles in bad data. */
const MAX_DEPTH = 32;

function useFavorites(ws: Workspace) {
  const { data } = useQuery({ ...orpc.doc.favorites.queryOptions({ input: { workspaceId: ws.id } }), staleTime: 60_000 });
  return useMemo(() => new Set((data ?? []).map((d) => d.id)), [data]);
}

async function setFavorite(id: string, on: boolean) {
  try {
    await client.doc.favorite({ id, on });
    await queryClient.invalidateQueries({ queryKey: orpc.doc.favorites.key() });
    queryClient.invalidateQueries({ queryKey: orpc.doc.get.queryKey({ input: { id } }) });
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

/** Indented "Move to" targets: top level plus every folder or page that isn't the node or inside it. */
function moveTargets(ws: Workspace, tree: DocNode[], node: DocNode): ActionEntry[] {
  const blocked = descendants(tree, node.id);
  const kids = childrenMap(tree);
  const out: ActionEntry[] = [];
  if (node.parentId) out.push({ label: "Top level", icon: <FolderOpen />, onSelect: () => moveDocTo(ws.id, node.id, null) });
  const walk = (pid: string | null, depth: number) => {
    if (depth > MAX_DEPTH) return;
    for (const n of kids.get(pid) ?? []) {
      if (blocked.has(n.id)) continue;
      // Pages can hold sub-pages too, but folders are what people organise with, so they come first.
      if (n.id !== node.parentId) {
        out.push({
          label: `${" ".repeat(depth)}${n.title || "Untitled"}`,
          icon: n.kind === "folder" ? <Folder /> : <FileText />,
          onSelect: () => moveDocTo(ws.id, node.id, n.id),
        });
      }
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Every action on a page or folder. The sidebar, folder view, wiki index and doc ⋯ menu all use this. */
export function useDocActions(ws: Workspace) {
  const navigate = useNavigate();
  const create = useCreateDoc(ws);
  const remove = useDeleteDoc(ws);
  const favorites = useFavorites(ws);
  const tree = queryClient.getQueryData<DocNode[]>(orpc.doc.tree.queryKey({ input: { workspaceId: ws.id } })) ?? [];

  const createEntries = (parentId: string | null, projectId?: string | null): ActionEntry[] => [
    { label: "New page", icon: <FileText />, onSelect: () => create({ parentId, projectId }) },
    { label: "New folder", icon: <Folder />, onSelect: () => create({ parentId, projectId, kind: "folder" }) },
  ];

  const forNode = (node: DocNode): ActionEntry[] => {
    const url = `${apiOrigin()}/${ws.slug}/wiki/${node.id}`;
    const fav = favorites.has(node.id);
    const isFolder = node.kind === "folder";
    return [
      { label: isFolder ? "Open folder" : "Open", icon: isFolder ? <FolderOpen /> : <FileText />, onSelect: () => navigate({ to: "/$ws/wiki/$docId", params: { ws: ws.slug, docId: node.id } }) },
      ...createEntries(node.id).map((e) => ("label" in e ? { ...e, label: `${e.label} inside` } : e)),
      { separator: true },
      { label: "Rename", icon: <Pencil />, kbd: "F2", onSelect: () => setUi({ renamingDocId: node.id }) },
      ...(isFolder
        ? []
        : [
            {
              label: "Duplicate",
              icon: <Copy />,
              onSelect: async () => {
                try {
                  const doc = await client.doc.get({ id: node.id });
                  await create({ parentId: node.parentId, projectId: node.projectId, title: `${doc.title} copy`, content: doc.content });
                } catch (e) {
                  toast.error(errorMessage(e));
                }
              },
            } satisfies ActionEntry,
          ]),
      { label: "Move to", icon: <FolderInput />, children: moveTargets(ws, tree, node) },
      { label: fav ? "Remove from favorites" : "Add to favorites", icon: <Star />, onSelect: () => setFavorite(node.id, !fav) },
      {
        label: "Copy link",
        icon: <Link2 />,
        onSelect: () => navigator.clipboard?.writeText(url).then(() => toast("Link copied")),
      },
      { label: "Export as Markdown", icon: <FileDown />, onSelect: () => exportDoc(ws.id, node) },
      { separator: true },
      { label: isFolder ? "Delete folder" : "Delete", icon: <Trash2 />, danger: true, onSelect: () => remove(node) },
    ];
  };

  return { forNode, createEntries };
}

function RenameInput({ ws, node, onDone }: { ws: Workspace; node: DocNode; onDone: () => void }) {
  const [value, setValue] = useState(node.title);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const commit = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save && value.trim() !== node.title) renameDoc(ws.id, node.id, value);
    onDone();
  };
  return (
    <input
      ref={ref}
      value={value}
      aria-label="Name"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => commit(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") commit(true);
        if (e.key === "Escape") commit(false);
      }}
      className="h-6 min-w-0 flex-1 rounded-sm border border-accent bg-page px-1 text-sm text-ink outline-none"
    />
  );
}

type DropZone = "before" | "inside" | "after";

/**
 * The wiki tree in the sidebar: folders and pages nested to any depth. Right-click for actions, hover
 * "+" to add inside, drag to reorder or move into a folder, F2 / double-click to rename.
 */
export function SidebarDocTree({ ws, onNavigate }: { ws: Workspace; onNavigate?: () => void }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { data: tree = [] } = useQuery(orpc.doc.tree.queryOptions({ input: { workspaceId: ws.id } }));
  const renamingId = useUi((s) => s.renamingDocId);
  const { forNode, createEntries } = useDocActions(ws);
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(`mado.tree.${ws.id}`) ?? "{}");
    } catch {
      return {};
    }
  });
  const [drag, setDrag] = useState<{ id: string; over: string | null; zone: DropZone | null } | null>(null);
  const kids = useMemo(() => childrenMap(tree), [tree]);
  const byId = useMemo(() => new Map(tree.map((n) => [n.id, n])), [tree]);
  const activeId = path.match(/\/wiki\/([0-9a-f-]{36})/)?.[1];

  const ancestors = useMemo(() => {
    const set = new Set<string>();
    let cur = activeId ? byId.get(activeId) : undefined;
    for (let i = 0; cur?.parentId && i < MAX_DEPTH; i++) {
      set.add(cur.parentId);
      cur = byId.get(cur.parentId);
    }
    return set;
  }, [byId, activeId]);

  const setOpenState = (id: string, value: boolean) => {
    setOpen((prev) => {
      const next = { ...prev, [id]: value };
      try {
        localStorage.setItem(`mado.tree.${ws.id}`, JSON.stringify(next));
      } catch {}
      return next;
    });
  };
  // A node created inside a collapsed folder should be visible right away.
  useEffect(() => {
    const created = renamingId ? byId.get(renamingId) : undefined;
    if (created?.parentId) setOpenState(created.parentId, true);
    // biome-ignore lint/correctness/useExhaustiveDependencies: only when a new rename target appears
  }, [renamingId, byId]);

  const expandable = (n: DocNode) => n.kind === "folder" || n.hasChildren;
  const isOpen = (n: DocNode) => open[n.id] ?? ancestors.has(n.id);

  const zoneFor = (e: DragEvent<HTMLElement>, n: DocNode): DropZone => {
    const r = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    // Folders take drops in their middle half; pages only near the centre so reordering stays easy.
    const inside = n.kind === "folder" ? [0.25, 0.75] : [0.35, 0.65];
    return y < inside[0]! ? "before" : y > inside[1]! ? "after" : "inside";
  };

  const drop = (target: DocNode, zone: DropZone) => {
    const id = drag?.id;
    setDrag(null);
    if (!id || id === target.id || descendants(tree, id).has(target.id)) return;
    if (zone === "inside") {
      setOpenState(target.id, true);
      moveDocTo(ws.id, id, target.id);
      return;
    }
    const siblings = (kids.get(target.parentId) ?? []).filter((n) => n.id !== id);
    const idx = siblings.findIndex((n) => n.id === target.id);
    const before = zone === "before" ? target.id : (siblings[idx + 1]?.id ?? null);
    moveDocTo(ws.id, id, target.parentId, before);
  };

  const row = (node: DocNode, depth: number): ReactNode => {
    const exp = expandable(node);
    const opened = exp && isOpen(node);
    const active = activeId === node.id;
    const over = drag && drag.over === node.id ? drag.zone : null;
    const icon = node.kind === "folder" ? opened ? <FolderOpen /> : <Folder /> : <FileText />;
    return (
      <div key={node.id}>
        <ContextArea entries={forNode(node)}>
          <div
            draggable={renamingId !== node.id}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", node.title);
              setDrag({ id: node.id, over: null, zone: null });
            }}
            onDragEnd={() => setDrag(null)}
            onDragOver={(e) => {
              if (!drag || drag.id === node.id) return;
              e.preventDefault();
              const zone = zoneFor(e, node);
              if (drag.over !== node.id || drag.zone !== zone) setDrag({ ...drag, over: node.id, zone });
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (over) drop(node, over);
            }}
            onDoubleClick={() => setUi({ renamingDocId: node.id })}
            onKeyDown={(e) => {
              if (e.key === "F2") {
                e.preventDefault();
                setUi({ renamingDocId: node.id });
              }
            }}
            className={cn(
              "group/row relative flex h-8 items-center gap-1 rounded-md pr-1 text-sm font-medium text-ink-muted hover:bg-state-hover",
              active && "bg-state-selected text-ink hover:bg-state-selected",
              over === "inside" && "bg-state-selected ring-1 ring-accent",
              drag?.id === node.id && "opacity-40",
            )}
            style={{ paddingLeft: 4 + depth * 14 }}
          >
            {over === "before" && <span className="pointer-events-none absolute inset-x-1 -top-px h-0.5 rounded-full bg-accent" />}
            {over === "after" && <span className="pointer-events-none absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-accent" />}
            <button
              type="button"
              tabIndex={-1}
              aria-label={opened ? "Collapse" : "Expand"}
              onClick={() => exp && setOpenState(node.id, !opened)}
              className={cn("flex size-4 shrink-0 items-center justify-center rounded-sm text-ink-faint hover:text-ink", !exp && "invisible")}
            >
              <ChevronRight className={cn("size-3 transition-transform duration-150", opened && "rotate-90")} />
            </button>
            <span className={cn("flex size-4 shrink-0 items-center justify-center [&_svg]:size-4", active ? "text-ink" : "text-ink-subtle")}>{icon}</span>
            {renamingId === node.id ? (
              <RenameInput ws={ws} node={node} onDone={() => setUi({ renamingDocId: null })} />
            ) : (
              <Link
                to="/$ws/wiki/$docId"
                params={{ ws: ws.slug, docId: node.id }}
                draggable={false}
                onClick={() => {
                  if (node.kind === "folder" && !opened) setOpenState(node.id, true);
                  onNavigate?.();
                }}
                className="flex h-full min-w-0 flex-1 items-center truncate pl-1 outline-none"
              >
                <span className="truncate">{node.title || "Untitled"}</span>
              </Link>
            )}
            {renamingId !== node.id && (
              <ActionMenu
                entries={createEntries(node.id).map((e) => ("label" in e ? { ...e, label: `${e.label} inside` } : e))}
                align="start"
                trigger={
                  <button
                    type="button"
                    aria-label={`Add inside ${node.title}`}
                    className="hidden size-6 shrink-0 items-center justify-center rounded-md text-ink-subtle hover:bg-state-active hover:text-ink focus-visible:flex group-hover/row:flex data-[popup-open]:flex max-md:flex [&_svg]:size-4"
                  >
                    <Plus />
                  </button>
                }
              />
            )}
          </div>
        </ContextArea>
        {opened && depth < MAX_DEPTH && (
          <div>
            {(kids.get(node.id) ?? []).map((c) => row(c, depth + 1))}
            {node.kind === "folder" && (kids.get(node.id) ?? []).length === 0 && (
              <div className="flex h-7 items-center text-label text-ink-faint" style={{ paddingLeft: 4 + (depth + 1) * 14 + 22 }}>
                Empty
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const roots = kids.get(null) ?? [];
  return (
    <ContextArea entries={createEntries(null)} className="flex min-h-10 flex-1 flex-col gap-px">
      {roots.map((n) => row(n, 0))}
      {/* Dropping below the last row moves a node to the end of the top level. */}
      <div
        className={cn("min-h-6 flex-1 rounded-md", drag?.over === "__root" && "ring-1 ring-accent")}
        onDragOver={(e) => {
          if (!drag) return;
          e.preventDefault();
          if (drag.over !== "__root") setDrag({ ...drag, over: "__root", zone: null });
        }}
        onDrop={(e) => {
          e.preventDefault();
          const id = drag?.id;
          setDrag(null);
          if (id) moveDocTo(ws.id, id, null);
        }}
      />
    </ContextArea>
  );
}

/** "+" next to the Pages heading: new page or folder at the top level. */
export function NewDocMenu({ ws, className }: { ws: Workspace; className?: string }) {
  const { createEntries } = useDocActions(ws);
  return (
    <ActionMenu
      entries={createEntries(null)}
      align="end"
      trigger={
        <button type="button" aria-label="New page or folder" className={cn("flex size-6 items-center justify-center rounded-md text-ink-subtle hover:bg-state-active hover:text-ink [&_svg]:size-4", className)}>
          <Plus />
        </button>
      }
    />
  );
}

