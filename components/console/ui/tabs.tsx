import Link from "next/link";

export function Tabs({ children }: { children: React.ReactNode }) {
  return (
    <div role="tablist" className="flex items-center gap-1 border-b border-line overflow-x-auto">
      {children}
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
      className={`relative px-3 py-2 text-sm whitespace-nowrap transition-base ${
        active ? "text-ink font-medium" : "text-ink-2 hover:text-ink"
      }`}
    >
      {children}
      {active && <span aria-hidden className="absolute inset-x-0 -bottom-px h-[2px] bg-brass" />}
    </Link>
  );
}
