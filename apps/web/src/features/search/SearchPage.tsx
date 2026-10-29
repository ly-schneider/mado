import { STAGE_LABEL, STATUS_LABEL } from "@mado/contract";
import { Chips, cn, StatusIcon } from "@mado/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Briefcase, FileText, History, Search, X } from "@mado/ui/fluent";
import { type ReactNode, useDeferredValue, useEffect, useRef, useState } from "react";
import { orpc } from "../../lib/orpc";
import { useCommands } from "../../lib/shortcuts";
import { ago } from "../../lib/time";
import { getRecent, pushRecent } from "../../lib/ui";
import { useWorkspace } from "../../lib/workspace";
import { Highlight } from "../palette/CommandPalette";
import { MobileTitle, PageHeader } from "../shell/PageHeader";

type Filter = "all" | "tasks" | "docs" | "leads";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "tasks", label: "Tasks" },
  { value: "docs", label: "Docs" },
  { value: "leads", label: "Leads" },
];

/** iOS 35:351. On wider screens the same page, centred under the header. */
export function SearchPage() {
  const ws = useWorkspace();
  const navigate = useNavigate({ from: "/$ws/search" });
  const search = useSearch({ from: "/$ws/search" });
  const [q, setQ] = useState(search.q ?? "");
  const [filter, setFilter] = useState<Filter>("all");
  const [active, setActive] = useState(0);
  const deferred = useDeferredValue(q.trim());
  const inputRef = useRef<HTMLInputElement>(null);
  const [recent, setRecent] = useState(() => getRecent());

  useEffect(() => {
    const t = setTimeout(() => navigate({ search: { q: deferred || undefined }, replace: true }), 300);
    return () => clearTimeout(t);
  }, [deferred]);

  const results = useQuery({
    ...orpc.search.query.queryOptions({ input: { workspaceId: ws.id, q: deferred, types: filter === "all" ? undefined : [filter], limit: 20 } }),
    enabled: deferred.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
  const data = deferred ? results.data : undefined;

  const remember = () => {
    if (!deferred) return;
    pushRecent({ type: "query", id: deferred.toLowerCase(), title: deferred, ref: deferred });
    setRecent(getRecent());
  };
  const openTask = (key: string, title: string, id: string) => {
    remember();
    pushRecent({ type: "task", id, title, ref: key });
    navigate({ to: "/$ws/t/$taskKey", params: { ws: ws.slug, taskKey: key } });
  };
  const openDoc = (id: string, title: string) => {
    remember();
    pushRecent({ type: "doc", id, title, ref: id });
    navigate({ to: "/$ws/wiki/$docId", params: { ws: ws.slug, docId: id } });
  };
  const openLead = (id: string, title: string) => {
    remember();
    pushRecent({ type: "lead", id, title, ref: id });
    navigate({ to: "/$ws/p/$key/leads", params: { ws: ws.slug, key: ws.projects[0]?.key ?? "" }, search: { lead: id } });
  };

  const flat: (() => void)[] = [];
  if (data) {
    for (const t of data.tasks) flat.push(() => openTask(t.key, t.title, t.id));
    for (const d of data.docs) flat.push(() => openDoc(d.id, d.title));
    for (const l of data.leads) flat.push(() => openLead(l.id, l.company));
  }
  useEffect(() => setActive(0), [deferred, filter]);

  useCommands([{ id: "search.focus", title: "Focus search", keys: "/", group: "Navigation", run: () => inputRef.current?.focus() }], []);

  let i = -1;
  const row = (key: string, icon: ReactNode, title: ReactNode, sub: ReactNode, run: () => void) => {
    i += 1;
    const idx = i;
    return (
      <button
        key={key}
        type="button"
        onClick={run}
        onMouseMove={() => setActive(idx)}
        className={cn("flex w-full gap-3 px-4 py-2.5 text-left active:bg-state-active md:rounded-md md:px-3", active === idx && "md:bg-state-selected")}
      >
        <span className="flex size-5 shrink-0 items-center justify-center pt-0.5 text-ink-subtle [&_svg]:size-4">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base text-ink">{title}</span>
          <span className="block truncate text-label text-ink-subtle">{sub}</span>
        </span>
      </button>
    );
  };
  const groupTitle = (label: string) => <div className="flex h-8 items-end px-4 pb-1 text-label font-medium text-ink-subtle md:px-3">{label}</div>;
  const snippet = (s: string | null) => (s ? <>“<Highlight text={s} query={deferred} />”</> : null);
  const recentQueries = recent.filter((r) => r.type === "query").slice(0, 6);
  const empty = data && data.tasks.length + data.docs.length + data.leads.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader crumbs={[{ label: "Search" }]} />
      <MobileTitle title="Search" />
      <div className="mx-auto flex w-full max-w-[720px] shrink-0 flex-col gap-3 px-4 pb-3 md:pt-6">
        <div className="flex items-center gap-3">
          <div className="flex h-touch flex-1 items-center gap-2 rounded-lg border border-edge bg-panel px-3 focus-within:border-accent md:h-10">
            <Search className="size-4 shrink-0 text-ink-subtle" />
            <input
              ref={inputRef}
              autoFocus
              type="search"
              enterKeyHint="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(flat.length - 1, a + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(0, a - 1));
                } else if (e.key === "Enter") {
                  if (flat[active]) flat[active]!();
                  else remember();
                } else if (e.key === "Escape") inputRef.current?.blur();
              }}
              placeholder="Search tasks, docs and leads"
              className="h-full min-w-0 flex-1 bg-transparent text-touch text-ink outline-none placeholder:text-ink-faint md:text-base [&::-webkit-search-cancel-button]:hidden"
            />
            {q && (
              <button type="button" aria-label="Clear" onClick={() => setQ("")} className="text-ink-faint hover:text-ink">
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>
        <Chips value={filter} onChange={setFilter} options={FILTERS} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-36 md:pb-8">
        <div className="mx-auto w-full max-w-[720px] md:px-1">
          {!deferred && (
            <>
              {recentQueries.length > 0 && groupTitle("Recent")}
              {recentQueries.map((r) => (
                <button key={r.id} type="button" onClick={() => setQ(r.ref)} className="flex h-11 w-full items-center gap-3 px-4 text-left text-base text-ink active:bg-state-active md:px-3">
                  <History className="size-4 text-ink-subtle" />
                  {r.title}
                </button>
              ))}
            </>
          )}
          {data && data.tasks.length > 0 && (
            <section>
              {groupTitle("Tasks")}
              {data.tasks.map((t) =>
                row(
                  t.id,
                  <StatusIcon status={t.status} />,
                  <Highlight text={t.title} query={deferred} />,
                  <>
                    {t.key} · {t.snippet ? snippet(t.snippet) : [STATUS_LABEL[t.status], t.assignee?.name].filter(Boolean).join(" · ")}
                  </>,
                  () => openTask(t.key, t.title, t.id),
                ),
              )}
            </section>
          )}
          {data && data.docs.length > 0 && (
            <section>
              {groupTitle("Docs")}
              {data.docs.map((d) =>
                row(
                  d.id,
                  <FileText />,
                  <Highlight text={d.title} query={deferred} />,
                  <>
                    {d.path || "Wiki"} · {d.snippet ? snippet(d.snippet) : `edited ${ago(d.updatedAt, { long: true })}`}
                  </>,
                  () => openDoc(d.id, d.title),
                ),
              )}
            </section>
          )}
          {data && data.leads.length > 0 && (
            <section>
              {groupTitle("Leads")}
              {data.leads.map((l) =>
                row(
                  l.id,
                  <Briefcase />,
                  <Highlight text={l.company} query={deferred} />,
                  <>{l.snippet ? snippet(l.snippet) : [l.contact, STAGE_LABEL[l.stage]].filter(Boolean).join(" · ")}</>,
                  () => openLead(l.id, l.company),
                ),
              )}
            </section>
          )}
          {empty && <p className="px-4 py-10 text-center text-sm text-ink-subtle">Nothing found for “{deferred}”</p>}
        </div>
      </div>
    </div>
  );
}
