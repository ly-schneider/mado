import type { DocNode, Priority, TaskStatus, TaskSummary, TaskType } from "@mado/contract";
import { PRIORITY_LABEL } from "@mado/contract";
import { Button, Chips, cn, IconButton, Kbd, MadoMark, Menu, PriorityIcon, Segmented, Spinner, StatusIcon } from "@mado/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Calendar, ChevronsUpDown, Sparkles, X, Zap } from "@mado/ui/fluent";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { client, errorMessage, orpc, queryClient } from "../../lib/orpc";
import { modKey } from "../../lib/platform";
import { shortDate } from "../../lib/time";
import { toast } from "../../lib/toast";
import { useMe, useWorkspace } from "../../lib/workspace";
import { type AssigneeOption, createTask, STATUS_LABEL, useAssigneeOptions, useLabels } from "./data";
import { type CaptureToken, parseDue, parsePriority, scanTokens, stripTokens, withCriteria } from "./parse";
import { PickerPopover, type PickerTarget } from "./pickers";
import { AssigneeAvatar, Pill } from "./TaskBits";

export type CaptureKind = "task" | "note" | "lead";

interface Explicit {
  status?: TaskStatus;
  priority?: Priority;
  assignee?: TaskSummary["assignee"];
  labels?: TaskSummary["labels"];
  epic?: TaskSummary["epic"];
  dueDate?: string | null;
}

function lastProject(): string | null {
  try {
    return localStorage.getItem("mado.capture.project");
  } catch {
    return null;
  }
}

/**
 * The capture panel from Desktop 30:721 and the iOS 35:186 sheet. Inline tokens in the title
 * (#label !priority @assignee ^due) set properties as you type and render dimmed.
 */
