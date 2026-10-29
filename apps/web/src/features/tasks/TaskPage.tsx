import type { TaskDetail, TaskSummary, TaskType } from "@mado/contract";
import { PRIORITY_LABEL } from "@mado/contract";
import { ActionMenu, cn, EmptyState, IconButton, PriorityIcon, Spinner, StatusIcon } from "@mado/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useRouter } from "@tanstack/react-router";
import { ArrowUp, Bug, Check, ChevronLeft, CircleCheck, Ellipsis, FileText, GitBranch, Link2, RotateCcw, Share, Zap } from "@mado/ui/fluent";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { orpc } from "../../lib/orpc";
import { useCommands } from "../../lib/shortcuts";
import { pushRecent } from "../../lib/ui";
import { useMe, useProjectForTaskKey, useWorkspace } from "../../lib/workspace";
import { MobileNavTitle, PageHeader } from "../shell/PageHeader";
import { ACTIVE_FIRST, branchName, copyText, findCachedTaskByKey, groupByStatus, shortSession, STATUS_LABEL, taskUrl, updateTask, useProjectTasks, noOverlay, docLabel } from "./data";
import { useTaskActions } from "./actions";
import { applyToTask, PickerHost, PickerPopover, useTaskHotkeys } from "./pickers";
import { Activity, CommentCard, CommentComposer, Description, EditableTitle, Linked, postComment, RevertSessionDialog } from "./TaskDetailParts";
import { AssigneeAvatar, Pill } from "./TaskBits";

export function TaskPage() {
  const { taskKey } = useParams({ from: "/$ws/t/$taskKey" });
  const key = taskKey.toUpperCase();
  const ws = useWorkspace();
  const navigate = useNavigate();
  const project = useProjectForTaskKey(key);
  const cached = useMemo(() => findCachedTaskByKey(key), [key]);
  const detail = useQuery(orpc.task.get.queryOptions({ input: { key } }));
  const task: TaskDetail | undefined = detail.data;
  const summary: TaskSummary | undefined = task ?? cached;
  const list = useProjectTasks(project?.id);
  const editDescription = useRef<(() => void) | null>(null);
  const focusComment = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (task) pushRecent({ type: "task", id: task.id, title: task.title, ref: task.key });
  }, [task?.id]);

  const ordered = useMemo(() => {
    const groups = groupByStatus((list.data ?? []).filter((t) => t.type !== "epic"), ACTIVE_FIRST);
    return ACTIVE_FIRST.flatMap((s) => groups.get(s) ?? []);
  }, [list.data]);
  const index = ordered.findIndex((t) => t.key === key);
  const go = (dir: 1 | -1) => {
    const next = ordered[index + dir];
    if (next) navigate({ to: "/$ws/t/$taskKey", params: { ws: ws.slug, taskKey: next.key }, replace: true });
  };
  const branch = summary ? branchName(summary.key, summary.title) : "";
  const backToTasks = () => project && navigate({ to: "/$ws/p/$key/tasks", params: { ws: ws.slug, key: project.key } });

  useCommands(
    summary
      ? [
          { id: "task.next", title: "Next task", keys: "j", hint: "J", group: "Navigation", run: () => go(1) },
          { id: "task.prev", title: "Previous task", keys: "k", hint: "K", group: "Navigation", run: () => go(-1) },
          { id: "task.back", title: "Back to tasks", keys: "Escape", group: "Navigation", run: backToTasks, when: noOverlay },
          { id: "task.edit", title: "Edit description", keys: "e", hint: "E", group: "Tasks", run: () => editDescription.current?.() },
          { id: "task.comment", title: "Comment", keys: "m", hint: "M", group: "Tasks", run: () => focusComment.current?.() },
          { id: "task.copyLink", title: "Copy link", keys: "$mod+Shift+Comma", hint: "⌘⇧,", group: "Tasks", global: true, run: () => copyText(taskUrl(ws.slug, summary.key), "link") },
          { id: "task.copyBranch", title: "Copy git branch name", keys: "$mod+Shift+Period", hint: "⌘⇧.", group: "Tasks", global: true, run: () => copyText(branch, "branch name") },
          { id: "task.copyKey", title: `Copy ${summary.key}`, group: "Tasks", run: () => copyText(summary.key, "key") },
        ]
      : [],
    [summary?.id, summary?.title, index, ordered.length],
  );
  useTaskHotkeys(() => summary, { onDeleted: backToTasks }, [summary]);

  if (detail.isError && !summary) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader crumbs={[{ label: ws.name }, { label: key }]} mobileBack />
        <EmptyState icon={<CircleCheck />} title={`${key} not found`}>
          It may have been deleted. Deleted tasks stay in the trash for 30 days.
        </EmptyState>
      </div>
    );
  }

  const crumbs = [
    { label: "Tasks", to: "/$ws/p/$key/tasks", params: { ws: ws.slug, key: project?.key ?? key.split("-")[0]! } },
    { label: key },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader crumbs={crumbs} mobile={false}>
        <div className="flex items-center">
          <IconButton label="Copy link" size="sm" onClick={() => summary && copyText(taskUrl(ws.slug, summary.key), "link")}>
            <Link2 />
          </IconButton>
          {summary && <TaskMenu task={summary} detail={task} onDeleted={backToTasks} />}
        </div>
      </PageHeader>

      {!summary ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : (
        <>
          <div className="hidden min-h-0 flex-1 overflow-y-auto md:block">
            <div className="mx-auto max-w-[936px] px-6 pb-16 pt-8">
              <EditableTitle key={summary.id} task={summary} />
              <TaskPills task={summary} className="mt-3" />
              {task ? (
                <>
                  <div className="mt-4">
                    <Description task={task} editRef={editDescription} />
                  </div>
                  <div className="mt-8">
                    <Linked task={task} />
                  </div>
                  {task.children.length > 0 && <EpicChildren tasks={task.children} />}
                  <div className="mt-8">
                    <Activity task={task} />
                  </div>
                  <div className="mt-4">
                    <CommentComposer task={task} focusRef={focusComment} />
                  </div>
                </>
              ) : (
                <div className="mt-6 flex flex-col gap-2">
                  <div className="h-4 w-3/4 rounded bg-raised" />
                  <div className="h-4 w-1/2 rounded bg-raised" />
                </div>
              )}
            </div>
          </div>
          <TaskPhone task={summary} detail={task} branch={branch} />
        </>
      )}
      <PickerHost />
    </div>
  );
}

