/** A placeholder block shown while a page's data is on its way. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-lg bg-surface-3 ${className}`} />;
}

/**
 * The shape every console page has — a title, a row of figures and a
 * table — so a slow page shows where things will be instead of nothing.
 */
export function PageSkeleton({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex flex-col gap-6 max-w-[84rem]" role="status" aria-live="polite">
      <span className="sr-only">{label}…</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-28 rounded-full" />
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <div className="rounded-xl border border-line bg-surface p-4 flex flex-col gap-3">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-5" />
        ))}
      </div>
    </div>
  );
}
