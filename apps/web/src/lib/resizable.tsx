import { cn } from "@mado/ui";
import { type CSSProperties, createElement, type HTMLAttributes, type KeyboardEvent, type PointerEvent, useRef, useState } from "react";

/** Width the main content keeps while a panel is dragged wider. */
const MAIN_MIN = 420;
const STEP = 16;

const storageKey = (id: string) => `mado.panel.${id}`;

function readWidth(id: string, fallback: number, min: number, max: number) {
  try {
    const v = Number(localStorage.getItem(storageKey(id)));
    if (v) return Math.min(max, Math.max(min, v));
  } catch {}
  return fallback;
}

function saveWidth(id: string, width: number | null) {
  try {
    if (width === null) localStorage.removeItem(storageKey(id));
    else localStorage.setItem(storageKey(id), String(Math.round(width)));
  } catch {}
}

interface Props extends HTMLAttributes<HTMLElement> {
  /** Remembers the width under this key, shared by every panel with the same id. */
  id: string;
  /** Which side of the screen the panel sits on; the handle goes on its inner edge. */
  side: "left" | "right";
  defaultWidth: number;
  min: number;
  max: number;
  as?: "aside" | "nav" | "div";
}

/**
 * A side panel whose width can be dragged, nudged with the arrow keys and reset with a double click.
 * The width applies from md up; below that the panel keeps the layout its className gives it.
 * Its content must not scroll the panel element itself, or the handle would scroll away with it.
 */
export function ResizablePanel({ id, side, defaultWidth, min, max, as = "aside", className, style, children, ...rest }: Props) {
  const ref = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(() => readWidth(id, defaultWidth, min, max));
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; width: number; current: number } | null>(null);

  const clamp = (w: number) => Math.round(Math.min(Math.max(min, Math.min(max, window.innerWidth - MAIN_MIN)), Math.max(min, w)));
  const commit = (w: number | null) => {
    const next = w === null ? defaultWidth : clamp(w);
    setWidth(next);
    saveWidth(id, w === null ? null : next);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, width, current: width };
    setDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const delta = e.clientX - d.x;
    d.current = clamp(side === "left" ? d.width + delta : d.width - delta);
    // Only the CSS variable changes while dragging, so the panel's content doesn't re-render on every move.
    ref.current?.style.setProperty("--panel-w", `${d.current}px`);
  };
  const onPointerUp = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragging(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    commit(d.current);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const grow = side === "left" ? "ArrowRight" : "ArrowLeft";
    const shrink = side === "left" ? "ArrowLeft" : "ArrowRight";
    if (e.key === grow) commit(width + STEP);
    else if (e.key === shrink) commit(width - STEP);
    else if (e.key === "Home") commit(min);
    else if (e.key === "End") commit(max);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const handle = (
    <div
      key="resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Drag to resize, double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => commit(null)}
      onKeyDown={onKeyDown}
      className={cn(
        "group no-drag absolute inset-y-0 z-30 hidden w-2 cursor-col-resize touch-none outline-none md:block",
        side === "left" ? "-right-1" : "-left-1",
      )}
    >
      <span
        className={cn(
          "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 group-hover:bg-ink-faint group-focus-visible:w-0.5 group-focus-visible:bg-accent",
          dragging && "w-0.5 bg-accent group-hover:bg-accent",
        )}
      />
    </div>
  );

  return createElement(
    as,
    {
      ...rest,
      ref,
      className: cn("relative shrink-0 md:w-(--panel-w)", className),
      style: { ...style, "--panel-w": `${width}px` } as CSSProperties,
    },
    children,
    handle,
  );
}
