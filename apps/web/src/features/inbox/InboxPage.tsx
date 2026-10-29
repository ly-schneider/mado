import type { Notification, TaskDetail } from "@mado/contract";
import { PRIORITY_LABEL } from "@mado/contract";
import { Avatar, cn, EmptyState, IconButton, PriorityIcon, Spinner, StatusIcon } from "@mado/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Archive, ArrowUpRight, FileText, Inbox, Mail, MailOpen } from "@mado/ui/fluent";
import { useEffect, useMemo, useState } from "react";
import { client, errorMessage, orpc, queryClient } from "../../lib/orpc";
import { useCommands } from "../../lib/shortcuts";
import { ago } from "../../lib/time";
import { toast } from "../../lib/toast";
import { useWorkspace } from "../../lib/workspace";
import { MarkdownView } from "../editor/MarkdownView";
import { MobileTitle, PageHeader } from "../shell/PageHeader";
import { STATUS_LABEL } from "../tasks/data";
import { applyToTask, PickerHost, PickerPopover } from "../tasks/pickers";
import { AssigneeAvatar, Pill } from "../tasks/TaskBits";

type Box = "inbox" | "archived";

function patchInbox(ids: string[], fn: (n: Notification) => Notification | null) {
  queryClient.setQueriesData<Notification[]>({ queryKey: orpc.inbox.list.key() }, (old) =>
    old?.flatMap((n) => {
      if (!ids.includes(n.id)) return [n];
      const next = fn(n);
      return next ? [next] : [];
    }),
  );
}

function bumpUnread(delta: number) {
  queryClient.setQueryData<{ count: number }>(orpc.inbox.unread.queryKey(), (old) => (old ? { count: Math.max(0, old.count + delta) } : old));
}

async function markRead(list: Notification[], read: boolean) {
  const targets = list.filter((n) => !!n.readAt !== read);
  if (!targets.length) return;
  const at = read ? new Date().toISOString() : null;
  patchInbox(
    targets.map((n) => n.id),
    (n) => ({ ...n, readAt: at }),
  );
  bumpUnread(read ? -targets.length : targets.length);
  try {
    await client.inbox.markRead({ ids: targets.map((n) => n.id), read });
  } catch (e) {
    toast.error(errorMessage(e));
    void queryClient.invalidateQueries({ queryKey: orpc.inbox.key() });
  }
}

async function archive(list: Notification[]) {
  if (!list.length) return;
  const unread = list.filter((n) => !n.readAt).length;
  patchInbox(
    list.map((n) => n.id),
    () => null,
  );
  bumpUnread(-unread);
  try {
    await client.inbox.archive({ ids: list.map((n) => n.id) });
    toast(list.length === 1 ? "Archived" : `Archived ${list.length}`);
  } catch (e) {
    toast.error(errorMessage(e));
  }
  void queryClient.invalidateQueries({ queryKey: orpc.inbox.key() });
}

