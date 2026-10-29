import type { ActivityEntry, Comment, TaskDetail, TaskSummary } from "@mado/contract";
import { Avatar, Badge, Checkbox, cn, Dialog, Button, Kbd, Popover } from "@mado/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FileText, GitBranch, GitCommitHorizontal, GitPullRequest, Plus } from "@mado/ui/fluent";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { client, errorMessage, orpc, queryClient } from "../../lib/orpc";
import { modKey } from "../../lib/platform";
import { ago } from "../../lib/time";
import { toast } from "../../lib/toast";
import { useMe, useWorkspace } from "../../lib/workspace";
import { MarkdownEditor } from "../editor/MarkdownEditor";
import { MarkdownView } from "../editor/MarkdownView";
import { shortSession, updateTask, docLabel } from "./data";
import { splitDescription, toggleCriterion } from "./parse";
import { PickerList } from "./pickers";
import { InlineMd } from "./TaskBits";

function setDetail(key: string, fn: (d: TaskDetail) => TaskDetail) {
  queryClient.setQueryData<TaskDetail>(orpc.task.get.queryKey({ input: { key } }), (old) => (old ? fn(old) : old));
}

// ── Title ───────────────────────────────────────────────────────────────

export function EditableTitle({ task, className }: { task: Pick<TaskSummary, "id" | "key" | "title">; className?: string }) {
  const [value, setValue] = useState(task.title);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setValue(task.title), [task.title]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  const save = () => {
    const next = value.trim();
    if (!next) return setValue(task.title);
    if (next !== task.title) void updateTask(task, { title: next }, { title: next });
  };
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      aria-label="Title"
      onChange={(e) => setValue(e.target.value.replace(/\n/g, ""))}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          setValue(task.title);
          requestAnimationFrame(() => ref.current?.blur());
        }
      }}
      className={cn("block w-full resize-none overflow-hidden bg-transparent text-display text-ink outline-none", className)}
    />
  );
}

// ── Description + acceptance criteria ───────────────────────────────────

