/**
 * The top of every console page: a plain, confident title, one line
 * saying what the page is for, and the page's actions on the right.
 * `eyebrow` is kept for callers but no longer drawn — the breadcrumb in
 * the header already says where you are.
 */
export function PageHeader({
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
        <h1 className="text-2xl font-bold tracking-tight text-ink balance">{title}</h1>
        {description && <div className="mt-1 max-w-[70ch] text-sm text-ink-2">{description}</div>}
      </div>
      {actions && <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