/** Status, priority, assignee, labels and epic as one wrapping row of pills, each opening its picker. */
function TaskPills({ task, touch, className }: { task: TaskSummary; touch?: boolean; className?: string }) {
  const onChange = applyToTask(task);
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {task.type !== "task" && (
        <Pill touch={touch}>
          {task.type === "bug" ? <Bug /> : <Zap />}
          {task.type === "bug" ? "Bug" : "Epic"}
        </Pill>
      )}
      <PickerPopover kind="status" target={task} onChange={onChange}>
        <Pill touch={touch}>
          <StatusIcon status={task.status} />
          {STATUS_LABEL[task.status]}
        </Pill>
      </PickerPopover>
      <PickerPopover kind="priority" target={task} onChange={onChange}>
        <Pill touch={touch}>
          <PriorityIcon priority={task.priority} />
          {PRIORITY_LABEL[task.priority]}
        </Pill>
      </PickerPopover>
      <PickerPopover kind="assignee" target={task} onChange={onChange}>
        <Pill touch={touch}>
          <AssigneeAvatar assignee={task.assignee} size="xs" />
          {task.assignee?.name ?? "Assign"}
        </Pill>
      </PickerPopover>
      {touch ? (
        <PickerPopover kind="labels" target={task} onChange={onChange}>
          <Pill touch>{task.labels.length ? task.labels.map((l) => l.name).join(" · ") : "Labels"}</Pill>
        </PickerPopover>
      ) : (
        <PickerPopover kind="labels" target={task} onChange={onChange} className="flex flex-wrap gap-2">
          {task.labels.length ? (
            task.labels.map((l) => (
              <Pill key={l.id}>
                <span className="size-1.5 rounded-full bg-ink-subtle" />
                {l.name}
              </Pill>
            ))
          ) : (
            <Pill className="text-ink-subtle">Labels</Pill>
          )}
        </PickerPopover>
      )}
      {!touch && task.type !== "epic" && (
        <PickerPopover kind="epic" target={task} onChange={onChange}>
          <Pill className={cn(!task.epic && "text-ink-subtle")}>
            <Zap />
            {task.epic ? (
              <>
                {task.epic.key}
                <span className="font-normal text-ink-subtle">{task.epic.title}</span>
              </>
            ) : (
              "Epic"
            )}
          </Pill>
        </PickerPopover>
      )}
    </div>
  );
}

