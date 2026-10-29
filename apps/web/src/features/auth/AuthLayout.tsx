import { cn, MadoMark, MadoWordmark } from "@mado/ui";
import type { ReactNode } from "react";

/**
 * Brand tile from the Figma "Logo / Tile" component. Fixed artwork: it reads the same on light and
 * dark, so it deliberately doesn't use theme tokens.
 */
export function LogoTile({ className }: { className?: string }) {
  return (
    <span
      className={cn("relative inline-flex size-8 shrink-0 items-center justify-center rounded-[7.2px] text-white", className)}
      style={{
        background:
          "radial-gradient(circle at 22% 8%, rgb(255 255 255 / 0.12), transparent 75%), linear-gradient(180deg, rgb(44 44 44) 0%, rgb(9 9 9) 100%)",
        boxShadow: "inset 0 0 0 0.667px rgb(255 255 255 / 0.09)",
      }}
    >
      <MadoMark className="h-[44%] w-1/2" />
    </span>
  );
}

/** Full-page frame for the signed-out screens and the OAuth consent: content centred, optional wordmark top left. */
export function AuthFrame({ children, className, wordmark = true }: { children: ReactNode; className?: string; wordmark?: boolean }) {
  return (
    <div className="relative flex min-h-full flex-col bg-page pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      {wordmark && (
        <div className="px-4 pt-5 md:absolute md:left-8 md:top-7 md:p-0">
          <MadoWordmark className="h-[23.5px] w-auto text-ink" />
        </div>
      )}
      <div className={cn("flex flex-1 flex-col items-center justify-center px-4 py-10", className)}>{children}</div>
    </div>
  );
}

/**
 * Narrow centred column for login, setup, onboarding, invites and the desktop server screen (Linear-style:
 * mark, one heading, the form, no card). `description` and `footer` are for one essential line each.
 */
export function AuthScreen({ title, description, children, footer }: { title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <AuthFrame wordmark={false}>
      <div className="flex w-full max-w-[340px] animate-fade flex-col gap-8">
        <div className="flex flex-col items-center gap-5 text-center">
          <LogoTile className="size-12 rounded-[11px]" />
          <div className="flex flex-col gap-1">
            <h1 className="text-title text-ink">{title}</h1>
            {description && <p className="text-sm text-ink-subtle">{description}</p>}
          </div>
        </div>
        {children}
        {footer && <div className="text-center text-sm text-ink-subtle">{footer}</div>}
      </div>
    </AuthFrame>
  );
}

export function FormError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-label text-danger">
      {children}
    </p>
  );
}

/** Only same-origin paths are allowed as a post-login redirect. */
export function safeNext(next: string | undefined) {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}
