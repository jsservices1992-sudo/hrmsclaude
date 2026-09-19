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
        {eyebrow && <p className="label text-brass">{eyebrow}</p>}
        <h1 className="font-display text-3xl font-semibold mt-1 balance">{title}</h1>
        {description && <p className="text-sm text-ink-2 mt-1 max-w-[70ch]">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 max-w-full min-w-0">{actions}</div>}
    </div>
  );
}