export function Description({ task, touch, editRef }: { task: TaskDetail; touch?: boolean; editRef?: React.MutableRefObject<(() => void) | null> }) {
  const ws = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.description);
  const { body, criteria } = useMemo(() => splitDescription(task.description), [task.description]);
  const done = criteria.filter((c) => c.done).length;
  if (editRef) editRef.current = () => setEditing(true);

  useEffect(() => {
    if (!editing) setDraft(task.description);
  }, [task.description, editing]);

  const save = () => {
    setEditing(false);
    if (draft !== task.description) void updateTask(task, { description: draft }, {});
  };

  return (
    <>
      {editing ? (
        <div className="rounded-lg border border-edge bg-panel px-3 py-2">
          <MarkdownEditor
            value={draft}
            onChange={setDraft}
            variant="compact"
            autoFocus
            workspaceId={ws.id}
            onBlur={save}
            onSubmit={save}
            placeholder="Describe the task in Markdown. “- [ ] item” lines become acceptance criteria."
          />
        </div>
      ) : (
        // biome-ignore lint/a11y/useKeyWithClickEvents: E edits from the keyboard
        <div
          className="-mx-2 cursor-text rounded-md px-2 py-0.5 hover:bg-state-hover"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a, button, input")) return;
            setEditing(true);
          }}
        >
          {body ? (
            <MarkdownView markdown={body} wsSlug={ws.slug} workspaceId={ws.id} className={cn(touch && "text-[17px] leading-[26px]")} />
          ) : (
            <p className="text-prose text-ink-faint">Add a description…</p>
          )}
        </div>
      )}
      {criteria.length > 0 && (
        <section className={cn("mt-8", touch && "mt-6")}>
          <h3 className="mb-2 flex items-baseline gap-2">
            <span className="text-base font-semibold text-ink">Acceptance criteria</span>
            <span className="text-label text-ink-subtle">
              {done} of {criteria.length}
            </span>
          </h3>
          <ul className={cn(touch && "divide-y divide-edge")}>
            {criteria.map((c) => (
              <li key={c.line} className={cn("flex min-h-8 items-start gap-3 py-1.5", touch && "min-h-12 items-center py-3")}>
                <Checkbox
                  checked={c.done}
                  size={touch ? "lg" : "md"}
                  label={c.text}
                  className={cn(!touch && "mt-0.5")}
                  onChange={(v) => {
                    const next = toggleCriterion(task.description, c.line, v);
                    void updateTask(task, { description: next }, {});
                  }}
                />
                <InlineMd
                  text={c.text}
                  wsSlug={ws.slug}
                  className={cn("text-base text-ink", c.done && "text-ink-subtle line-through decoration-ink-faint", touch && "text-[17px]")}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

// ── Linked ──────────────────────────────────────────────────────────────

function SectionTitle({ title, meta, action }: { title: string; meta?: ReactNode; action?: ReactNode }) {
  return (
    <div className="group mb-2 flex h-6 items-center gap-2">
      <span className="text-base font-semibold text-ink">{title}</span>
      {meta !== undefined && <span className="truncate text-label text-ink-subtle">{meta}</span>}
      {action && <span className="ml-auto">{action}</span>}
    </div>
  );
}

export function AddDocButton({ task }: { task: TaskDetail }) {
  const ws = useWorkspace();
  const [open, setOpen] = useState(false);
  const tree = useQuery({ ...orpc.doc.tree.queryOptions({ input: { workspaceId: ws.id } }), enabled: open });
  const items = useMemo(() => {
    const byId = new Map((tree.data ?? []).map((n) => [n.id, n]));
    const path = (id: string | null): string => {
      const n = id ? byId.get(id) : undefined;
      return n ? [path(n.parentId), n.title].filter(Boolean).join(" / ") : "";
    };
    return (tree.data ?? []).map((n) => ({ value: n.id, label: n.title || "Untitled", keywords: path(n.parentId), icon: <FileText className="size-4 text-ink-subtle" />, meta: <span className="max-w-24 truncate text-label text-ink-subtle">{path(n.parentId)}</span> }));
  }, [tree.data]);
  const linked = task.linkedDocs.map((d) => d.id);
  const toggle = async (docId: string) => {
    const on = linked.includes(docId);
    const node = tree.data?.find((n) => n.id === docId);
    setDetail(task.key, (d) => ({
      ...d,
      linkedDocs: on ? d.linkedDocs.filter((x) => x.id !== docId) : [...d.linkedDocs, { id: docId, title: node?.title ?? "Untitled", path: node?.title ?? "", lastReadByAgentAt: null }],
    }));
    try {
      if (on) await client.task.unlinkDoc({ taskId: task.id, docId });
      else await client.task.linkDoc({ taskId: task.id, docId });
    } catch (e) {
      toast.error(errorMessage(e));
    }
    void queryClient.invalidateQueries({ queryKey: orpc.task.get.queryKey({ input: { key: task.key } }) });
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger aria-label="Link a doc" className="rounded-md p-1 text-ink-subtle outline-none hover:bg-state-hover hover:text-ink data-[popup-open]:bg-state-active">
        <Plus className="size-4" />
      </Popover.Trigger>
      <Popover.Popup align="end" className="w-80 overflow-hidden">
        {open && <PickerList items={items} selected={linked} multi onPick={toggle} onClose={() => setOpen(false)} placeholder="Link a wiki page…" />}
      </Popover.Popup>
    </Popover.Root>
  );
}

/** Docs first, then commits, PRs and branches, in one list. */
export function Linked({ task }: { task: TaskDetail }) {
  const ws = useWorkspace();
  const count = task.linkedDocs.length + task.git.length;
  return (
    <div className="min-w-0">
      <SectionTitle title="Linked" meta={count || undefined} action={<AddDocButton task={task} />} />
      <div className="-mx-2">
        {count === 0 && <div className="flex h-9 items-center px-2 text-label text-ink-faint">Nothing linked</div>}
        {task.linkedDocs.map((d) => (
          <Link key={d.id} to="/$ws/wiki/$docId" params={{ ws: ws.slug, docId: d.id }} className="flex h-9 items-center gap-2.5 rounded-md px-2 text-sm hover:bg-state-hover">
            <FileText className="size-4 shrink-0 text-ink-subtle" />
            <span className="min-w-0 flex-1 truncate text-ink">{docLabel(d)}</span>
          </Link>
        ))}
        {task.git.map((g) => (
          <a key={g.id} href={g.url} target="_blank" rel="noreferrer" className="flex h-9 items-center gap-2.5 rounded-md px-2 text-sm hover:bg-state-hover">
            {g.kind === "pr" ? <GitPullRequest className="size-4 shrink-0 text-ink-subtle" /> : g.kind === "branch" ? <GitBranch className="size-4 shrink-0 text-ink-subtle" /> : <GitCommitHorizontal className="size-4 shrink-0 text-ink-subtle" />}
            <span className={cn("shrink-0 text-ink-muted", g.kind === "branch" && "min-w-0 flex-1 truncate")}>{g.kind === "pr" ? `#${g.externalId}` : g.kind === "branch" ? g.externalId : g.externalId.slice(0, 7)}</span>
            {g.kind !== "branch" && <span className="min-w-0 flex-1 truncate text-ink-muted">{g.title}</span>}
            {g.state && g.kind === "pr" && <Badge>{g.state}</Badge>}
            <span className="shrink-0 text-label text-ink-subtle">{ago(g.at)}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

// ── Activity + comments ─────────────────────────────────────────────────

export function CommentCard({ comment, wsSlug, children }: { comment: Comment; wsSlug: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-edge bg-panel px-4 py-3">
      <div className="mb-1.5 flex items-center gap-2 text-sm">
        <Avatar type={comment.actor.type} initials={comment.actor.initials} size="sm" />
        <span className="font-medium text-ink">{comment.actor.name}</span>
        {comment.actor.type === "agent" && <Badge>agent</Badge>}
        <span className="text-label text-ink-subtle">{ago(comment.createdAt)}</span>
      </div>
      <MarkdownView markdown={comment.body} wsSlug={wsSlug} className="text-sm leading-[22px]" />
      {children}
    </div>
  );
}

type FeedItem = { kind: "activity"; at: string; entry: ActivityEntry } | { kind: "comment"; at: string; comment: Comment };

export function Activity({ task }: { task: TaskDetail }) {
  const ws = useWorkspace();
  const feed = useMemo<FeedItem[]>(
    () =>
      [
        ...task.activity.map((entry) => ({ kind: "activity" as const, at: entry.createdAt, entry })),
        ...task.comments.map((comment) => ({ kind: "comment" as const, at: comment.createdAt, comment })),
      ].sort((a, b) => a.at.localeCompare(b.at)),
    [task.activity, task.comments],
  );
  return (
    <section>
      <div className="mb-2 flex h-6 items-center">
        <span className="text-base font-semibold text-ink">Activity</span>
      </div>
      <div className="flex flex-col gap-1">
        {feed.map((item) =>
          item.kind === "activity" ? (
            <div key={item.entry.id} className="flex min-h-8 items-center gap-2.5 text-sm">
              <Avatar type={item.entry.actor.type} initials={item.entry.actor.initials} size="sm" />
              <span className="min-w-0 truncate">
                <span className="font-medium text-ink">{item.entry.actor.name}</span> <InlineMd text={item.entry.text} wsSlug={ws.slug} className="text-ink-subtle" />
              </span>
              <span className="shrink-0 text-label text-ink-subtle">{ago(item.entry.createdAt)}</span>
            </div>
          ) : (
            <div key={item.comment.id} className="my-2">
              <CommentCard comment={item.comment} wsSlug={ws.slug} />
            </div>
          ),
        )}
      </div>
    </section>
  );
}

export async function postComment(task: Pick<TaskDetail, "id" | "key">, body: string, me: { id: string; name: string; initials: string }) {
  const tmp: Comment = { id: crypto.randomUUID(), body, actor: { type: "user", id: me.id, name: me.name, initials: me.initials }, sessionId: null, createdAt: new Date().toISOString() };
  setDetail(task.key, (d) => ({ ...d, comments: [...d.comments, tmp] }));
  try {
    const saved = await client.task.comment({ taskId: task.id, body });
    setDetail(task.key, (d) => ({ ...d, comments: d.comments.map((c) => (c.id === tmp.id ? saved : c)) }));
    return true;
  } catch (e) {
    setDetail(task.key, (d) => ({ ...d, comments: d.comments.filter((c) => c.id !== tmp.id) }));
    toast.error(errorMessage(e));
    return false;
  }
}

export function CommentComposer({ task, focusRef }: { task: TaskDetail; focusRef?: React.MutableRefObject<(() => void) | null> }) {
  const me = useMe().data;
  const [body, setBody] = useState("");
  const [active, setActive] = useState(false);
  if (focusRef) focusRef.current = () => setActive(true);
  const submit = async () => {
    const text = body.trim();
    if (!text || !me) return;
    setBody("");
    setActive(false);
    if (!(await postComment(task, text, me))) setBody(text);
  };
  return (
    <div className="flex items-start gap-2 rounded-lg border border-edge bg-panel px-3 py-2 focus-within:border-ink-faint">
      {active || body ? (
        <MarkdownEditor value={body} onChange={setBody} variant="compact" autoFocus placeholder="Leave a comment…" onSubmit={submit} onBlur={() => setActive(false)} className="min-h-16 text-sm" />
      ) : (
        <button type="button" onClick={() => setActive(true)} className="h-7 flex-1 text-left text-sm text-ink-faint">
          Leave a comment…
        </button>
      )}
      <button type="button" onClick={submit} aria-label="Send comment" className="mt-1 flex shrink-0 items-center gap-1 disabled:opacity-50" disabled={!body.trim()}>
        <Kbd>{modKey === "⌘" ? "⌘" : "Ctrl"}</Kbd>
        <Kbd>↵</Kbd>
      </button>
    </div>
  );
}

// ── Agent session revert ────────────────────────────────────────────────

export function RevertSessionDialog({ task, open, onOpenChange }: { task: TaskDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const access = task.agentAccess;
  if (!access?.sessionId) return null;
  const sessionId = access.sessionId;
  const session = shortSession(sessionId);
  const revert = async () => {
    setBusy(true);
    try {
      const r = await client.agents.revertSession({ sessionId });
      toast(`Reverted ${r.reverted} change${r.reverted === 1 ? "" : "s"}${r.skipped ? `, ${r.skipped} skipped` : ""}`);
      void queryClient.invalidateQueries({ queryKey: orpc.task.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.doc.key() });
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Revert session ${session}`} className="max-w-sm">
      <div className="p-5">
        <h2 className="text-base font-semibold text-ink">Revert session {session}?</h2>
        <p className="mt-2 text-sm text-ink-muted">
          Every write {access.agentName} made in this session is undone. Changes someone made on top of them are kept and skipped. Revisions stay in the history.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={revert} autoFocus>
            Revert session
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
