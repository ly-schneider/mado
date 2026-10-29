import type { TaskDetail, TaskSummary, TaskType } from "@mado/contract";
import { PRIORITY_LABEL } from "@mado/contract";
import { Avatar, Badge, cn, EmptyState, IconButton, Kbd, LabelChip, Menu, PriorityIcon, Spinner, StatusIcon } from "@mado/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useRouter } from "@tanstack/react-router";
import { ArrowUp, Bug, ChevronLeft, CircleCheck, Copy, Ellipsis, FileText, GitBranch, Link2, Share, Trash2, Zap } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { orpc } from "../../lib/orpc";
import { useCommands } from "../../lib/shortcuts";
import { shortDate } from "../../lib/time";
import { pushRecent } from "../../lib/ui";
import { useMe, useProjectForTaskKey, useWorkspace } from "../../lib/workspace";
import { PageHeader } from "../shell/PageHeader";
import { ACTIVE_FIRST, branchName, copyText, deleteTask, findCachedTaskByKey, groupByStatus, STATUS_LABEL, taskUrl, updateTask, useProjectTasks, noOverlay, docLabel } from "./data";
import { applyToTask, PickerHost, PickerPopover, useTaskHotkeys } from "./pickers";
import { Activity, AgentAccess, CommentCard, CommentComposer, Description, Development, EditableTitle, LinkedDocs, postComment } from "./TaskDetailParts";
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
    { label: ws.name },
    { label: "Tasks", to: "/$ws/p/$key/tasks", params: { ws: ws.slug, key: project?.key ?? key.split("-")[0]! } },
    { label: key },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader crumbs={crumbs} className="max-md:hidden">
        {index >= 0 && (
          <span className="flex items-center gap-1.5 text-label text-ink-subtle">
            <span className="mr-0.5 tabular-nums">
              {index + 1} / {ordered.length}
            </span>
            <button type="button" aria-label="Previous task" onClick={() => go(-1)}>
              <Kbd>K</Kbd>
            </button>
            <button type="button" aria-label="Next task" onClick={() => go(1)}>
              <Kbd>J</Kbd>
            </button>
          </span>
        )}
        <div className="flex items-center">
          <IconButton label="Copy link" size="sm" onClick={() => summary && copyText(taskUrl(ws.slug, summary.key), "link")}>
            <Link2 />
          </IconButton>
          <IconButton label={`Copy branch ${branch}`} size="sm" onClick={() => copyText(branch, "branch name")}>
            <GitBranch />
          </IconButton>
          {summary && <TaskMenu task={summary} onDeleted={backToTasks} />}
        </div>
      </PageHeader>

      {!summary ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : (
        <>
          <div className="hidden min-h-0 flex-1 md:flex">
            <div className="min-w-0 flex-1 overflow-y-auto">
              <div className="mx-auto max-w-[900px] px-14 pb-16 pt-8">
                <EpicLine task={summary} />
                <EditableTitle key={summary.id} task={summary} className="mt-2" />
                {task ? (
                  <>
                    <div className="mt-3">
                      <Description task={task} editRef={editDescription} />
                    </div>
                    <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
                      <LinkedDocs task={task} />
                      <Development task={task} branch={branch} />
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
            <aside className="w-[300px] shrink-0 overflow-y-auto border-l border-edge px-5 py-6">
              <Properties task={summary} detail={task} />
              {task?.agentAccess && (
                <div className="mt-4 border-t border-edge pt-4">
                  <AgentAccess task={task} />
                </div>
              )}
            </aside>
          </div>
          <TaskPhone task={summary} detail={task} branch={branch} />
        </>
      )}
      <PickerHost />
    </div>
  );
}

