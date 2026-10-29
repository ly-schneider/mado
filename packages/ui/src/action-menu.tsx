import { ContextMenu as BaseContextMenu } from "@base-ui/react/context-menu";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import type * as React from "react";
import { cn } from "./cn";
import { ChevronRight } from "./fluent";
import { Kbd } from "./components";

/**
 * One description of a context's actions, rendered as a right-click menu (ContextArea) or as a
 * button dropdown (ActionMenu). Screens declare entries once, so both always offer the same actions.
 */
export type ActionEntry =
  | {
      label: string;
      icon?: React.ReactNode;
      kbd?: string;
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }
  | { label: string; icon?: React.ReactNode; children: ActionEntry[] }
  | { separator: true }
  | { heading: string };

const surface = "z-50 min-w-52 rounded-lg border border-edge bg-overlay p-1 shadow-[0_8px_32px_-8px_rgb(0_0_0/0.5)] outline-none data-[open]:animate-pop";
const itemClass =
  "flex h-8 cursor-default select-none items-center gap-2.5 rounded-md px-2 text-sm text-ink outline-none data-[highlighted]:bg-state-active data-[disabled]:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0";

type Parts = typeof BaseMenu | typeof BaseContextMenu;

function Entries({ entries, parts }: { entries: ActionEntry[]; parts: Parts }) {
  const P = parts as typeof BaseMenu;
  return (
    <>
      {entries.map((e, i) => {
        if ("separator" in e) return <P.Separator key={`s${i}`} className="mx-1 my-1 h-px bg-edge" />;
        if ("heading" in e)
          return (
            <div key={`h${i}`} className="px-2 pb-1 pt-1.5 text-label text-ink-subtle">
              {e.heading}
            </div>
          );
        if ("children" in e) {
          return (
            <P.SubmenuRoot key={e.label}>
              <P.SubmenuTrigger className={itemClass}>
                {e.icon && <span className="flex size-4 items-center justify-center text-ink-subtle">{e.icon}</span>}
                <span className="flex-1 truncate">{e.label}</span>
                <ChevronRight className="text-ink-subtle" />
              </P.SubmenuTrigger>
              <P.Portal>
                <P.Positioner sideOffset={-2} alignOffset={-4} className="z-50">
                  <P.Popup className={cn(surface, "max-h-80 overflow-y-auto")}>
                    {e.children.length ? <Entries entries={e.children} parts={parts} /> : <div className="px-2 py-1.5 text-label text-ink-subtle">Nothing here</div>}
                  </P.Popup>
                </P.Positioner>
              </P.Portal>
            </P.SubmenuRoot>
          );
        }
        return (
          <P.Item key={e.label} onClick={e.onSelect} disabled={e.disabled} className={cn(itemClass, e.danger && "text-danger")}>
            {e.icon && <span className={cn("flex size-4 items-center justify-center", e.danger ? "text-danger" : "text-ink-subtle")}>{e.icon}</span>}
            <span className="flex-1 truncate">{e.label}</span>
            {e.kbd && <Kbd className="[@media(pointer:coarse)]:hidden">{e.kbd}</Kbd>}
          </P.Item>
        );
      })}
    </>
  );
}

/** Right-click (or long-press on touch) anywhere inside opens the entries at the pointer. */
export function ContextArea({
  entries,
  children,
  className,
  disabled,
}: {
  entries: ActionEntry[];
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  if (disabled || entries.length === 0) return <div className={className}>{children}</div>;
  return (
    <BaseContextMenu.Root>
      <BaseContextMenu.Trigger className={className}>{children}</BaseContextMenu.Trigger>
      <BaseContextMenu.Portal>
        <BaseContextMenu.Positioner className="z-50">
          <BaseContextMenu.Popup className={surface}>
            <Entries entries={entries} parts={BaseContextMenu} />
          </BaseContextMenu.Popup>
        </BaseContextMenu.Positioner>
      </BaseContextMenu.Portal>
    </BaseContextMenu.Root>
  );
}

/** The same entries behind a button (⋯ or +). `trigger` is rendered as the menu button. */
export function ActionMenu({
  entries,
  trigger,
  align = "start",
  onOpenChange,
}: {
  entries: ActionEntry[];
  trigger: React.ReactElement;
  align?: "start" | "center" | "end";
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <BaseMenu.Root onOpenChange={onOpenChange}>
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner sideOffset={4} align={align} className="z-50">
          <BaseMenu.Popup className={surface}>
            <Entries entries={entries} parts={BaseMenu} />
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}
