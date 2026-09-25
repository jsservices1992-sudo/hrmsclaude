/**
 * The top of every console page — the same shape as the dashboard: a
 * small violet section label saying which part of the product this is,
 * a bold title, one line saying what the page is for, and the page's
 * actions on the right.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <p className="kpi-label mb-1.5 text-indigo">{eyebrow}</p>
        )}
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink balance sm:text-3xl">{title}</h1>
        {description && <div className="mt-1 max-w-[70ch] text-sm text-ink-2">{description}</div>}
      </div>
      {actions && <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
