import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import { Popover as BasePopover } from "@base-ui/react/popover";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { Check, ChevronDown } from "./fluent";
import * as React from "react";
import { cn } from "./cn";
import { AgentGlyph } from "./icons";

// ── Button ──────────────────────────────────────────────────────────────

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "touch";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  /** Single-key or chord hint shown inside the button, e.g. "C". */
  kbd?: React.ReactNode;
  loading?: boolean;
}

const buttonVariant: Record<ButtonVariant, string> = {
  primary: "bg-ink text-on-ink hover:bg-ink/92 active:bg-ink/85",
  secondary: "bg-raised text-ink border border-edge hover:bg-[color-mix(in_oklch,var(--color-raised),var(--color-ink)_3%)] active:bg-overlay",
  ghost: "text-ink-muted hover:bg-state-hover hover:text-ink active:bg-state-active",
  danger: "bg-raised text-danger border border-edge hover:bg-state-hover active:bg-state-active",
};

const buttonSize: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-label gap-1.5 rounded-md",
  md: "h-control px-3 text-sm gap-2 rounded-md",
  touch: "h-touch px-3.5 text-touch gap-2 rounded-lg",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, kbd, loading, className, children, disabled, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium outline-none",
        "active:scale-[0.98] transition-transform duration-120 ease-out disabled:pointer-events-none disabled:opacity-50",
        buttonVariant[variant],
        buttonSize[size],
        className,
      )}
      {...props}
    >
      {icon && <span className="-ml-0.5 flex size-4 items-center justify-center [&_svg]:size-4">{icon}</span>}
      {children}
      {kbd && <Kbd className={cn("-mr-1", variant === "primary" && "border-on-ink/15 bg-on-ink/8 text-on-ink/60")}>{kbd}</Kbd>}
    </button>
  );
});

export const IconButton = React.forwardRef<HTMLButtonElement, Omit<ButtonProps, "icon" | "kbd"> & { label: string }>(
  function IconButton({ label, className, size = "md", variant = "ghost", children, ...props }, ref) {
    return (
      <Button
        ref={ref}
        aria-label={label}
        title={label}
        variant={variant}
        size={size}
        className={cn(size === "sm" ? "w-7 px-0" : size === "touch" ? "w-touch px-0" : "w-control px-0", "[&_svg]:size-4", className)}
        {...props}
      >
        {children}
      </Button>
    );
  },
);

// ── Small pieces ────────────────────────────────────────────────────────

export function Kbd({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm border border-edge bg-raised px-1 font-sans text-kbd font-medium text-ink-subtle",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-sm border border-edge px-1.5 text-[11px] font-medium leading-4 text-ink-subtle",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Task label. Greyscale on purpose: labels never compete with the accent. */
export function LabelChip({ name, className, onRemove }: { name: string; className?: string; onRemove?: () => void }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border border-edge pl-[7px] pr-2 text-label font-medium text-ink-muted",
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-ink-subtle" />
      {name}
      {onRemove && (
        <button type="button" onClick={onRemove} className="-mr-1 text-ink-faint hover:text-ink" aria-label={`Remove ${name}`}>
          ×
        </button>
      )}
    </span>
  );
}

const avatarSize = {
  xs: "size-4 text-[7px] rounded-[8px]",
  sm: "size-5 text-[9px] rounded-[10px]",
  md: "size-6 text-[10px] rounded-[12px]",
  lg: "size-8 text-[12px] rounded-[16px]",
} as const;
const agentSize = { xs: "size-4 rounded-[4.5px]", sm: "size-5 rounded-[5.6px]", md: "size-6 rounded-[6.7px]", lg: "size-8 rounded-lg" } as const;
const glyphSize = { xs: "size-2.5", sm: "size-3", md: "size-3.5", lg: "size-4.5" } as const;

/** Humans are soft circles with initials; agents are solid ink squares with the bot glyph. */
export function Avatar({
  type,
  initials,
  size = "sm",
  className,
  title,
}: {
  type: "user" | "agent" | "guest" | "system";
  initials?: string | null;
  size?: keyof typeof avatarSize;
  className?: string;
  title?: string;
}) {
  if (type === "agent" || type === "system") {
    return (
      <span title={title} className={cn("inline-flex shrink-0 items-center justify-center bg-ink text-on-ink", agentSize[size], className)}>
        <AgentGlyph className={glyphSize[size]} />
      </span>
    );
  }
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center justify-center border border-edge bg-raised font-semibold text-ink-muted",
        avatarSize[size],
        className,
      )}
    >
      {type === "guest" ? "GU" : initials}
    </span>
  );
}