function EpicLine({ task }: { task: TaskSummary }) {
  const ws = useWorkspace();
  if (task.type === "epic") {
    return (
      <div className="flex h-5 items-center gap-2 text-sm text-ink-subtle">
        <Zap className="size-4" /> Epic
      </div>
    );
  }
  if (!task.epic) {
    return <div className="flex h-5 items-center gap-2 text-sm text-ink-subtle">{task.type === "bug" ? <><Bug className="size-4" /> Bug</> : null}</div>;
  }
  return (
    <Link to="/$ws/t/$taskKey" params={{ ws: ws.slug, taskKey: task.epic.key }} className="flex h-5 w-fit items-center gap-2 text-sm text-ink-subtle hover:text-ink">
      <Zap className="size-4" />
      <span>{task.epic.key}</span>
      <span>{task.epic.title}</span>
    </Link>
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
      <div className="divide-y divide-edge overflow-hidden rounded-lg border border-edge">
        {tasks.map((t) => (
          <Link key={t.id} to="/$ws/t/$taskKey" params={{ ws: ws.slug, taskKey: t.key }} className="flex h-9 items-center gap-2.5 px-3 text-sm hover:bg-state-hover">
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

function TaskMenu({ task, onDeleted, trigger }: { task: TaskSummary; onDeleted: () => void; trigger?: ReactNode }) {
  const ws = useWorkspace();
  const convert = (type: TaskType) => updateTask(task, { type }, { type });
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="More"
        className={cn(!trigger && "inline-flex size-7 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-state-hover hover:text-ink data-[popup-open]:bg-state-active")}
        render={trigger ? (trigger as React.ReactElement) : undefined}
      >
        {!trigger && <Ellipsis className="size-4" />}
      </Menu.Trigger>
      <Menu.Popup align="end" className="w-56">
        <Menu.Item icon={<Copy />} onClick={() => copyText(task.key, "key")}>
          Copy {task.key}
        </Menu.Item>
        <Menu.Item icon={<Link2 />} onClick={() => copyText(taskUrl(ws.slug, task.key), "link")}>
          Copy link
        </Menu.Item>
        <Menu.Item icon={<GitBranch />} onClick={() => copyText(branchName(task.key, task.title), "branch name")}>
          Copy branch name
        </Menu.Item>
        <Menu.Separator />
        <Menu.Label>Convert to</Menu.Label>
        <Menu.Item icon={<CircleCheck />} selected={task.type === "task"} onClick={() => convert("task")}>
          Task
        </Menu.Item>
        <Menu.Item icon={<Bug />} selected={task.type === "bug"} onClick={() => convert("bug")}>
          Bug
        </Menu.Item>
        <Menu.Item icon={<Zap />} selected={task.type === "epic"} onClick={() => convert("epic")}>
          Epic
        </Menu.Item>
        <Menu.Separator />
        <Menu.Item
          icon={<Trash2 />}
          danger
          kbd="⌫"
          onClick={async () => {
            if (await deleteTask(task)) onDeleted();
          }}
        >
          Delete
        </Menu.Item>
      </Menu.Popup>
    </Menu.Root>
  );
}

const propValue = "-mx-1.5 flex min-h-[30px] w-[calc(100%+12px)] min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-sm text-ink outline-none hover:bg-state-hover data-[popup-open]:bg-state-active";

function PropRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-h-[34px] grid-cols-[84px_1fr] items-center">
      <span className="text-sm text-ink-subtle">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Properties({ task, detail }: { task: TaskSummary; detail?: TaskDetail }) {
  const project = useProjectForTaskKey(task.key);
  const onChange = applyToTask(task);
  return (
    <div>
      <div className="mb-3 text-sm font-medium text-ink-subtle">Properties</div>
      <PropRow label="Status">
        <PickerPopover kind="status" target={task} onChange={onChange} className={propValue}>
          <StatusIcon status={task.status} />
          {STATUS_LABEL[task.status]}
        </PickerPopover>
      </PropRow>
      <PropRow label="Priority">
        <PickerPopover kind="priority" target={task} onChange={onChange} className={propValue}>
          <PriorityIcon priority={task.priority} />
          {PRIORITY_LABEL[task.priority]}
        </PickerPopover>
      </PropRow>
      <PropRow label="Assignee">
        <PickerPopover kind="assignee" target={task} onChange={onChange} className={propValue}>
          <AssigneeAvatar assignee={task.assignee} size="sm" />
          <span className={cn("truncate", !task.assignee && "text-ink-subtle")}>{task.assignee?.name ?? "Unassigned"}</span>
          {task.assignee?.type === "agent" && <Badge>agent</Badge>}
        </PickerPopover>
      </PropRow>
      <PropRow label="Labels">
        <PickerPopover kind="labels" target={task} onChange={onChange} className={cn(propValue, "flex-wrap py-1")}>
          {task.labels.length ? task.labels.map((l) => <LabelChip key={l.id} name={l.name} className="h-6" />) : <span className="text-ink-subtle">Add labels</span>}
        </PickerPopover>
      </PropRow>
      {task.type !== "epic" && (
        <PropRow label="Epic">
          <PickerPopover kind="epic" target={task} onChange={onChange} className={propValue}>
            {task.epic ? (
              <span className="truncate">
                {task.epic.key} <span className="ml-1">{task.epic.title}</span>
              </span>
            ) : (
              <span className="text-ink-subtle">No epic</span>
            )}
          </PickerPopover>
        </PropRow>
      )}
      <PropRow label="Project">
        <span className="flex items-center gap-1.5 text-sm text-ink">
          {project?.name} <span className="text-ink-subtle">{project?.key}</span>
        </span>
      </PropRow>
      <PropRow label="Created">
        <span className="flex items-center gap-2 text-sm text-ink">
          {detail && <Avatar type={detail.createdBy.type} initials={detail.createdBy.initials} size="xs" />}
          {shortDate(task.createdAt)}
          {detail && ` · ${detail.createdBy.name.split(" ")[0]}`}
        </span>
      </PropRow>
    </div>
  );
}

/** iOS 34:213: nav bar, key + epic, title, pills, description, criteria, linked rows, comments, floating composer. */
function TaskPhone({ task, detail, branch }: { task: TaskSummary; detail?: TaskDetail; branch: string }) {
  const ws = useWorkspace();
  const router = useRouter();
  const me = useMe().data;
  const [comment, setComment] = useState("");
  const onChange = applyToTask(task);
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
      <div className="flex h-[52px] shrink-0 items-center gap-2 px-4 pt-safe">
        <button type="button" aria-label="Back" onClick={() => router.history.back()} className={round}>
          <ChevronLeft />
        </button>
        <div className="flex-1" />
        <button type="button" aria-label="Share" onClick={share} className={round}>
          <Share />
        </button>
        <TaskMenu task={task} onDeleted={() => router.history.back()} trigger={<button type="button" aria-label="More" className={round}><Ellipsis /></button>} />
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
        <div className="mt-3 flex flex-wrap gap-2">
          <PickerPopover kind="status" target={task} onChange={onChange}>
            <Pill touch>
              <StatusIcon status={task.status} />
              {STATUS_LABEL[task.status]}
            </Pill>
          </PickerPopover>
          <PickerPopover kind="priority" target={task} onChange={onChange}>
            <Pill touch>
              <PriorityIcon priority={task.priority} />
              {PRIORITY_LABEL[task.priority]}
            </Pill>
          </PickerPopover>
          <PickerPopover kind="assignee" target={task} onChange={onChange}>
            <Pill touch>
              <AssigneeAvatar assignee={task.assignee} size="xs" />
              {task.assignee?.name ?? "Assign"}
            </Pill>
          </PickerPopover>
          <PickerPopover kind="labels" target={task} onChange={onChange}>
            <Pill touch>{task.labels.length ? task.labels.map((l) => l.name).join(" · ") : "Labels"}</Pill>
          </PickerPopover>
        </div>
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
