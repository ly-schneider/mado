import type { DocNode } from "@mado/contract";
import { Button, cn, EmptyState, IconButton, Input, Segmented, Spinner } from "@mado/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { BookOpen, ChevronRight, FileText, Folder, FolderOpen, Plus, Search, Star } from "@mado/ui/fluent";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { orpc } from "../../lib/orpc";
import { useCommands, useListNavigation } from "../../lib/shortcuts";
import { ago } from "../../lib/time";
import { useWorkspace } from "../../lib/workspace";
import { MobileTitle, PageHeader } from "../shell/PageHeader";
import { childrenMap, useCreateDoc } from "./data";

type Row = { node: DocNode; depth: number; open: boolean };

function useExpanded(key: string) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "{}");
    } catch {
      return {};
    }
  });
  const toggle = (id: string, value?: boolean) =>
    setOpen((prev) => {
      const next = { ...prev, [id]: value ?? !prev[id] };
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {}
      return next;
    });
  return [open, toggle] as const;
}

function SectionTitle({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <div className="flex items-center gap-1.5 px-2 pb-1.5 text-label">
      <span className="font-medium text-ink-subtle">{children}</span>
      {count !== undefined && <span className="text-ink-faint">{count}</span>}
    </div>
  );
}

export function WikiIndexPage() {
  const ws = useWorkspace();
  const { project: projectKey } = useSearch({ from: "/$ws/wiki" });
  const navigate = useNavigate();
  const project = ws.projects.find((p) => p.key === projectKey);
  const createDoc = useCreateDoc(ws);
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const [expanded, toggle] = useExpanded(`mado.wikiIndex.${ws.id}`);
  const { data: tree, isPending } = useQuery(orpc.doc.tree.queryOptions({ input: { workspaceId: ws.id } }));
  const { data: favorites = [] } = useQuery(orpc.doc.favorites.queryOptions({ input: { workspaceId: ws.id } }));

  const scoped = useMemo(() => (tree ?? []).filter((n) => !project || n.projectId === project.id), [tree, project]);
  const byId = useMemo(() => new Map(scoped.map((n) => [n.id, n])), [scoped]);
  const parentTitle = (n: DocNode) => (n.parentId ? (byId.get(n.parentId)?.title ?? "") : (ws.projects.find((p) => p.id === n.projectId)?.name ?? "Workspace"));

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const kids = childrenMap(scoped);
    let keep: Set<string> | null = null;
    if (q) {
      keep = new Set();
      for (const n of scoped) {
        if (!n.title.toLowerCase().includes(q)) continue;
        for (let cur: DocNode | undefined = n; cur && !keep.has(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined) keep.add(cur.id);
      }
    }
    const out: Row[] = [];
    const walk = (pid: string | null, depth: number) => {
      for (const node of kids.get(pid) ?? []) {
        if (keep && !keep.has(node.id)) continue;
        const open = keep ? true : !!expanded[node.id];
        out.push({ node, depth, open });
        if (node.hasChildren && open) walk(node.id, depth + 1);
      }
    };
    // Pages whose parent is outside the project scope still need a root.
    const roots = scoped.filter((n) => !n.parentId || !byId.has(n.parentId));
    const rootIds = new Set(roots.map((r) => r.id));
    for (const pid of new Set(roots.map((r) => r.parentId))) {
      for (const node of kids.get(pid) ?? []) {
        if (!rootIds.has(node.id) || (keep && !keep.has(node.id))) continue;
        const open = keep ? true : !!expanded[node.id];
        out.push({ node, depth: 0, open });
        if (node.hasChildren && open) walk(node.id, 1);
      }
    }
    return out;
  }, [scoped, byId, q, expanded]);

  const recent = useMemo(() => (q ? [] : [...scoped].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5)), [scoped, q]);
  const favs = useMemo(() => (q ? [] : favorites.filter((f) => !project || f.projectId === project.id)), [favorites, project, q]);
  const nav = rows.map((r) => r.node);

  useEffect(() => setCurrent(-1), [q, projectKey]);
  const open = (n: DocNode) => navigate({ to: "/$ws/wiki/$docId", params: { ws: ws.slug, docId: n.id } });
  useListNavigation(nav, current, setCurrent, open);
  useCommands(
    [
      { id: "wiki.new", title: "New page", subtitle: project ? `in ${project.name}` : undefined, keys: "d", hint: "D", group: "Wiki", run: () => createDoc({ projectId: project?.id }) },
      { id: "wiki.filter", title: "Filter pages", keys: "Shift+F", hint: "⇧F", group: "Wiki", run: () => searchRef.current?.focus() },
      {
        id: "wiki.toggle",
        title: "Expand or collapse page",
        keys: "ArrowRight, ArrowLeft",
        group: "Wiki",
        run: () => {
          const r = rows[current];
          if (r?.node.hasChildren) toggle(r.node.id);
        },
      },
    ],
    [project?.id, rows, current],
  );

  const pageCount = scoped.length;
  const segmented =
    ws.projects.length > 1 ? (
      <Segmented
        size="sm"
        value={project?.key ?? "__all"}
        onChange={(v) => navigate({ to: "/$ws/wiki", params: { ws: ws.slug }, search: { project: v === "__all" ? undefined : v } })}
        options={[{ value: "__all", label: "All" }, ...ws.projects.map((p) => ({ value: p.key, label: p.name }))]}
      />
    ) : null;

  const pageRow = (n: DocNode, opts: { meta?: ReactNode; icon?: ReactNode; key: string }) => (
    <Link
      key={opts.key}
      to="/$ws/wiki/$docId"
      params={{ ws: ws.slug, docId: n.id }}
      className="flex h-8 items-center gap-2.5 rounded-md px-2 text-sm text-ink-muted outline-none hover:bg-state-hover active:bg-state-active max-md:h-11 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ink-subtle"
    >
      {opts.icon ?? <FileText />}
      <span className="truncate text-ink">{n.title || "Untitled"}</span>
      <span className="truncate text-label text-ink-faint">{parentTitle(n)}</span>
      <span className="ml-auto shrink-0 pl-3 text-label text-ink-subtle">{opts.meta ?? ago(n.updatedAt)}</span>
    </Link>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumbs={[{ label: project?.name ?? ws.name }, { label: "Wiki" }]}
        center={segmented}
        mobileActions={
          <IconButton label="New page" size="touch" variant="secondary" className="rounded-full" onClick={() => createDoc({ projectId: project?.id })}>
            <Plus className="size-[18px]" />
          </IconButton>
        }
      >
        <Input
          ref={searchRef}
          icon={<Search />}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQuery("");
              e.currentTarget.blur();
            }
            if (e.key === "ArrowDown" || e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
              if (e.key === "Enter" && nav.length > 0) open(nav[Math.max(0, current)]!);
              else setCurrent(0);
            }
          }}
          placeholder="Filter pages"
          className="w-56"
        />
        <Button variant="primary" icon={<Plus />} kbd="D" onClick={() => createDoc({ projectId: project?.id })}>
          New page
        </Button>
      </PageHeader>
      <MobileTitle title="Wiki" subtitle={`${project?.name ?? ws.name} · ${pageCount} ${pageCount === 1 ? "page" : "pages"}`} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[880px] flex-col gap-8 px-2 pb-32 pt-2 md:px-6 md:pt-8">
          <div className="hidden items-end justify-between px-2 md:flex">
            <div>
              <h1 className="text-display text-ink">Wiki</h1>
              <p className="mt-1 text-sm text-ink-subtle">
                {project?.name ?? `All of ${ws.name}`} · {pageCount} {pageCount === 1 ? "page" : "pages"}
              </p>
            </div>
          </div>
          <div className="px-2 md:hidden">
            <Input touch icon={<Search />} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter pages" />
          </div>

          {isPending ? (
            <div className="flex justify-center py-16">
              <Spinner />
            </div>
          ) : pageCount === 0 ? (
            <EmptyState icon={<BookOpen />} title="No pages yet">
              <span className="mb-3 block">Architecture notes, decisions and runbooks live here, in plain Markdown that agents read too.</span>
              <Button variant="primary" icon={<Plus />} kbd="D" onClick={() => createDoc({ projectId: project?.id })}>
                New page
              </Button>
            </EmptyState>
          ) : (
            <>
              {favs.length > 0 && (
                <section>
                  <SectionTitle count={favs.length}>Favorites</SectionTitle>
                  {favs.map((n) => pageRow(n, { key: n.id, icon: <Star className="fill-current" /> }))}
                </section>
              )}
              {recent.length > 0 && (
                <section>
                  <SectionTitle>Recently edited</SectionTitle>
                  {recent.map((n) => pageRow(n, { key: n.id, meta: ago(n.updatedAt, { long: true }) }))}
                </section>
              )}
              <section>
                <SectionTitle count={q ? rows.filter((r) => r.node.title.toLowerCase().includes(q)).length : pageCount}>
                  {q ? "Matching pages" : "All pages"}
                </SectionTitle>
                {rows.length === 0 && <div className="px-2 py-6 text-sm text-ink-subtle">No page title contains “{query.trim()}”.</div>}
                {rows.map((r, i) => (
                  <TreeRow
                    key={r.node.id}
                    row={r}
                    selected={i === current}
                    query={q}
                    wsSlug={ws.slug}
                    onToggle={() => toggle(r.node.id)}
                    onAdd={() => {
                      toggle(r.node.id, true);
                      createDoc({ parentId: r.node.id });
                    }}
                    onHover={() => setCurrent(i)}
                  />
                ))}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Highlighted({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const i = text.toLowerCase().indexOf(query);
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <strong className="font-semibold text-ink">{text.slice(i, i + query.length)}</strong>
      {text.slice(i + query.length)}
    </>
  );
}

function TreeRow({
  row,
  selected,
  query,
  wsSlug,
  onToggle,
  onAdd,
  onHover,
}: {
  row: Row;
  selected: boolean;
  query: string;
  wsSlug: string;
  onToggle: () => void;
  onAdd: () => void;
  onHover: () => void;
}) {
  const { node, depth, open } = row;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const icon = node.hasChildren ? open ? <FolderOpen /> : <Folder /> : <FileText />;
  return (
    <div
      ref={ref}
      onMouseMove={onHover}
      className={cn(
        "group relative flex h-8 items-center rounded-md hover:bg-state-hover max-md:h-11 [&_svg]:size-4 [&_svg]:shrink-0",
        selected && "bg-state-active hover:bg-state-active",
      )}
      style={{ paddingLeft: depth * 20 }}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={open ? "Collapse" : "Expand"}
        onClick={onToggle}
        className={cn("flex size-6 items-center justify-center rounded text-ink-faint hover:text-ink", !node.hasChildren && "invisible")}
      >
        <ChevronRight className={cn(open && "rotate-90")} />
      </button>
      <Link
        to="/$ws/wiki/$docId"
        params={{ ws: wsSlug, docId: node.id }}
        className="flex h-full min-w-0 flex-1 items-center gap-2.5 pr-2 text-sm text-ink-muted outline-none [&_svg]:text-ink-subtle"
      >
        {icon}
        <span className="truncate">
          <Highlighted text={node.title || "Untitled"} query={query} />
        </span>
        <span className="ml-auto shrink-0 pl-3 text-label text-ink-subtle group-hover:hidden">{ago(node.updatedAt)}</span>
      </Link>
      <IconButton label="New sub-page" size="sm" className="mr-1 hidden size-6 group-hover:inline-flex" onClick={onAdd}>
        <Plus />
      </IconButton>
    </div>
  );
}
