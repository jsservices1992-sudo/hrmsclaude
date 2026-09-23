import Link from "next/link";

/** Underlined tabs across the top of a panel or page section. */
export function Tabs({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-full overflow-x-auto border-b border-line">
      <div role="tablist" className="flex items-center gap-6">
        {children}
      </div>
    </div>
  );
}

export function TabLink({
  href,
  active,
  count,
  children,
}: {
  href: string;
  active: boolean;
  /** A number worth noticing — shown as a small pill. */
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      role="tab"
      aria-selected={active}
      className={`relative -mb-px flex items-center gap-2 whitespace-nowrap border-b-2 py-3 text-sm font-semibold transition-base focus-visible:outline-none focus-visible:text-indigo ${
        active ? "border-indigo text-indigo" : "border-transparent text-ink-2 hover:text-ink hover:border-line"
      }`}
    >
      {children}
      {count !== undefined && count > 0 && (
        <span className={`rounded-full px-1.5 text-xs tnum ${active ? "bg-indigo text-on-indigo" : "bg-surface-3 text-ink-2"}`}>
          {count}
        </span>
      )}
    </Link>
  );
}
