import { cn, IconButton } from "@mado/ui";
import { Link, useRouter } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "@mado/ui/fluent";
import { Fragment, type ReactNode } from "react";
import { isTauri } from "../../lib/platform";
import { useUi } from "../../lib/ui";

export interface Crumb {
  label: ReactNode;
  to?: string;
  params?: Record<string, string>;
  search?: Record<string, unknown>;
}

/**
 * The 52px header from the web and desktop designs: breadcrumb left, the 2–3 main actions right.
 * On phones it collapses to a back button + centred title; screens with a large iOS title render
 * <MobileTitle> themselves below it.
 */
export function PageHeader({
  crumbs,
  children,
  center,
  className,
  mobileBack,
  mobileActions,
}: {
  crumbs: Crumb[];
  children?: ReactNode;
  center?: ReactNode;
  className?: string;
  /** Show a back chevron on phones instead of the breadcrumb. */
  mobileBack?: boolean;
  mobileActions?: ReactNode;
}) {
  const router = useRouter();
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  return (
    <>
      <header
        className={cn(
          "hidden h-[52px] shrink-0 items-center gap-3 border-b border-edge px-5 md:flex",
          isTauri && "drag-region",
          isTauri && !sidebarOpen && "pl-24",
          className,
        )}
      >
        <nav className="no-drag flex min-w-0 items-center gap-2 text-sm" aria-label="Breadcrumb">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <Fragment key={i}>
                {i > 0 && <ChevronRight className="size-4 shrink-0 text-ink-faint" />}
                {c.to && !last ? (
                  <Link
                    // biome-ignore lint/suspicious/noExplicitAny: typed by callers
                    to={c.to as any}
                    params={c.params as any}
                    search={c.search as any}
                    className="truncate text-ink-subtle hover:text-ink"
                  >
                    {c.label}
                  </Link>
                ) : (
                  <span className={cn("truncate", last ? "font-medium text-ink" : "text-ink-subtle")}>{c.label}</span>
                )}
              </Fragment>
            );
          })}
        </nav>
        {center && <div className="no-drag">{center}</div>}
        <div className="no-drag ml-auto flex items-center gap-3">{children}</div>
      </header>
      <header className="flex h-[52px] shrink-0 items-center gap-2 px-4 pt-safe md:hidden">
        {mobileBack ? (
          <IconButton label="Back" size="touch" variant="secondary" className="rounded-full" onClick={() => router.history.back()}>
            <ChevronLeft className="size-[18px]" />
          </IconButton>
        ) : null}
        <div className="min-w-0 flex-1 truncate text-center text-sm font-medium text-ink-subtle">
          {mobileBack ? (typeof crumbs[crumbs.length - 2]?.label === "string" ? crumbs[crumbs.length - 2]?.label : null) : null}
        </div>
        <div className="flex items-center gap-2">{mobileActions}</div>
      </header>
    </>
  );
}

/** iOS large title + subtitle. */
export function MobileTitle({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="px-4 pb-3 pt-2 md:hidden">
      <h1 className="text-[28px] font-semibold leading-[34px] tracking-[-0.021em] text-ink">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-ink-subtle">{subtitle}</p>}
    </div>
  );
}
