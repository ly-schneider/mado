import type { SearchResults } from "@mado/contract";
import { STATUS_LABEL, STAGE_LABEL } from "@mado/contract";
import { Dialog, Kbd } from "@mado/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Command as Cmdk } from "cmdk";
import { Briefcase, CircleCheck, CornerDownLeft, FileText, History, Search } from "@mado/ui/fluent";
import { type ReactNode, useDeferredValue, useEffect, useMemo, useState } from "react";
import { orpc } from "../../lib/orpc";
import { type Command, useCommandList } from "../../lib/shortcuts";
import { getRecent, pushRecent, setUi, useUi } from "../../lib/ui";
import { useWorkspace } from "../../lib/workspace";

type Filter = "all" | "tasks" | "docs" | "leads" | "actions";
const FILTERS: Filter[] = ["all", "tasks", "docs", "leads", "actions"];

/** Bold the matched words, as in the Web 04 design. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const words = query.trim().split(/\s+/).filter((w) => w.length > 1);
  if (words.length === 0) return <>{text}</>;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return (
    <>
      {text.split(re).map((part, i) =>
        re.test(part) ? (
          <strong key={i} className="font-semibold text-ink">
            {part}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function Row({ value, onSelect, icon, children, meta, kbd }: { value: string; onSelect: () => void; icon: ReactNode; children: ReactNode; meta?: ReactNode; kbd?: string }) {
  return (
    <Cmdk.Item
      value={value}
      onSelect={onSelect}
      className="flex h-8 cursor-default items-center gap-2.5 rounded-md px-3 text-sm text-ink data-[selected=true]:bg-state-selected [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ink-subtle"
    >
      {icon}
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="truncate text-ink-muted">{children}</span>
        {meta && <span className="shrink-0 truncate text-label text-ink-subtle">{meta}</span>}
      </span>
      {kbd && <Kbd>{kbd}</Kbd>}
    </Cmdk.Item>
  );
}

function Group({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <Cmdk.Group
      heading={heading}
      className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-label [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-subtle"
    >
      {children}
    </Cmdk.Group>
  );
}

/** Commands that open this palette; listing them inside it is noise. */
const SELF = new Set(["palette", "search.slash"]);

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const initial = useUi((s) => s.paletteQuery);
  const ws = useWorkspace();
  const navigate = useNavigate();
  const commands = useCommandList();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const deferred = useDeferredValue(query.trim());

  useEffect(() => {
    if (open) {
      setQuery(initial);
      setFilter("all");
    }
  }, [open, initial]);

  const close = () => setUi({ paletteOpen: false });

  const types = filter === "all" ? undefined : filter === "actions" ? [] : [filter];
  const search = useQuery({
    ...orpc.search.query.queryOptions({ input: { workspaceId: ws.id, q: deferred, types: types as ("tasks" | "docs" | "leads")[] | undefined, limit: 6 } }),
    enabled: open && deferred.length > 0 && filter !== "actions",
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
  const results: SearchResults | undefined = deferred ? search.data : undefined;

  const actions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = commands.filter((c) => !c.id.startsWith("list.") && !SELF.has(c.id) && (!c.when || c.when()));
    const seen = new Set<string>();
    const unique = list.filter((c) => (seen.has(c.title) ? false : (seen.add(c.title), true)));
    if (!q) return unique.filter((c) => c.group === "Actions").slice(0, 4);
    return unique.filter((c) => `${c.title} ${c.subtitle ?? ""} ${c.group}`.toLowerCase().includes(q)).slice(0, 8);
  }, [commands, query]);

  const recent = !query.trim() ? getRecent().filter((r) => r.type !== "query").slice(0, 5) : [];

  const go = (fn: () => void) => {
    close();
    fn();
  };
  const openTask = (key: string, title: string, id: string) =>
    go(() => {
      pushRecent({ type: "task", id, title, ref: key });
      navigate({ to: "/$ws/t/$taskKey", params: { ws: ws.slug, taskKey: key } });
    });
  const openDoc = (id: string, title: string) =>
    go(() => {
      pushRecent({ type: "doc", id, title, ref: id });
      navigate({ to: "/$ws/wiki/$docId", params: { ws: ws.slug, docId: id } });
    });
  const openLead = (id: string, title: string) => {
    const key = ws.projects[0]?.key ?? "";
    go(() => {
      pushRecent({ type: "lead", id, title, ref: id });
      navigate({ to: "/$ws/p/$key/leads", params: { ws: ws.slug, key }, search: { view: "list", lead: id } });
    });
  };
  const runCommand = (c: Command) => go(() => c.run());

  const show = (f: Filter) => filter === "all" || filter === f;

  return (
    <Dialog open={open} onOpenChange={(o) => setUi({ paletteOpen: o })} position="top" title="Command palette" className="max-w-[640px]">
      <Cmdk
        shouldFilter={false}
        loop
        data-palette-open
        onKeyDown={(e) => {
          if (e.key === "Tab") {
            e.preventDefault();
            const i = FILTERS.indexOf(filter);
            setFilter(FILTERS[(i + (e.shiftKey ? FILTERS.length - 1 : 1)) % FILTERS.length]!);
          }
        }}
        className="flex max-h-[min(560px,70dvh)] flex-col"
      >
        <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-edge px-4">
          <Search className="size-4 shrink-0 text-ink-subtle" />
          <Cmdk.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="Search tasks, docs and leads, or type a command…"
            className="h-full min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-faint max-md:text-touch"
          />
          {filter !== "all" && <span className="rounded-md bg-state-selected px-2 py-0.5 text-label font-medium capitalize text-ink">{filter}</span>}
        </div>
        <Cmdk.List className="min-h-0 flex-1 overflow-y-auto p-2">
          <Cmdk.Empty className="px-3 py-6 text-center text-sm text-ink-subtle">
            {search.isFetching ? "Searching…" : `Nothing found for “${query}”`}
          </Cmdk.Empty>

          {recent.length > 0 && filter === "all" && (
            <Group heading="Recent">
              {recent.map((r) => (
                <Row
                  key={`r-${r.type}-${r.id}`}
                  value={`recent-${r.type}-${r.id}`}
                  icon={r.type === "task" ? <CircleCheck /> : r.type === "doc" ? <FileText /> : <History />}
                  onSelect={() => (r.type === "task" ? openTask(r.ref, r.title, r.id) : r.type === "doc" ? openDoc(r.id, r.title) : openLead(r.id, r.title))}
                  meta={r.type === "task" ? r.ref : undefined}
                >
                  {r.title}
                </Row>
              ))}
            </Group>
          )}

          {results && show("tasks") && results.tasks.length > 0 && (
            <Group heading="Tasks">
              {results.tasks.map((t) => (
                <Row
                  key={t.id}
                  value={`task-${t.id}`}
                  icon={<CircleCheck />}
                  onSelect={() => openTask(t.key, t.title, t.id)}
                  meta={[STATUS_LABEL[t.status], t.assignee?.name, t.snippet && `mentions ${deferred}`].filter(Boolean).join(" · ")}
                >
                  <span className="text-ink-subtle">{t.key}</span>
                  <span className="ml-2 text-ink">
                    <Highlight text={t.title} query={deferred} />
                  </span>
                </Row>
              ))}
            </Group>
          )}

          {results && show("docs") && results.docs.length > 0 && (
            <Group heading="Docs">
              {results.docs.map((d) => (
                <Row
                  key={d.id}
                  value={`doc-${d.id}`}
                  icon={<FileText />}
                  onSelect={() => openDoc(d.id, d.title)}
                  meta={[d.path, d.snippet && `“${d.snippet}”`].filter(Boolean).join(" · ")}
                >
                  <span className="text-ink">
                    <Highlight text={d.title} query={deferred} />
                  </span>
                </Row>
              ))}
            </Group>
          )}

          {results && show("leads") && results.leads.length > 0 && (
            <Group heading="Leads">
              {results.leads.map((l) => (
                <Row key={l.id} value={`lead-${l.id}`} icon={<Briefcase />} onSelect={() => openLead(l.id, l.company)} meta={[l.contact, STAGE_LABEL[l.stage]].filter(Boolean).join(" · ")}>
                  <span className="text-ink">
                    <Highlight text={l.company} query={deferred} />
                  </span>
                </Row>
              ))}
            </Group>
          )}

          {show("actions") && actions.length > 0 && (
            <Group heading="Actions">
              {actions.map((c) => (
                <Row key={c.id} value={`cmd-${c.id}`} icon={c.icon ?? <CornerDownLeft />} onSelect={() => runCommand(c)} meta={c.subtitle ?? (c.hint && c.hint.includes(" ") ? c.hint : undefined)} kbd={c.hint?.length === 1 ? c.hint : undefined}>
                  <span className="text-ink">{c.title}</span>
                </Row>
              ))}
            </Group>
          )}
        </Cmdk.List>
      </Cmdk>
    </Dialog>
  );
}