export function InboxPage() {
  const ws = useWorkspace();
  const search = useSearch({ from: "/$ws/inbox" });
  const navigate = useNavigate({ from: "/$ws/inbox" });
  const [box, setBox] = useState<Box>("inbox");
  const query = useQuery(orpc.inbox.list.queryOptions({ input: { workspaceId: ws.id, archived: box === "archived" } }));
  const items = useMemo(() => [...(query.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [query.data]);
  const selected = items.find((n) => n.id === search.n);
  const index = selected ? items.indexOf(selected) : -1;

  const select = (n: Notification | undefined) => {
    navigate({ search: { n: n?.id }, replace: true });
    if (n && !n.readAt && box === "inbox") void markRead([n], true);
  };
  const openEntity = (n: Notification) => {
    if (!n.readAt) void markRead([n], true);
    if (n.entityType === "task") navigate({ to: "/$ws/t/$taskKey", params: { ws: ws.slug, taskKey: n.ref } });
    else if (n.entityType === "doc") navigate({ to: "/$ws/wiki/$docId", params: { ws: ws.slug, docId: n.entityId } });
    else if (n.entityType === "lead") navigate({ to: "/$ws/p/$key/leads", params: { ws: ws.slug, key: ws.projects[0]?.key ?? "" }, search: { lead: n.entityId } });
  };
  const move = (dir: 1 | -1) => {
    if (!items.length) return;
    select(items[index === -1 ? 0 : Math.max(0, Math.min(items.length - 1, index + dir))]);
  };
  const archiveSelected = () => {
    if (!selected) return;
    const next = items[index + 1] ?? items[index - 1];
    void archive([selected]);
    navigate({ search: { n: next?.id }, replace: true });
  };

  const toggleBox = () => {
    setBox(box === "inbox" ? "archived" : "inbox");
    navigate({ search: {}, replace: true });
  };

  useEffect(() => {
    if (selected) document.querySelector(`[data-notification="${selected.id}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected?.id]);

  useCommands(
    [
      { id: "list.down", title: "Move down", keys: "j, ArrowDown", hint: "J", group: "Navigation", run: () => move(1) },
      { id: "list.up", title: "Move up", keys: "k, ArrowUp", hint: "K", group: "Navigation", run: () => move(-1) },
      { id: "list.open", title: "Open", keys: "Enter", hint: "↵", group: "Navigation", run: () => selected && openEntity(selected) },
      { id: "inbox.archive", title: "Archive notification", keys: "e", hint: "E", group: "Actions", run: archiveSelected, when: () => box === "inbox" },
      { id: "inbox.unread", title: "Mark as unread", keys: "u", hint: "U", group: "Actions", run: () => selected && markRead([selected], !selected.readAt) },
      { id: "inbox.readAll", title: "Mark all as read", keys: "Shift+U", group: "Actions", run: () => markRead(items, true) },
      { id: "inbox.archiveRead", title: "Archive all read", group: "Actions", run: () => archive(items.filter((n) => n.readAt)), when: () => box === "inbox" },
      { id: "inbox.box", title: box === "inbox" ? "Show archived" : "Show inbox", keys: "Shift+A", group: "Actions", run: toggleBox },
    ],
    [items, selected, box],
  );

  const unread = items.filter((n) => !n.readAt).length;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumbs={box === "inbox" ? [{ label: "Inbox" }] : [{ label: "Inbox" }, { label: "Archived" }]}
        mobileActions={
          <IconButton label={box === "inbox" ? "Show archived" : "Show inbox"} size="touch" variant="secondary" className="rounded-full" onClick={toggleBox}>
            {box === "inbox" ? <Archive /> : <Inbox />}
          </IconButton>
        }
      >
        <div className="flex items-center">
          {box === "inbox" && (
            <IconButton label="Mark all as read (⇧U)" size="sm" disabled={!unread} onClick={() => markRead(items, true)}>
              <MailOpen />
            </IconButton>
          )}
          <IconButton label={box === "inbox" ? "Show archived (⇧A)" : "Show inbox (⇧A)"} size="sm" onClick={toggleBox}>
            {box === "inbox" ? <Archive /> : <Inbox />}
          </IconButton>
        </div>
      </PageHeader>
      <MobileTitle title={box === "inbox" ? "Inbox" : "Archived"} subtitle={box === "inbox" && unread ? `${unread} unread` : undefined} />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 w-full flex-col md:w-[400px] md:shrink-0 md:border-r md:border-edge xl:w-[440px]">
          <div className="min-h-0 flex-1 overflow-y-auto pb-32 md:pb-4">
            {query.isPending && !query.data ? (
              <div className="flex justify-center py-16">
                <Spinner />
              </div>
            ) : items.length === 0 ? (
              <EmptyState icon={<Inbox />} title={box === "inbox" ? "Inbox zero" : "Nothing archived"} />
            ) : (
              items.map((n) => (
                <NotificationRow
                  key={n.id}
                  n={n}
                  selected={n.id === selected?.id}
                  onClick={() => {
                    if (window.matchMedia("(max-width: 767px)").matches) openEntity(n);
                    else select(n);
                  }}
                  onDoubleClick={() => openEntity(n)}
                />
              ))
            )}
          </div>
        </div>
        <div className="hidden min-w-0 flex-1 md:flex">
          {selected ? (
            <Detail n={selected} onOpen={() => openEntity(selected)} onArchive={box === "inbox" ? archiveSelected : undefined} onToggleRead={() => markRead([selected], !selected.readAt)} />
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState icon={<Inbox />} title={items.length ? "Select a notification" : "No notifications"} />
            </div>
          )}
        </div>
      </div>
      <PickerHost />
    </div>
  );
}

function NotificationRow({ n, selected, onClick, onDoubleClick }: { n: Notification; selected: boolean; onClick: () => void; onDoubleClick: () => void }) {
  return (
    <button
      type="button"
      data-notification={n.id}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn(
        "flex w-full items-start gap-3 border-b border-edge px-4 py-3 text-left hover:bg-state-hover max-md:active:bg-state-active md:border-b-0 md:py-2.5",
        selected && "bg-state-selected hover:bg-state-selected",
      )}
    >
      <Avatar type={n.actor.type} initials={n.actor.initials} size="md" className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-sm", n.readAt ? "text-ink-muted" : "font-medium text-ink")}>{n.title}</span>
          <span className="shrink-0 text-label text-ink-subtle">{ago(n.createdAt)}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-label text-ink-subtle">
            {n.body}
          </span>
          {!n.readAt && <span aria-label="Unread" className="size-2 shrink-0 rounded-full bg-accent" />}
        </span>
      </span>
    </button>
  );
}

function Detail({ n, onOpen, onArchive, onToggleRead }: { n: Notification; onOpen: () => void; onArchive?: () => void; onToggleRead: () => void }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-edge px-6">
        <span className="flex-1 truncate text-sm text-ink-subtle">{n.entityType === "task" ? n.ref : n.entityType === "doc" ? "Page" : n.entityType}</span>
        <IconButton label={n.readAt ? "Mark unread (U)" : "Mark read (U)"} size="sm" onClick={onToggleRead}>
          {n.readAt ? <Mail /> : <MailOpen />}
        </IconButton>
        {onArchive && (
          <IconButton label="Archive (E)" size="sm" onClick={onArchive}>
            <Archive />
          </IconButton>
        )}
        <IconButton label="Open (↵)" size="sm" onClick={onOpen}>
          <ArrowUpRight />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[760px] px-8 py-6">
          <div className="flex items-start gap-3 rounded-lg border border-edge bg-panel px-4 py-3">
            <Avatar type={n.actor.type} initials={n.actor.initials} size="md" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 text-sm">
                <span className="font-medium text-ink">{n.actor.name}</span>
                <span className="text-ink-subtle">{n.title}</span>
                <span className="ml-auto shrink-0 text-label text-ink-subtle">{ago(n.createdAt, { long: true })}</span>
              </div>
              {n.body && <p className="mt-1 text-sm text-ink-muted">{n.body}</p>}
            </div>
          </div>
          <div className="mt-8">
            {n.entityType === "task" ? <TaskPreview taskKey={n.ref} /> : n.entityType === "doc" ? <DocPreview id={n.entityId} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function TaskPreview({ taskKey }: { taskKey: string }) {
  const ws = useWorkspace();
  const q = useQuery(orpc.task.get.queryOptions({ input: { key: taskKey } }));
  const t: TaskDetail | undefined = q.data;
  if (q.isError) return <p className="text-sm text-ink-subtle">This task was deleted.</p>;
  if (!t) return <Spinner />;
  const onChange = applyToTask(t);
  return (
    <div>
      <h2 className="text-display text-ink">{t.title}</h2>
      <div className="mt-4 flex flex-wrap gap-2">
        <PickerPopover kind="status" target={t} onChange={onChange}>
          <Pill>
            <StatusIcon status={t.status} />
            {STATUS_LABEL[t.status]}
          </Pill>
        </PickerPopover>
        <PickerPopover kind="priority" target={t} onChange={onChange}>
          <Pill>
            <PriorityIcon priority={t.priority} />
            {PRIORITY_LABEL[t.priority]}
          </Pill>
        </PickerPopover>
        <PickerPopover kind="assignee" target={t} onChange={onChange}>
          <Pill>
            <AssigneeAvatar assignee={t.assignee} size="xs" />
            {t.assignee?.name ?? "Unassigned"}
          </Pill>
        </PickerPopover>
      </div>
      {t.description && <MarkdownView markdown={t.description} wsSlug={ws.slug} workspaceId={ws.id} className="mt-6" />}
    </div>
  );
}

function DocPreview({ id }: { id: string }) {
  const ws = useWorkspace();
  const q = useQuery(orpc.doc.get.queryOptions({ input: { id } }));
  if (q.isError) return <p className="text-sm text-ink-subtle">This page was deleted.</p>;
  if (!q.data) return <Spinner />;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-label text-ink-subtle">
        <FileText className="size-4" />
        {q.data.path.map((p) => p.title).join(" / ") || "Wiki"}
      </div>
      <h2 className="text-display text-ink">{q.data.title}</h2>
      <MarkdownView markdown={q.data.content.slice(0, 4000)} wsSlug={ws.slug} workspaceId={ws.id} className="mt-4" />
    </div>
  );
}