function EpicChildren({ tasks }: { tasks: TaskSummary[] }) {
  const ws = useWorkspace();
  const done = tasks.filter((t) => t.status === "done").length;
  return (
    <section className="mt-8">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-base font-semibold text-ink">Tasks in this epic</span>
        <span className="text-label text-ink-subtle">
          {done} of {tasks.length} done
        </span>
      </div>
      <div className="-mx-2">
        {tasks.map((t) => (
          <Link key={t.id} to="/$ws/t/$taskKey" params={{ ws: ws.slug, taskKey: t.key }} className="flex h-9 items-center gap-2.5 rounded-md px-2 text-sm hover:bg-state-hover">
            <StatusIcon status={t.status} />
            <span className="w-16 shrink-0 text-label text-ink-subtle">{t.key}</span>
            <span className="min-w-0 flex-1 truncate text-ink">{t.title}</span>
            <AssigneeAvatar assignee={t.assignee} size="xs" />
          </Link>
        ))}
      </div>
    </section>
  );
}

function TaskMenu({ task, detail, onDeleted, trigger }: { task: TaskSummary; detail?: TaskDetail; onDeleted: () => void; trigger?: React.ReactElement }) {
  const [revertOpen, setRevertOpen] = useState(false);
  const session = detail?.agentAccess?.sessionId;
  const types: { type: TaskType; label: string; icon: ReactNode }[] = [
    { type: "task", label: "Task", icon: <CircleCheck /> },
    { type: "bug", label: "Bug", icon: <Bug /> },
    { type: "epic", label: "Epic", icon: <Zap /> },
  ];
  const entries = useTaskActions(task, {
    onDeleted,
    extra: [
      ...(session ? [{ label: `Revert agent session ${shortSession(session)}`, icon: <RotateCcw />, onSelect: () => setRevertOpen(true) }] : []),
      {
        label: "Convert to",
        icon: task.type === "bug" ? <Bug /> : task.type === "epic" ? <Zap /> : <CircleCheck />,
        children: types.map((t) => ({
          label: t.label,
          icon: t.type === task.type ? <Check /> : t.icon,
          onSelect: () => t.type !== task.type && updateTask(task, { type: t.type }, { type: t.type }),
        })),
      },
    ],
  });
  return (
    <>
      <ActionMenu
        align="end"
        entries={entries}
        trigger={
          trigger ?? (
            <button type="button" aria-label="More" className="inline-flex size-7 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-state-hover hover:text-ink data-[popup-open]:bg-state-active">
              <Ellipsis className="size-4" />
            </button>
          )
        }
      />
      {detail && <RevertSessionDialog task={detail} open={revertOpen} onOpenChange={setRevertOpen} />}
    </>
  );
}