export function Checkbox({
  checked,
  onChange,
  className,
  size = "md",
  label,
  disabled,
}: {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  className?: string;
  size?: "md" | "lg";
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange?.(!checked);
      }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[4px] border disabled:opacity-40",
        size === "lg" ? "size-5" : "size-4",
        checked ? "border-ink bg-ink text-on-ink" : "border-ink-faint bg-transparent hover:border-ink-subtle",
        className,
      )}
    >
      {checked && <Check className={size === "lg" ? "size-3.5" : "size-3"} strokeWidth={3} />}
    </button>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn("relative h-5 w-8 shrink-0 rounded-full border transition-colors duration-150", checked ? "border-ink bg-ink" : "border-edge bg-raised")}
    >
      <span
        className={cn(
          "absolute left-0 top-[2px] size-3.5 rounded-full transition-transform duration-150 ease-out",
          checked ? "translate-x-[14px] bg-on-ink" : "translate-x-[2px] bg-ink-subtle",
        )}
      />
    </button>
  );
}

// ── Segmented control ───────────────────────────────────────────────────

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  className,
  disabled,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: React.ReactNode; disabled?: boolean }[];
  size?: "sm" | "md" | "touch";
  className?: string;
  disabled?: boolean;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex shrink-0 items-center rounded-lg border border-edge bg-panel p-[3px]",
        size === "touch" && "w-full",
        disabled && "opacity-50",
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          disabled={disabled || o.disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex items-center justify-center rounded-md px-3 font-medium text-ink-subtle outline-none hover:text-ink disabled:pointer-events-none",
            size === "sm" ? "h-6 text-label" : size === "md" ? "h-7 text-label" : "h-8 flex-1 text-sm",
            value === o.value && "bg-raised text-ink shadow-[inset_0_0_0_1px_var(--color-edge)]",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Inputs ──────────────────────────────────────────────────────────────

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { icon?: React.ReactNode; touch?: boolean }>(
  function Input({ className, icon, touch, ...props }, ref) {
    const input = (
      <input
        ref={ref}
        className={cn(
          "w-full rounded-md border border-edge bg-panel px-2.5 text-ink outline-none placeholder:text-ink-faint focus:border-accent",
          // 17px on touch so iOS Safari never zooms on focus.
          touch ? "h-touch text-touch" : "h-control text-sm",
          icon && "pl-8",
          !icon && className,
        )}
        {...props}
      />
    );
    if (!icon) return input;
    return (
      <div className={cn("relative", className)}>
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle [&_svg]:size-4">{icon}</span>
        {input}
      </div>
    );
  },
);

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full resize-none rounded-md border border-edge bg-panel px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-accent",
        className,
      )}
      {...props}
    />
  );
});

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-label">
        <span className="font-medium text-ink">{label}</span>
        {hint && <span className="ml-2 text-ink-subtle">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

/** Native select styled as a control. Native keeps it fast and accessible on iOS. */
export function Select<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-control w-full appearance-none rounded-md border border-edge bg-panel pl-2.5 pr-8 text-sm text-ink outline-none focus:border-accent"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
    </div>
  );
}

// ── Overlays ────────────────────────────────────────────────────────────

const popupSurface = "rounded-lg border border-edge bg-overlay shadow-[0_8px_32px_-8px_rgb(0_0_0/0.5)] outline-none";

