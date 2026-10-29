import type { TaskStatus, TaskSummary } from "@mado/contract";
import { PRIORITIES, PRIORITY_LABEL } from "@mado/contract";
import { type ActionEntry, Avatar, ContextArea, PriorityIcon, StatusIcon } from "@mado/ui";
import { ArrowRight, ArrowUpRight, Check, CircleUser, Copy, GitBranch, Link2, Plus, Tag, Trash2 } from "@mado/ui/fluent";
import { type ReactNode, useRef } from "react";
import { isStandalone, isTauri } from "../../lib/platform";
import { openCapture } from "../../lib/ui";
import { useWorkspace } from "../../lib/workspace";
import { branchName, copyText, deleteTask, STATUS_LABEL, STATUS_ORDER, taskUrl, updateTask, useAssigneeOptions, useLabels } from "./data";

/** A new tab only makes sense in a browser; the desktop app and the installed PWA have one window. */
export const canOpenTab = !isTauri && !isStandalone;

const checked = (on: boolean, icon: ReactNode) => (on ? <Check /> : icon);

/**
 * Everything a task offers, in one list: the right-click menu on cards and rows and the ⋯ menu on the
 * task page render the same entries. `onOpen` is left out where the task is already open.
 */
export function useTaskActions(
  task: TaskSummary,
  { onOpen, onDeleted, extra = [] }: { onOpen?: () => void; onDeleted?: () => void; extra?: ActionEntry[] } = {},
): ActionEntry[] {
  const ws = useWorkspace();
  const assignees = useAssigneeOptions();
  const labels = useLabels(task.projectId).data ?? [];
  const set = (patch: Parameters<typeof updateTask>[1], optimistic: Partial<TaskSummary>) => void updateTask(task, patch, optimistic);
  const url = taskUrl(ws.slug, task.key);
  const current = task.assignee ? `${task.assignee.type}:${task.assignee.id}` : null;

  return [
    ...(onOpen
      ? [
          { label: "Open", icon: <ArrowRight />, kbd: "↵", onSelect: onOpen },
          ...(canOpenTab ? [{ label: "Open in new tab", icon: <ArrowUpRight />, onSelect: () => window.open(url, "_blank", "noopener") }] : []),
          { separator: true as const },
        ]
      : []),
    {
      label: "Status",
      icon: <StatusIcon status={task.status} />,
      children: STATUS_ORDER.map((s) => ({
        label: STATUS_LABEL[s],
        icon: checked(s === task.status, <StatusIcon status={s} />),
        onSelect: () => s !== task.status && set({ status: s }, { status: s }),
      })),
    },
    {
      label: "Priority",
      icon: <PriorityIcon priority={task.priority} />,
      children: PRIORITIES.map((p) => ({
        label: PRIORITY_LABEL[p],
        icon: checked(p === task.priority, <PriorityIcon priority={p} />),
        onSelect: () => p !== task.priority && set({ priority: p }, { priority: p }),
      })),
    },
    {
      label: "Assignee",
      icon: <CircleUser />,
      children: [
        {
          label: "No assignee",
          icon: checked(!current, <span className="size-4 rounded-full border border-dashed border-ink-faint" />),
          onSelect: () => current && set({ assignee: null }, { assignee: null }),
        },
        ...assignees.map((a) => ({
          label: a.name,
          icon: checked(a.value === current, <Avatar type={a.type} initials={a.initials} size="xs" />),
          onSelect: () => a.value !== current && set({ assignee: a.value }, { assignee: { type: a.type, id: a.id, name: a.name, initials: a.initials } }),
        })),
      ],
    },
    {
      label: "Labels",
      icon: <Tag />,
      children: labels.map((l) => {
        const on = task.labels.some((x) => x.id === l.id);
        const next = on ? task.labels.filter((x) => x.id !== l.id) : [...task.labels, { id: l.id, name: l.name, color: l.color }];
        return {
          label: l.name,
          icon: checked(on, <span className="size-2 rounded-full bg-ink-subtle" />),
          onSelect: () => set({ labelIds: next.map((x) => x.id) }, { labels: next }),
        };
      }),
    },
    { separator: true },
    { label: `Copy ${task.key}`, icon: <Copy />, onSelect: () => copyText(task.key, "key") },
    { label: "Copy link", icon: <Link2 />, onSelect: () => copyText(url, "link") },
    { label: "Copy branch name", icon: <GitBranch />, onSelect: () => copyText(branchName(task.key, task.title), "branch name") },
    ...extra,
    { separator: true },
    {
      label: "Delete",
      icon: <Trash2 />,
      kbd: "⌫",
      danger: true,
      onSelect: async () => {
        if (await deleteTask(task)) onDeleted?.();
      },
    },
  ];
}

export function newTaskEntries(projectId: string, status: TaskStatus): ActionEntry[] {
  return [{ label: `New task in ${STATUS_LABEL[status]}`, icon: <Plus />, kbd: "C", onSelect: () => openCapture("task", { projectId, status }) }];
}

/**
 * Wraps a row or card in its right-click / long-press menu. Right-click also focuses the row, so the
 * keyboard state matches what the menu acts on. A long press ends in a click on touch screens, which
 * must not also open the row.
 */
export function RowMenu({ entries, onFocus, className, children }: { entries: ActionEntry[]; onFocus?: () => void; className?: string; children: ReactNode }) {
  const pressedAt = useRef(0);
  return (
    <ContextArea entries={entries} className={className}>
      <div
        className="contents"
        onContextMenu={() => onFocus?.()}
        onTouchStart={() => {
          pressedAt.current = Date.now();
        }}
        onClickCapture={(e) => {
          if (pressedAt.current && Date.now() - pressedAt.current > 450) {
            e.preventDefault();
            e.stopPropagation();
          }
          pressedAt.current = 0;
        }}
      >
        {children}
      </div>
    </ContextArea>
  );
}

/** The task's own menu around a card or row. */
export function TaskRowMenu({ task, onOpen, onFocus, onDeleted, className, children }: { task: TaskSummary; onOpen: () => void; onFocus?: () => void; onDeleted?: () => void; className?: string; children: ReactNode }) {
  const entries = useTaskActions(task, { onOpen, onDeleted });
  return (
    <RowMenu entries={entries} onFocus={onFocus} className={className}>
      {children}
    </RowMenu>
  );
}