export function CapturePanel({
  kind,
  setKind,
  initialProjectId,
  initialStatus,
  onClose,
  variant,
}: {
  kind: CaptureKind;
  setKind: (k: CaptureKind) => void;
  initialProjectId?: string;
  initialStatus?: string;
  onClose: () => void;
  variant: "panel" | "sheet";
}) {
  const ws = useWorkspace();
  const me = useMe().data;
  const navigate = useNavigate();
  const [projectId, setProjectId] = useState(() => {
    const ids = ws.projects.map((p) => p.id);
    const pick = [initialProjectId, lastProject()].find((id) => id && ids.includes(id));
    return pick ?? ws.projects[0]?.id ?? "";
  });
  const project = ws.projects.find((p) => p.id === projectId);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [explicit, setExplicit] = useState<Explicit>(() => ({ status: (initialStatus as TaskStatus) || undefined }));
  const [type, setType] = useState<TaskType>("task");
  const [docIds, setDocIds] = useState<string[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const labels = useLabels(projectId);
  const epics = useQuery({ ...orpc.task.epics.queryOptions({ input: { projectId } }), enabled: !!projectId && kind === "task" });
  const assignees = useAssigneeOptions();
  const ai = useQuery({ ...orpc.settings.ai.queryOptions(), staleTime: 300_000 });
  // Warm the cache that predictKey reads, so the optimistic key is right on first open.
  useQuery({ ...orpc.task.list.queryOptions({ input: { projectId } }), enabled: !!projectId && kind === "task" });

  const tokens = useMemo(() => (kind === "task" ? scanTokens(title) : []), [title, kind]);
  const resolved = useMemo(() => {
    const out: { token: CaptureToken; ok: boolean }[] = [];
    const tLabels: TaskSummary["labels"] = [];
    let priority: Priority | undefined;
    let assignee: AssigneeOption | undefined;
    let due: string | undefined;
    for (const t of tokens) {
      const v = t.value.toLowerCase();
      if (t.kind === "label") {
        const all = labels.data ?? [];
        const l = all.find((x) => x.name.toLowerCase() === v) ?? all.find((x) => x.name.toLowerCase().startsWith(v));
        if (l && !tLabels.some((x) => x.id === l.id)) tLabels.push({ id: l.id, name: l.name, color: l.color });
        out.push({ token: t, ok: !!l });
      } else if (t.kind === "priority") {
        const p = parsePriority(v);
        if (p) priority = p;
        out.push({ token: t, ok: !!p });
      } else if (t.kind === "assignee") {
        const a =
          v === "me"
            ? assignees.find((x) => x.type === "user" && x.id === me?.id)
            : (assignees.find((x) => x.name.toLowerCase().split(" ")[0] === v) ??
              assignees.find((x) => x.name.toLowerCase().startsWith(v) || x.initials?.toLowerCase() === v));
        if (a) assignee = a;
        out.push({ token: t, ok: !!a });
      } else {
        const d = parseDue(v);
        if (d) due = d;
        out.push({ token: t, ok: !!d });
      }
    }
    return { out, labels: tLabels, priority, assignee, due };
  }, [tokens, labels.data, assignees, me?.id]);

  const draft: PickerTarget & { dueDate: string | null } = {
    projectId,
    status: explicit.status ?? "todo",
    priority: resolved.priority ?? explicit.priority ?? "none",
    assignee: resolved.assignee ? { type: resolved.assignee.type, id: resolved.assignee.id, name: resolved.assignee.name, initials: resolved.assignee.initials } : (explicit.assignee ?? null),
    labels: [...(explicit.labels ?? []), ...resolved.labels.filter((l) => !explicit.labels?.some((x) => x.id === l.id))],
    epic: explicit.epic ?? null,
    dueDate: resolved.due ?? explicit.dueDate ?? null,
  };
  const pick = (_: unknown, optimistic: Partial<TaskSummary>) => setExplicit((e) => ({ ...e, ...optimistic }));
  const okTokens = resolved.out.filter((r) => r.ok).map((r) => r.token);
  const cleanTitle = kind === "task" ? stripTokens(title, okTokens) : title.trim();

  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  useLayoutEffect(() => {
    const el = notesRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [details]);

  const chooseProject = (id: string) => {
    setProjectId(id);
    setExplicit((e) => ({ status: e.status }));
    try {
      localStorage.setItem("mado.capture.project", id);
    } catch {}
  };

  const runDraft = async () => {
    if (!ai.data?.hasKey || kind !== "task" || !project) return;
    const sentence = (cleanTitle || title).trim();
    if (sentence.length < 3) return toast("Write a sentence first, then draft");
    setDrafting(true);
    try {
      const d = await client.task.draft({ projectId: project.id, sentence: [sentence, details].filter(Boolean).join("\n\n") });
      setTitle(d.title);
      setDetails(withCriteria(d.description, d.acceptanceCriteria));
      setType(d.type);
      const all = labels.data ?? [];
      const epic = epics.data?.find((e) => e.id === d.epicId);
      setExplicit((e) => ({
        ...e,
        priority: d.priority,
        labels: all.filter((l) => d.labelIds.includes(l.id)).map((l) => ({ id: l.id, name: l.name, color: l.color })),
        epic: epic ? { id: epic.id, key: epic.key, title: epic.title } : null,
      }));
      setDocIds(d.docIds);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setDrafting(false);
    }
  };

  const submit = async (openAfter: boolean) => {
    if (!cleanTitle || !project || saving) return;
    if (kind === "task") {
      const pending = createTask({
        projectId: project.id,
        projectKey: project.key,
        title: cleanTitle,
        description: details.trim() || undefined,
        status: draft.status,
        priority: draft.priority,
        type,
        assignee: draft.assignee,
        labels: draft.labels,
        epic: draft.epic,
        dueDate: draft.dueDate,
        docIds: docIds.length ? docIds : undefined,
      });
      if (!openAfter) {
        onClose();
        const saved = await pending;
        if (saved) toast(`Created ${saved.key}`, { action: { label: "Open", run: () => navigate({ to: "/$ws/t/$taskKey", params: { ws: ws.slug, taskKey: saved.key } }) } });
        return;
      }
      setSaving(true);
      const saved = await pending;
      setSaving(false);
      if (!saved) return;
      onClose();
      navigate({ to: "/$ws/t/$taskKey", params: { ws: ws.slug, taskKey: saved.key } });
      return;
    }
    setSaving(true);
    try {
      if (kind === "note") {
        const tree = queryClient.getQueryData<DocNode[]>(orpc.doc.tree.queryKey({ input: { workspaceId: ws.id } }));
        let inbox = tree?.find((n) => n.parentId === null && n.title.toLowerCase() === "inbox")?.id ?? null;
        if (!inbox) inbox = (await client.doc.resolveTitle({ workspaceId: ws.id, title: "Inbox" }).catch(() => null))?.id ?? null;
        const node = await client.doc.create({ workspaceId: ws.id, projectId: project.id, parentId: inbox, title: cleanTitle, content: details, clientId: crypto.randomUUID() });
        void queryClient.invalidateQueries({ queryKey: orpc.doc.tree.key() });
        onClose();
        if (openAfter) navigate({ to: "/$ws/wiki/$docId", params: { ws: ws.slug, docId: node.id } });
        else toast(`Saved “${node.title}”${inbox ? " to Inbox" : ""}`, { action: { label: "Open", run: () => navigate({ to: "/$ws/wiki/$docId", params: { ws: ws.slug, docId: node.id } }) } });
      } else {
        const lead = await client.crm.create({ projectId: project.id, company: { name: cleanTitle, location: "", details: "" }, notes: details, stage: "new", source: "", clientId: crypto.randomUUID() });
        void queryClient.invalidateQueries({ queryKey: orpc.crm.list.key() });
        onClose();
        const go = () => navigate({ to: "/$ws/p/$key/leads", params: { ws: ws.slug, key: project.key }, search: { lead: lead.id } });
        if (openAfter) go();
        else toast(`Added lead ${lead.company.name}`, { action: { label: "Open", run: go } });
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === "Enter") {
      e.preventDefault();
      void submit(true);
    } else if (mod && e.key.toLowerCase() === "j") {
      e.preventDefault();
      void runDraft();
    }
  };

  const sheet = variant === "sheet";
  const placeholder = kind === "task" ? (sheet ? "What needs doing?" : "Task title  #label !priority @assignee ^due") : kind === "note" ? "Note title" : "Company name";

  const kindSwitch = (
    <Segmented
      value={kind}
      onChange={setKind}
      options={[
        { value: "task", label: "Task" },
        { value: "note", label: "Note" },
        { value: "lead", label: "Lead" },
      ]}
    />
  );

  const projectSwitch = (
    <Menu.Root>
      <Menu.Trigger
        className={cn(
          "flex shrink-0 items-center gap-1.5 rounded-md border border-edge bg-raised px-2.5 text-sm text-ink outline-none hover:bg-state-hover data-[popup-open]:bg-state-active",
          sheet ? "h-9 rounded-lg" : "h-8",
        )}
      >
        {project?.name}
        <span className="text-ink-subtle">{project?.key}</span>
        {!sheet && <ChevronsUpDown className="size-4 text-ink-subtle" />}
      </Menu.Trigger>
      <Menu.Popup align={sheet ? "start" : "end"}>
        {ws.projects.map((p) => (
          <Menu.Item key={p.id} selected={p.id === projectId} onClick={() => chooseProject(p.id)}>
            {p.name} <span className="ml-1 text-ink-subtle">{p.key}</span>
          </Menu.Item>
        ))}
      </Menu.Popup>
    </Menu.Root>
  );

  const pills = kind === "task" && (
    <>
      <PickerPopover kind="status" target={draft} onChange={pick} label="Status">
        <Pill touch={sheet}>
          <StatusIcon status={draft.status} />
          {STATUS_LABEL[draft.status]}
        </Pill>
      </PickerPopover>
      <PickerPopover kind="priority" target={draft} onChange={pick} label="Priority">
        <Pill touch={sheet} className={cn(draft.priority === "none" && "text-ink-subtle")}>
          <PriorityIcon priority={draft.priority} />
          {draft.priority === "none" ? "Priority" : PRIORITY_LABEL[draft.priority]}
        </Pill>
      </PickerPopover>
      {!sheet && (
        <>
          <PickerPopover kind="labels" target={draft} onChange={pick} label="Labels">
            <Pill className={cn(!draft.labels.length && "text-ink-subtle")}>
              <span className="size-1.5 rounded-full bg-ink-subtle" />
              {draft.labels.length ? draft.labels.map((l) => l.name).join(", ") : "Label"}
            </Pill>
          </PickerPopover>
          <PickerPopover kind="assignee" target={draft} onChange={pick} label="Assignee">
            <Pill className={cn(!draft.assignee && "text-ink-subtle")}>
              <AssigneeAvatar assignee={draft.assignee} size="xs" />
              {draft.assignee ? draft.assignee.name.split(" ")[0] : "Assignee"}
            </Pill>
          </PickerPopover>
          {(draft.epic || (epics.data?.length ?? 0) > 0) && (
            <PickerPopover kind="epic" target={draft} onChange={pick} label="Epic">
              <Pill className={cn(!draft.epic && "text-ink-subtle")}>
                <Zap />
                {draft.epic ? draft.epic.key : "Epic"}
              </Pill>
            </PickerPopover>
          )}
          {draft.dueDate && (
            <Pill>
              <Calendar />
              {shortDate(draft.dueDate)}
            </Pill>
          )}
        </>
      )}
    </>
  );

  const titleField = (
    <div className={cn("relative", sheet ? "text-[24px] font-semibold leading-8" : "text-title")}>
      {/* Mirror behind a transparent textarea: the only way to dim the tokens while keeping native editing. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 whitespace-pre-wrap break-words text-ink">
        {renderTokens(title, resolved.out)}
        {"​"}
      </div>
      <textarea
        ref={titleRef}
        autoFocus
        rows={1}
        value={title}
        spellCheck={false}
        onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
            e.preventDefault();
            void submit(false);
          }
        }}
        placeholder={placeholder}
        aria-label="Title"
        className="relative block w-full resize-none overflow-hidden whitespace-pre-wrap break-words bg-transparent text-transparent caret-accent outline-none placeholder:font-normal placeholder:text-ink-faint"
      />
    </div>
  );

  const aiButton = ai.data?.hasKey && kind === "task" && (
    <button
      type="button"
      onClick={runDraft}
      disabled={drafting}
      className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-label font-medium text-ink-muted hover:bg-state-hover hover:text-ink disabled:opacity-60"
    >
      {drafting ? <Spinner className="size-3.5" /> : <Sparkles className="size-3.5" />}
      Draft with AI
      {!sheet && <Kbd>{modKey}J</Kbd>}
    </button>
  );

  if (sheet) {
    return (
      <div className="flex h-full flex-col" onKeyDown={onKeyDown}>
        <div className="flex h-14 shrink-0 items-center justify-between px-3">
          <IconButton label="Close" size="touch" className="rounded-full text-ink-muted [&_svg]:size-5" onClick={onClose}>
            <X />
          </IconButton>
          <Button size="touch" variant="primary" className="h-9 rounded-full px-5" disabled={!cleanTitle} loading={saving} onClick={() => submit(false)}>
            Add
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-3">
          {titleField}
          <textarea
            ref={notesRef}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="Notes…"
            rows={1}
            aria-label="Notes"
            className="mt-2 block w-full resize-none overflow-hidden bg-transparent text-touch text-ink-muted outline-none placeholder:text-ink-faint"
          />
          <Chips
            value={kind}
            onChange={setKind}
            className="-mx-5 mt-6 px-5"
            options={[
              { value: "task", label: "Task" },
              { value: "lead", label: "Lead" },
              { value: "note", label: "Note" },
            ]}
          />
          <div className="-mx-5 mt-3 flex gap-2 overflow-x-auto border-t border-edge px-5 pt-4">
            {projectSwitch}
            {pills}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div onKeyDown={onKeyDown}>
      <div className="flex items-center gap-3 px-4 pt-3">
        <MadoMark className="h-[14px] w-4 text-ink" />
        {kindSwitch}
        <div className="flex-1" />
        {aiButton}
        {projectSwitch}
      </div>
      <div className="px-4 pb-4 pt-4">
        {titleField}
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="Add details in Markdown…"
          rows={details ? Math.min(10, details.split("\n").length + 1) : 1}
          className="mt-1 block w-full resize-none bg-transparent text-sm text-ink-muted outline-none placeholder:text-ink-faint"
        />
      </div>
      <div className="flex min-h-[52px] flex-wrap items-center gap-1.5 border-t border-edge px-4 py-2.5">
        {pills}
        <Button variant="primary" size="sm" className="ml-auto" kbd="↵" disabled={!cleanTitle} loading={saving} onClick={() => submit(false)}>
          Create
        </Button>
      </div>
    </div>
  );
}

function renderTokens(text: string, tokens: { token: CaptureToken; ok: boolean }[]) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const { token, ok } of [...tokens].sort((a, b) => a.token.start - b.token.start)) {
    if (!ok) continue;
    parts.push(text.slice(at, token.start));
    parts.push(
      <span key={token.start} className="text-ink-subtle">
        {text.slice(token.start, token.end)}
      </span>,
    );
    at = token.end;
  }
  parts.push(text.slice(at));
  return parts;
}
