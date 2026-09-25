export function Card({
  children,
  className = "",
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section
      className={`rounded-2xl border border-line bg-surface card-lift ${padded ? "p-4 sm:p-5" : ""} ${className}`}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  eyebrow,
  action,
}: {
  title: React.ReactNode;
  eyebrow?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-4">
      <div>
        {eyebrow && <p className="text-xs font-medium text-ink-2 mb-1">{eyebrow}</p>}
        <h3 className="font-display text-lg font-bold tracking-tight">{title}</h3>
      </div>
      {action}
    </div>
  );
}
