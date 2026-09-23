import Link from "next/link";

export function Tabs({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-full overflow-x-auto">
      <div role="tablist" className="inline-flex items-center gap-1 rounded-xl border border-line bg-surface-3/70 p-1">
        {children}
      </div>
    </div>
  );
}

export function TabLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      role="tab"
      aria-selected={active}
      className={`rounded-lg px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-base ${
        active ? "bg-surface text-indigo shadow-sm" : "text-ink-2 hover:text-ink hover:bg-surface/60"
      }`}
    >
      {children}
    </Link>
  );
}
