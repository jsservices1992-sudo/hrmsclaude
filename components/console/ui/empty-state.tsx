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
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      <span aria-hidden className="mb-1 grid h-11 w-11 place-items-center rounded-full bg-surface-2 text-ink-3">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
          <path d="M3 11.5 5 4.5h10l2 7V15a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15v-3.5Z" />
          <path d="M3 11.5h4l1 2h4l1-2h4" />
        </svg>
      </span>
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {description && <p className="max-w-[46ch] text-sm text-ink-2">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
