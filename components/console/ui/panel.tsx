/**
 * A titled block of a page. The title is set in the panel itself — no
 * grey strip across the top — with an optional line under it and actions
 * on the right, the way the rest of a modern console reads.
 */
export function Panel({
  title,
  description,
  icon,
  badge,
  actions,
  children,
  flush = false,
  className = "",
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  /** Body runs to the edges — for tables and lists. */
  flush?: boolean;
  className?: string;
}) {
  const hasHead = title || actions;
  return (
    <section className={`rounded-2xl border border-line bg-surface card-lift ${className}`}>
      {hasHead && (
        <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
          <div className="flex min-w-0 items-start gap-3">
            {icon && (
              <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-indigo-soft text-indigo">
                {icon}
              </span>
            )}
            <div className="min-w-0">
              <h2 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink">
                {title}
                {badge}
              </h2>
              {description && <p className="mt-0.5 text-sm text-ink-2">{description}</p>}
            </div>
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children !== undefined && (
        <div className={flush ? (hasHead ? "border-t border-line-2" : "") : `px-5 pb-5 ${hasHead ? "" : "pt-5"}`}>
          {children}
        </div>
      )}
    </section>
  );
}
