import type { Assignee, TaskStatus, TaskSummary } from "@mado/contract";
import { STATUS_LABEL } from "@mado/contract";
import { Avatar, cn, PriorityIcon, StatusIcon } from "@mado/ui";
import { Link } from "@tanstack/react-router";
import { Fragment, type ReactNode, forwardRef } from "react";
import { shortDate } from "../../lib/time";

export function AssigneeAvatar({ assignee, size = "sm", className }: { assignee: Pick<Assignee, "type" | "initials" | "name"> | null; size?: "xs" | "sm" | "md"; className?: string }) {
  if (!assignee) {
    const px = size === "xs" ? "size-4" : size === "sm" ? "size-5" : "size-6";
    return <span title="Unassigned" className={cn("inline-block shrink-0 rounded-full border border-dashed border-ink-faint", px, className)} />;
  }
  return <Avatar type={assignee.type} initials={assignee.initials} size={size} title={assignee.name} className={className} />;
}

const INLINE_RE = /(\*\*[^*]+\*\*|`[^`]+`|\[\[[^\]]+\]\]|\b[A-Z][A-Z0-9]{1,4}-\d+\b)/g;

/** Inline Markdown for one-liners (criteria, comment previews): bold, code, task keys and [[links]]. */
export function InlineMd({ text, wsSlug, className }: { text: string; wsSlug?: string; className?: string }) {
  const parts = text.split(INLINE_RE);
  return (
    <span className={className}>
      {parts.map((p, i) => {
        if (i % 2 === 0) return <Fragment key={i}>{p}</Fragment>;
        if (p.startsWith("**")) return <strong key={i} className="font-semibold text-ink">{p.slice(2, -2)}</strong>;
        if (p.startsWith("`")) return <strong key={i} className="font-semibold text-ink">{p.slice(1, -1)}</strong>;
        if (p.startsWith("[[")) return <span key={i} className="text-accent">{p.slice(2, -2)}</span>;
        if (!wsSlug) return <span key={i} className="text-accent">{p}</span>;
        return (
          <Link key={i} to="/$ws/t/$taskKey" params={{ ws: wsSlug, taskKey: p }} className="text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
            {p}
          </Link>
        );
      })}
    </span>
  );
}

/** Board card: key + assignee, status + title on a raised tone; accent ring and selected tone when focused. */
export const TaskCard = forwardRef<
  HTMLDivElement,
  {
    task: TaskSummary;
    focused?: boolean;
    dragging?: boolean;
    onClick?: () => void;
    onOpen?: () => void;
  } & React.HTMLAttributes<HTMLDivElement>
>(function TaskCard({ task, focused, dragging, onClick, onOpen, className, ...rest }, ref) {
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={-1}
      data-task-id={task.id}
      onClick={onClick}
      onDoubleClick={onOpen}
      className={cn(
        "flex select-none flex-col gap-2 rounded-lg border border-transparent bg-raised p-3 outline-none",
        focused && "border-accent bg-[linear-gradient(var(--color-state-selected),var(--color-state-selected)),linear-gradient(var(--color-raised),var(--color-raised))]",
        dragging && "opacity-40",
        className,
      )}
      {...rest}
    >
      <div className="flex h-5 items-center gap-2">
        <span className="flex-1 truncate text-label font-medium text-ink-subtle">{task.key}</span>
        {task.assignee && <AssigneeAvatar assignee={task.assignee} size="sm" />}
      </div>
      <div className="flex gap-2">
        <span className="pt-[3px]">
          <StatusIcon status={task.status} />
        </span>
        <span className="line-clamp-3 min-w-0 flex-1 text-sm font-medium text-ink">{task.title}</span>
      </div>
    </div>
  );
});

/** 32px list row: priority, key, status, title … date, assignee. */
export function TaskRow({
  task,
  focused,
  onClick,
  onOpen,
  showDate = true,
  className,
  ...rest
}: {
  task: TaskSummary;
  focused?: boolean;
  onClick?: () => void;
  onOpen?: () => void;
  showDate?: boolean;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "onClick">) {
  return (
    <div
      role="row"
      data-task-id={task.id}
      onClick={onClick}
      onDoubleClick={onOpen}
      className={cn("flex h-8 cursor-default select-none items-center gap-3 px-5 text-sm hover:bg-state-hover", focused && "bg-state-selected hover:bg-state-selected", className)}
      {...rest}
    >
      <PriorityIcon priority={task.priority} />
      <span className="w-[60px] shrink-0 truncate text-label font-medium text-ink-subtle">{task.key}</span>
      <StatusIcon status={task.status} />
      <span className="min-w-0 flex-1 truncate font-medium text-ink">{task.title}</span>
      {showDate && <span className="w-12 shrink-0 text-right text-label text-ink-subtle">{task.dueDate ? shortDate(task.dueDate) : "—"}</span>}
      <AssigneeAvatar assignee={task.assignee} size="sm" />
    </div>
  );
}

/** Two-line phone row from the iOS My tasks design. */
export function TaskRowPhone({ task, onClick, focused }: { task: TaskSummary; onClick?: () => void; focused?: boolean }) {
  return (
    <button
      type="button"
      data-task-id={task.id}
      onClick={onClick}
      className={cn("flex w-full gap-3 border-b border-edge px-4 py-3 text-left active:bg-state-active", focused && "bg-state-selected")}
    >
      <span className="pt-[3px]">
        <StatusIcon status={task.status} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-base font-medium text-ink">{task.title}</span>
        <span className="truncate text-label text-ink-subtle">{task.key}</span>
      </span>
      <span className="flex flex-col items-end justify-between gap-2 py-0.5">
        <PriorityIcon priority={task.priority} />
        <AssigneeAvatar assignee={task.assignee} size="xs" />
      </span>
    </button>
  );
}

export function GroupHeader({ status, count, className, sticky }: { status: TaskStatus; count: number; className?: string; sticky?: boolean }) {
  return (
    <div className={cn("flex h-8 items-center gap-2 bg-panel px-5 text-sm", sticky && "sticky top-0 z-10", className)}>
      <StatusIcon status={status} />
      <span className="font-medium text-ink-muted">{STATUS_LABEL[status]}</span>
      <span className="text-label text-ink-subtle">{count}</span>
    </div>
  );
}

/** Bordered property pill (task header, capture, My tasks detail). */
export function Pill({ children, className, touch }: { children: ReactNode; className?: string; touch?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-edge bg-raised px-2 text-label font-medium text-ink-muted [&_svg]:size-3.5",
        touch && "h-9 rounded-lg px-3 text-sm",
        className,
      )}
    >
      {children}
    </span>
  );
}