/** iOS 34:213: nav bar, key + epic, title, pills, description, criteria, linked rows, comments, floating composer. */
function TaskPhone({ task, detail, branch }: { task: TaskSummary; detail?: TaskDetail; branch: string }) {
  const ws = useWorkspace();
  const router = useRouter();
  const me = useMe().data;
  const [comment, setComment] = useState("");
  const share = async () => {
    const url = taskUrl(ws.slug, task.key);
    if (navigator.share) {
      try {
        await navigator.share({ title: `${task.key} ${task.title}`, url });
      } catch {}
    } else copyText(url, "link");
  };
  const send = async () => {
    const text = comment.trim();
    if (!text || !me || !detail) return;
    setComment("");
    if (!(await postComment(detail, text, me))) setComment(text);
  };
  const round = "inline-flex size-9 items-center justify-center rounded-full border border-edge bg-raised text-ink-muted active:bg-state-active [&_svg]:size-[18px]";
  return (
    <div className="flex min-h-0 flex-1 flex-col md:hidden">
      <div className="relative flex h-[52px] shrink-0 items-center gap-2 px-4 pt-safe">
        <button type="button" aria-label="Back" onClick={() => router.history.back()} className={round}>
          <ChevronLeft />
        </button>
        <MobileNavTitle>Tasks</MobileNavTitle>
        <div className="flex-1" />
        <button type="button" aria-label="Share" onClick={share} className={round}>
          <Share />
        </button>
        <TaskMenu task={task} detail={detail} onDeleted={() => router.history.back()} trigger={<button type="button" aria-label="More" className={round}><Ellipsis /></button>} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-32">
        <div className="mt-2 flex items-center gap-2 text-label text-ink-subtle">
          <span>{task.key}</span>
          {task.epic && (
            <span className="flex items-center gap-1">
              <Zap className="size-3.5" />
              {task.epic.title}
            </span>
          )}
        </div>
        <EditableTitle key={task.id} task={task} className="mt-1 text-[26px] font-semibold leading-[32px]" />
        <TaskPills task={task} touch className="mt-3" />
        {detail ? (
          <>
            <div className="mt-5">
              <Description task={detail} touch />
            </div>
            <div className="mt-6 divide-y divide-edge overflow-hidden rounded-xl border border-edge bg-panel">
              {detail.linkedDocs.map((d) => (
                <Link key={d.id} to="/$ws/wiki/$docId" params={{ ws: ws.slug, docId: d.id }} className="flex h-12 items-center gap-3 px-3.5 text-base active:bg-state-active">
                  <FileText className="size-4 shrink-0 text-ink-subtle" />
                  <span className="min-w-0 flex-1 truncate text-ink">{docLabel(d)}</span>
                  <span className="text-label text-ink-subtle">doc</span>
                  <ChevronLeft className="size-4 rotate-180 text-ink-faint" />
                </Link>
              ))}
              {detail.git.map((g) => (
                <a key={g.id} href={g.url} target="_blank" rel="noreferrer" className="flex h-12 items-center gap-3 px-3.5 text-base active:bg-state-active">
                  <GitBranch className="size-4 shrink-0 text-ink-subtle" />
                  <span className="min-w-0 flex-1 truncate text-ink-muted">
                    {g.kind === "pr" ? `#${g.externalId}` : g.externalId.slice(0, 7)} {g.title}
                  </span>
                  <ChevronLeft className="size-4 rotate-180 text-ink-faint" />
                </a>
              ))}
              {detail.linkedDocs.length === 0 && detail.git.length === 0 && (
                <button type="button" onClick={() => copyText(branch, "branch name")} className="flex h-12 w-full items-center gap-3 px-3.5 text-left text-base text-ink-subtle">
                  <GitBranch className="size-4" /> {branch}
                </button>
              )}
            </div>
            {detail.comments.length > 0 && (
              <div className="mt-6 flex flex-col gap-3">
                {detail.comments.map((c) => (
                  <CommentCard key={c.id} comment={c} wsSlug={ws.slug} />
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="mt-8 flex justify-center">
            <Spinner />
          </div>
        )}
      </div>
      <div className="fixed inset-x-4 bottom-[max(env(safe-area-inset-bottom),12px)] z-30 flex h-12 items-center gap-2 rounded-full border border-edge bg-overlay/95 pl-4 pr-1.5 backdrop-blur-xl">
        <input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={`Comment on ${task.key}…`}
          className="min-w-0 flex-1 bg-transparent text-touch text-ink outline-none placeholder:text-ink-faint"
        />
        <button type="button" aria-label="Send" onClick={send} disabled={!comment.trim()} className="flex size-9 items-center justify-center rounded-full bg-ink text-on-ink disabled:opacity-40">
          <ArrowUp className="size-[18px]" />
        </button>
      </div>
    </div>
  );
}
