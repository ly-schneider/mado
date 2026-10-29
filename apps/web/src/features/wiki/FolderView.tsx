import type { Doc, DocNode, Workspace } from "@mado/contract";
import { ActionMenu, Button, ContextArea, IconButton } from "@mado/ui";
import { Ellipsis, FileText, Folder, Plus } from "@mado/ui/fluent";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { orpc } from "../../lib/orpc";
import { useCommands } from "../../lib/shortcuts";
import { ago } from "../../lib/time";
import { type Crumb, MobileTitle, PageHeader } from "../shell/PageHeader";
import { childrenMap, renameDoc, useCreateDoc } from "./data";
import { useDocActions } from "./DocTree";

const asNode = (doc: Doc): DocNode => ({
  id: doc.id,
  kind: doc.kind,
  title: doc.title,
  parentId: doc.parentId,
  projectId: doc.projectId,
  sortOrder: 0,
  hasChildren: true,
  updatedAt: doc.updatedAt,
});

/** A folder only groups pages and folders, so opening one lists what's inside instead of an editor. */
export function FolderView({ doc, ws }: { doc: Doc; ws: Workspace }) {
  const { data: tree = [] } = useQuery(orpc.doc.tree.queryOptions({ input: { workspaceId: ws.id } }));
  const items = useMemo(() => childrenMap(tree).get(doc.id) ?? [], [tree, doc.id]);
  const create = useCreateDoc(ws);
  const { forNode, createEntries } = useDocActions(ws);
  const [title, setTitle] = useState(doc.title);
  useEffect(() => setTitle(doc.title), [doc.title]);

  const parent = doc.path.at(-1);
  const crumbs: Crumb[] = [
    parent ? { label: parent.title, to: "/$ws/wiki/$docId", params: { ws: ws.slug, docId: parent.id } } : { label: "Wiki", to: "/$ws/wiki", params: { ws: ws.slug } },
    { label: doc.title || "Untitled" },
  ];

  useCommands(
    [
      { id: "folder.newPage", title: "New page in this folder", keys: "d", hint: "D", group: "Wiki", run: () => create({ parentId: doc.id }) },
      { id: "folder.newFolder", title: "New folder in this folder", keys: "Shift+D", hint: "⇧D", group: "Wiki", run: () => create({ parentId: doc.id, kind: "folder" }) },
    ],
    [doc.id],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        crumbs={crumbs}
        mobileBack
        mobileActions={
          <ActionMenu
            entries={createEntries(doc.id)}
            align="end"
            trigger={
              <IconButton label="Add" size="touch" variant="secondary" className="rounded-full">
                <Plus />
              </IconButton>
            }
          />
        }
      >
        <Button variant="primary" icon={<Plus />} kbd="D" onClick={() => create({ parentId: doc.id })}>
          New page
        </Button>
        <ActionMenu
          entries={forNode(asNode(doc))}
          align="end"
          trigger={
            <IconButton label="Folder actions">
              <Ellipsis />
            </IconButton>
          }
        />
      </PageHeader>
      <MobileTitle title={doc.title || "Untitled"} />
      <ContextArea entries={createEntries(doc.id)} className="min-h-0 flex-1 overflow-y-auto pb-32">
        <div className="mx-auto w-full max-w-[720px] px-4 md:px-6 md:pt-10">
          <input
            value={title}
            aria-label="Folder name"
            disabled={!doc.canEdit}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() !== doc.title && renameDoc(ws.id, doc.id, title)}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="mb-6 hidden w-full bg-transparent text-display font-semibold text-ink outline-none md:block"
          />
          {items.length === 0 ? (
            <p className="py-2 text-sm text-ink-subtle">Empty folder.</p>
          ) : (
            <div className="flex flex-col">
              {items.map((n) => (
                <ContextArea key={n.id} entries={forNode(n)}>
                  <Link
                    to="/$ws/wiki/$docId"
                    params={{ ws: ws.slug, docId: n.id }}
                    className="flex h-10 items-center gap-3 rounded-md px-2 text-sm text-ink hover:bg-state-hover max-md:h-12 max-md:text-base"
                  >
                    <span className="flex size-4 items-center justify-center text-ink-subtle [&_svg]:size-4">{n.kind === "folder" ? <Folder /> : <FileText />}</span>
                    <span className="min-w-0 flex-1 truncate">{n.title || "Untitled"}</span>
                    <span className="shrink-0 text-label text-ink-subtle">{ago(n.updatedAt)}</span>
                  </Link>
                </ContextArea>
              ))}
            </div>
          )}
        </div>
      </ContextArea>
    </div>
  );
}
