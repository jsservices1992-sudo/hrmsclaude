export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-2 py-14 px-4">
      <p className="font-display text-lg font-semibold">{title}</p>
      {description && <p className="text-sm text-ink-2 max-w-[42ch]">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