export const Menu = {
  Root: BaseMenu.Root,
  Trigger: BaseMenu.Trigger,
  Popup({
    children,
    className,
    align = "start",
    side = "bottom",
  }: {
    children: React.ReactNode;
    className?: string;
    align?: "start" | "center" | "end";
    side?: "top" | "bottom" | "left" | "right";
  }) {
    return (
      <BaseMenu.Portal>
        <BaseMenu.Positioner sideOffset={4} align={align} side={side} className="z-50">
          <BaseMenu.Popup className={cn(popupSurface, "min-w-48 p-1 data-[open]:animate-pop", className)}>{children}</BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    );
  },
  Item({
    children,
    onClick,
    icon,
    kbd,
    selected,
    danger,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    icon?: React.ReactNode;
    kbd?: React.ReactNode;
    selected?: boolean;
    danger?: boolean;
    disabled?: boolean;
  }) {
    return (
      <BaseMenu.Item
        onClick={onClick}
        disabled={disabled}
        className={cn(
          "flex h-8 cursor-default select-none items-center gap-2.5 rounded-md px-2 text-sm text-ink outline-none data-[highlighted]:bg-state-active data-[disabled]:opacity-40",
          danger && "text-danger",
        )}
      >
        {icon && <span className="flex size-4 items-center justify-center text-ink-subtle [&_svg]:size-4">{icon}</span>}
        <span className="flex-1 truncate">{children}</span>
        {selected && <Check className="size-4 text-ink-subtle" />}
        {kbd && <Kbd>{kbd}</Kbd>}
      </BaseMenu.Item>
    );
  },
  Separator() {
    return <BaseMenu.Separator className="mx-1 my-1 h-px bg-edge" />;
  },
  Label({ children }: { children: React.ReactNode }) {
    return <div className="px-2 pb-1 pt-1.5 text-label text-ink-subtle">{children}</div>;
  },
};

export const Popover = {
  Root: BasePopover.Root,
  Trigger: BasePopover.Trigger,
  Close: BasePopover.Close,
  Popup({
    children,
    className,
    align = "start",
    side = "bottom",
    sideOffset = 4,
  }: {
    children: React.ReactNode;
    className?: string;
    align?: "start" | "center" | "end";
    side?: "top" | "bottom" | "left" | "right";
    sideOffset?: number;
  }) {
    return (
      <BasePopover.Portal>
        <BasePopover.Positioner sideOffset={sideOffset} align={align} side={side} className="z-50">
          <BasePopover.Popup className={cn(popupSurface, "data-[open]:animate-pop", className)}>{children}</BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    );
  },
};

export function Dialog({
  open,
  onOpenChange,
  children,
  className,
  title,
  description,
  position = "center",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
  title?: string;
  description?: string;
  /** "top" places the dialog like the command palette, "sheet" slides up on phones. */
  position?: "center" | "top" | "sheet";
}) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-40 bg-black/50 data-[open]:animate-fade" />
        <BaseDialog.Popup
          className={cn(
            popupSurface,
            "fixed z-50 flex max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] flex-col overflow-hidden",
            position === "center" && "left-1/2 top-1/2 max-w-lg -translate-x-1/2 -translate-y-1/2 data-[open]:animate-pop",
            position === "top" && "left-1/2 top-[13vh] max-w-[640px] -translate-x-1/2 data-[open]:animate-pop",
            position === "sheet" &&
              "inset-x-0 bottom-0 top-[max(env(safe-area-inset-top),12px)] w-full max-w-none rounded-b-none rounded-t-xl data-[open]:animate-sheet",
            className,
          )}
        >
          {title && <BaseDialog.Title className="sr-only">{title}</BaseDialog.Title>}
          {description && <BaseDialog.Description className="sr-only">{description}</BaseDialog.Description>}
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

export function Tooltip({ content, children, side = "bottom" }: { content: React.ReactNode; children: React.ReactElement; side?: "top" | "bottom" }) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={6} className="z-50">
          <BaseTooltip.Popup className="rounded-md border border-edge bg-overlay px-2 py-1 text-label text-ink-muted">{content}</BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}

// ── Layout helpers ──────────────────────────────────────────────────────

/** Section card used on settings-like screens: rows separated by edge lines. */
export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("divide-y divide-edge rounded-lg border border-edge bg-panel", className)}>{children}</div>;
}

export function CardRow({
  title,
  description,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-14 items-center gap-4 px-4 py-3", className)}>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink">{title}</div>
        {description && <div className="text-label text-ink-subtle">{description}</div>}
      </div>
      {children}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      {icon && <div className="mb-1 text-ink-faint [&_svg]:size-6">{icon}</div>}
      <div className="text-sm font-medium text-ink">{title}</div>
      {children && <div className="max-w-sm text-label text-ink-subtle">{children}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn("inline-block size-4 animate-spin rounded-full border-[1.5px] border-ink-faint border-t-ink", className)} />;
}
