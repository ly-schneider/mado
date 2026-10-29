import type { Priority, TaskStatus } from "@mado/contract";
import { Bot } from "lucide-react";
import { cn } from "./cn";

const R = "M12.75 7C12.75 10.1756 10.1756 12.75 7 12.75C3.82436 12.75 1.25 10.1756 1.25 7C1.25 3.82436 3.82436 1.25 7 1.25C10.1756 1.25 12.75 3.82436 12.75 7Z";

/** Status glyphs from the Figma "status/*" components, 14px. */
export function StatusIcon({ status, className }: { status: TaskStatus; className?: string }) {
  const c = cn("size-3.5 shrink-0", className);
  switch (status) {
    case "backlog":
      return (
        <svg viewBox="0 0 14 14" className={cn(c, "text-ink-faint")} fill="none" aria-label="Backlog">
          <path d={R} stroke="currentColor" strokeWidth="1.5" strokeDasharray="1.6 2.1" />
        </svg>
      );
    case "todo":
      return (
        <svg viewBox="0 0 14 14" className={cn(c, "text-ink-subtle")} fill="none" aria-label="Todo">
          <path d={R} stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case "in_progress":
      return (
        <svg viewBox="0 0 14 14" className={cn(c, "text-ink")} fill="none" aria-label="In progress">
          <path d={R} stroke="currentColor" strokeWidth="1.5" />
          <path d="M7 3.5A3.5 3.5 0 0 1 7 10.5Z" fill="currentColor" />
        </svg>
      );
    case "in_review":
      return (
        <svg viewBox="0 0 14 14" className={cn(c, "text-ink")} fill="none" aria-label="In review">
          <path d={R} stroke="currentColor" strokeWidth="1.5" />
          <path d="M7 3.5A3.5 3.5 0 1 1 3.5 7H7Z" fill="currentColor" />
        </svg>
      );
    case "done":
      return (
        <svg viewBox="0 0 14 14" className={cn(c, "text-ink-muted")} fill="none" aria-label="Done">
          <circle cx="7" cy="7" r="6.5" fill="currentColor" />
          <path d="M4.4 7.2 6.2 9l3.4-3.8" stroke="var(--color-page)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "canceled":
      return (
        <svg viewBox="0 0 14 14" className={cn(c, "text-ink-faint")} fill="none" aria-label="Canceled">
          <circle cx="7" cy="7" r="6.5" fill="currentColor" />
          <path d="m4.9 4.9 4.2 4.2m0-4.2L4.9 9.1" stroke="var(--color-page)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
  }
}

const BARS = [
  "M3.25 8H2.25C1.83579 8 1.5 8.33579 1.5 8.75V11.25C1.5 11.6642 1.83579 12 2.25 12H3.25C3.66421 12 4 11.6642 4 11.25V8.75C4 8.33579 3.66421 8 3.25 8Z",
  "M7.5 5H6.5C6.08579 5 5.75 5.33579 5.75 5.75V11.25C5.75 11.6642 6.08579 12 6.5 12H7.5C7.91421 12 8.25 11.6642 8.25 11.25V5.75C8.25 5.33579 7.91421 5 7.5 5Z",
  "M11.75 2H10.75C10.3358 2 10 2.33579 10 2.75V11.25C10 11.6642 10.3358 12 10.75 12H11.75C12.1642 12 12.5 11.6642 12.5 11.25V2.75C12.5 2.33579 12.1642 2 11.75 2Z",
];

/** Priority glyphs from the Figma "priority/*" components, 14px. */
export function PriorityIcon({ priority, className }: { priority: Priority; className?: string }) {
  const c = cn("size-3.5 shrink-0", className);
  if (priority === "urgent") {
    return (
      <svg viewBox="0 0 14 14" className={c} fill="none" aria-label="Urgent">
        <rect x="1" y="1" width="12" height="12" rx="3" fill="var(--color-ink)" />
        <path d="M7 4v3.6" stroke="var(--color-page)" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="7" cy="9.9" r=".95" fill="var(--color-page)" />
      </svg>
    );
  }
  if (priority === "none") {
    return (
      <svg viewBox="0 0 14 14" className={cn(c, "text-ink-faint")} fill="currentColor" aria-label="No priority">
        <rect x="1.5" y="6.25" width="2.5" height="1.5" rx=".5" />
        <rect x="5.75" y="6.25" width="2.5" height="1.5" rx=".5" />
        <rect x="10" y="6.25" width="2.5" height="1.5" rx=".5" />
      </svg>
    );
  }
  const filled = priority === "high" ? 3 : priority === "medium" ? 2 : 1;
  return (
    <svg viewBox="0 0 14 14" className={c} fill="none" aria-label={priority}>
      {BARS.map((d, i) => (
        <path key={d} d={d} fill={i < filled ? "var(--color-ink-muted)" : "var(--color-edge)"} />
      ))}
    </svg>
  );
}

/** Agents are ink squares with the bot glyph, never disguised as a person. */
export function AgentGlyph({ className }: { className?: string }) {
  return <Bot className={cn("size-3", className)} strokeWidth={1.75} />;
}

/** "Arcade" mark from the Figma Logo page: a block with two arched openings that reads as an m. */
export function MadoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 32" className={className} fill="currentColor" aria-label="mado">
      <path d="M0 6C0 4.4087 0.632141 2.88258 1.75736 1.75736C2.88258 0.632141 4.4087 0 6 0L30 0C31.5913 0 33.1174 0.632141 34.2426 1.75736C35.3679 2.88258 36 4.4087 36 6V30.4C36 31.2837 35.2837 32 34.4 32H29.6C28.7163 32 28 31.2837 28 30.4V15C28 14.2044 27.6839 13.4413 27.1213 12.8787C26.5587 12.3161 25.7956 12 25 12C24.2044 12 23.4413 12.3161 22.8787 12.8787C22.3161 13.4413 22 14.2044 22 15V30.4C22 31.2837 21.2837 32 20.4 32H15.6C14.7163 32 14 31.2837 14 30.4V15C14 14.2044 13.6839 13.4413 13.1213 12.8787C12.5587 12.3161 11.7956 12 11 12C10.2044 12 9.44129 12.3161 8.87868 12.8787C8.31607 13.4413 8 14.2044 8 15V30.4C8 31.2837 7.28366 32 6.4 32H1.6C0.716344 32 0 31.2837 0 30.4V6Z" />
    </svg>
  );
}

/** Wordmark from the Figma Logo page. The m is the Arcade mark drawn as a letter. */
export function MadoWordmark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 159 47" className={className} fill="currentColor" aria-label="mado">
      <path d="M65.4004 14.0996C67.9683 14.0997 70.4742 14.7021 72.729 15.8284C73.2104 16.0689 73.7998 15.7315 73.7998 15.1934C73.7998 14.8104 74.1102 14.5 74.4932 14.5H79.7998C80.9044 14.5 81.7998 15.3954 81.7998 16.5V44.5C81.7998 45.6046 80.9044 46.5 79.7998 46.5H74.4935C74.1104 46.5 73.7998 46.1894 73.7998 45.8063C73.7998 45.2679 73.2101 44.9303 72.7285 45.1709C70.4737 46.2974 67.9682 46.9003 65.4004 46.9004C61.0509 46.9004 56.8793 45.1722 53.8037 42.0967C50.7281 39.0211 49 34.8495 49 30.5C49 26.1504 50.7281 21.9789 53.8037 18.9033C56.8793 15.8278 61.0509 14.0996 65.4004 14.0996ZM65.4004 22.5C63.2788 22.5 61.2434 23.3426 59.7432 24.8428C58.2429 26.3431 57.4004 28.3783 57.4004 30.5C57.4004 32.6217 58.2429 34.6569 59.7432 36.1572C61.2434 37.6574 63.2788 38.5 65.4004 38.5C67.5218 38.4999 69.5565 37.6572 71.0566 36.1572C72.5569 34.6569 73.4004 32.6217 73.4004 30.5C73.4004 28.3783 72.5569 26.3431 71.0566 24.8428C69.5565 23.3428 67.5218 22.5001 65.4004 22.5Z" fillRule="evenodd" clipRule="evenodd" />
      <path d="M119.601 44.5C119.601 45.6046 118.705 46.5 117.601 46.5H112.295C111.911 46.5 111.601 46.1893 111.601 45.806C111.601 45.2673 111.011 44.9296 110.529 45.1703C108.274 46.2971 105.768 46.9004 103.2 46.9004C98.8507 46.9004 94.6791 45.1722 91.6035 42.0967C88.5279 39.0211 86.7998 34.8495 86.7998 30.5C86.7998 26.1504 88.5279 21.9789 91.6035 18.9033C94.6791 15.8278 98.8507 14.0996 103.2 14.0996C104.987 14.0996 106.744 14.3914 108.407 14.9484C109.878 15.4413 111.601 14.4458 111.601 12.8936V2.5C111.601 1.39543 112.496 0.5 113.601 0.5H117.601C118.705 0.5 119.601 1.39543 119.601 2.5V44.5ZM103.2 22.5C101.078 22.5 99.0433 23.3425 97.543 24.8428C96.0427 26.3431 95.2002 28.3783 95.2002 30.5C95.2002 32.6217 96.0427 34.6569 97.543 36.1572C99.0433 37.6575 101.078 38.5 103.2 38.5C105.322 38.5 107.356 37.6572 108.856 36.1572C110.357 34.6569 111.2 32.6217 111.2 30.5C111.2 28.3783 110.357 26.3431 108.856 24.8428C107.356 23.3428 105.322 22.5 103.2 22.5Z" fillRule="evenodd" clipRule="evenodd" />
      <path d="M141 14.0996C145.35 14.0996 149.521 15.8278 152.597 18.9033C155.672 21.9789 157.4 26.1504 157.4 30.5C157.4 34.8495 155.672 39.0211 152.597 42.0967C149.521 45.1722 145.35 46.9004 141 46.9004C136.65 46.9004 132.479 45.1723 129.403 42.0967C126.328 39.0211 124.601 34.8495 124.601 30.5C124.601 26.1505 126.328 21.9789 129.403 18.9033C132.479 15.8277 136.65 14.0996 141 14.0996ZM141 22.5C138.878 22.5 136.843 23.3425 135.343 24.8428C133.843 26.3431 133 28.3783 133 30.5C133 32.6217 133.843 34.6569 135.343 36.1572C136.843 37.6575 138.878 38.5 141 38.5C143.122 38.5 145.157 37.6575 146.657 36.1572C148.158 34.6569 149 32.6217 149 30.5C149 28.3783 148.158 26.3431 146.657 24.8428C145.157 23.3425 143.122 22.5 141 22.5Z" fillRule="evenodd" clipRule="evenodd" />
      <path d="M37 14.5C38.8565 14.5 40.6374 15.2371 41.9502 16.5498C43.263 17.8626 44 19.6435 44 21.5V44.5C44 45.6046 43.1046 46.5 42 46.5H38C36.8954 46.5 36 45.6046 36 44.5V29.5C36 28.1739 35.4728 26.9025 34.5352 25.9648C33.5975 25.0272 32.3261 24.5 31 24.5C29.6739 24.5 28.4025 25.0272 27.4648 25.9648C26.5272 26.9025 26 28.1739 26 29.5V44.5C26 45.6046 25.1046 46.5 24 46.5H20C18.8954 46.5 18 45.6046 18 44.5V29.5C18 28.1739 17.4728 26.9025 16.5352 25.9648C15.5975 25.0272 14.3261 24.5 13 24.5C11.6739 24.5 10.4025 25.0272 9.46484 25.9648C8.52716 26.9025 8 28.1739 8 29.5V44.5C8 45.6046 7.10457 46.5 6 46.5H2C0.895431 46.5 0 45.6046 0 44.5V21.5C0 19.6435 0.73705 17.8626 2.0498 16.5498C3.36256 15.2371 5.14348 14.5 7 14.5H37Z" />
    </svg>
  );
}
