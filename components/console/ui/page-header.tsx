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
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        {eyebrow && (
          <span className="inline-flex items-center rounded-full border border-indigo/20 bg-indigo-soft px-2.5 py-0.5 text-xs font-semibold text-indigo">
            {eyebrow}
          </span>
        )}
        <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-ink mt-2 balance">{title}</h1>
        {description && <p className="text-sm text-ink-2 mt-1 max-w-[70ch]">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 max-w-full min-w-0">{actions}</div>}
    </div>
  );
}
