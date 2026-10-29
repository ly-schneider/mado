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

/** Full-page frame for the signed-out screens and the OAuth consent: wordmark top left, content centred. */
export function AuthFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="relative flex min-h-full flex-col bg-page">
      <div className="px-4 pt-[max(env(safe-area-inset-top),20px)] md:absolute md:left-8 md:top-7 md:p-0">
        <MadoWordmark className="h-[23.5px] w-auto text-ink" />
      </div>
      <div className={cn("flex flex-1 flex-col items-center justify-center px-4 py-10", className)}>{children}</div>
    </div>
  );
}

/** Narrow centred column for login, setup, onboarding and invites (Linear-style, no card). */
export function AuthScreen({ title, description, children, footer }: { title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <AuthFrame>
      <div className="flex w-full max-w-[360px] animate-fade flex-col gap-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <LogoTile className="size-10 rounded-[9px]" />
          <div className="flex flex-col gap-1.5">
            <h1 className="text-title text-ink">{title}</h1>
            {description && <p className="text-sm text-ink-subtle">{description}</p>}
          </div>
        </div>
        {children}
        {footer && <div className="text-center text-label text-ink-subtle">{footer}</div>}
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
