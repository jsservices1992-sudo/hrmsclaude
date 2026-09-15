"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SITE } from "@/lib/site";
import {
  SEGMENT_LABELS,
  isItemActive,
  type ConsoleNavSection,
} from "@/lib/console-nav";
import { ICONS, IconMenu, IconClose, IconPanel, IconChevron, IconSearch } from "./icons";
import { DropdownMenu, DropdownItem } from "./ui/dropdown-menu";
import { ToastProvider } from "./ui/toast";
import { CommandPalette } from "./command-palette";

const COLLAPSE_KEY = "lekha.sidebar.collapsed";

export type ShellUser = {
  name: string;
  email: string;
  role: string;
  compensationScope: string;
};

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <Link href="/console" className="flex items-center gap-2.5 min-w-0">
      <span
        aria-hidden
        className="grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-indigo text-on-indigo font-display text-lg font-semibold leading-none"
      >
        ल
      </span>
      {!collapsed && (
        <span className="font-display text-lg font-semibold truncate">
          {SITE.name}
        </span>
      )}
    </Link>
  );
}

const OPEN_KEY = "lekha.sidebar.open";

/**
 * One section's worth of nav, openable.
 *
 * Thirty-odd links all shown at once is a list nobody reads; the section
 * holding the page you are on is open on arrival, because collapsing the
 * thing you just clicked into would be worse than showing everything.
 */
function NavSection({
  section,
  pathname,
  collapsed,
  open,
  onToggle,
  onNavigate,
}: {
  section: ConsoleNavSection;
  pathname: string;
  collapsed: boolean;
  open: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  const items = (
    <>
      {section.groups.map((group, gi) => (
        <div key={group.label ?? `g${gi}`} className="flex flex-col gap-0.5">
          {group.label && !collapsed && (
            <p className="label text-ink-3 px-3 pb-0.5">{group.label}</p>
          )}
          {group.items.map((item) => {
            const active = isItemActive(item, pathname);
            const Icon = ICONS[item.icon];
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                className={`group relative flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-base ${
                  active
                    ? "bg-indigo-soft text-indigo font-medium"
                    : "text-ink-2 hover:text-ink hover:bg-surface-2"
                } ${collapsed ? "justify-center" : ""}`}
              >
                {active && (
                  <span
                    aria-hidden
                    className="absolute left-0 inset-y-1 w-[2px] rounded-full bg-brass"
                  />
                )}
                <Icon />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );

  // Collapsed to icons, or a section with no heading: nothing to open.
  if (!section.label) return <div className="flex flex-col gap-2.5">{items}</div>;
  if (collapsed) {
    return (
      <div className="flex flex-col gap-2.5">
        <div className="mx-3 border-t border-line" />
        {items}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex items-center gap-1.5 px-3 py-1 rounded-md text-brass hover:bg-surface-2 transition-base"
      >
        <IconChevron
          className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className="label">{section.label}</span>
      </button>
      {open && items}
    </div>
  );
}

function NavList({
  sections,
  pathname,
  collapsed,
  onNavigate,
}: {
  sections: ConsoleNavSection[];
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const activeLabel =
    sections.find((sec) =>
      sec.groups.some((g) => g.items.some((i) => isItemActive(i, pathname))),
    )?.label ?? null;

  const [closed, setClosed] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(OPEN_KEY);
      if (raw) setClosed(JSON.parse(raw) as string[]);
    } catch {
      /* every section simply stays open */
    }
  }, []);

  const toggle = (label: string) => {
    setClosed((prev) => {
      const next = prev.includes(label)
        ? prev.filter((l) => l !== label)
        : [...prev, label];
      try {
        window.localStorage.setItem(OPEN_KEY, JSON.stringify(next));
      } catch {
        /* preference simply will not persist */
      }
      return next;
    });
  };

  return (
    <nav aria-label="Console" className="flex flex-col gap-5 py-4">
      {sections.map((section, i) => (
        <NavSection
          key={section.label ?? `s${i}`}
          section={section}
          pathname={pathname}
          collapsed={collapsed}
          open={section.label === activeLabel || !closed.includes(section.label ?? "")}
          onToggle={() => toggle(section.label ?? "")}
          onNavigate={onNavigate}
        />
      ))}
    </nav>
  );
}

function Breadcrumbs({ pathname }: { pathname: string }) {
  const parts = pathname.split("/").filter(Boolean);
  // Drop opaque ids — a uuid or emp_0001 is noise in a breadcrumb.
  const crumbs = parts.filter(
    (p) => SEGMENT_LABELS[p] !== undefined || parts.indexOf(p) === 0,
  );

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 min-w-0">
      {crumbs.map((seg, i) => {
        const href = "/" + parts.slice(0, parts.indexOf(seg) + 1).join("/");
        const last = i === crumbs.length - 1;
        const label = SEGMENT_LABELS[seg] ?? seg;
        return (
          <span key={href + i} className="flex items-center gap-1.5 min-w-0">
            {i > 0 && (
              <IconChevron className="h-3 w-3 text-ink-3 shrink-0" />
            )}
            {last ? (
              <span className="text-sm font-medium truncate">{label}</span>
            ) : (
              <Link
                href={href}
                className="text-sm text-ink-2 hover:text-ink transition-base truncate"
              >
                {label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

function SearchTrigger() {
  const [hint, setHint] = useState("⌘K");

  useEffect(() => {
    if (!/Mac|iPhone|iPad/.test(navigator.platform ?? navigator.userAgent)) {
      setHint("Ctrl K");
    }
  }, []);

  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
      className="hidden sm:flex items-center gap-2 pl-2.5 pr-1.5 py-1.5 rounded-md border border-line text-ink-3 hover:text-ink hover:bg-surface-2 transition-base text-sm min-w-[12rem]"
    >
      <IconSearch className="h-4 w-4" />
      <span className="flex-1 text-left">Search…</span>
      <kbd className="label border border-line rounded-sm px-1.5 py-0.5">{hint}</kbd>
    </button>
  );
}

function UserMenu({
  user,
  signOut,
}: {
  user: ShellUser;
  signOut: React.ReactNode;
}) {
  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("");

  return (
    <DropdownMenu
      align="end"
      trigger={({ onClick, open }) => (
        <button
          type="button"
          onClick={onClick}
          aria-expanded={open}
          aria-haspopup="true"
          className="flex items-center gap-2.5 pl-2 pr-1 py-1.5 rounded-md hover:bg-surface-2 transition-base"
        >
          <span
            aria-hidden
            className="grid h-7 w-7 place-items-center rounded-full bg-surface-3 text-ink-2 text-xs font-medium shrink-0"
          >
            {initials}
          </span>
          <span className="hidden sm:flex flex-col items-start leading-tight min-w-0">
            <span className="text-sm truncate max-w-[10rem]">{user.name}</span>
            <span className="label text-ink-3">{user.role.replace(/_/g, " ")}</span>
          </span>
          <IconChevron className="h-3 w-3 text-ink-3 rotate-90" />
        </button>
      )}
    >
      {() => (
        <div className="w-64">
          <div className="px-4 py-3 border-b border-line-2">
            <p className="text-sm font-medium">{user.name}</p>
            <p className="font-mono text-xs text-ink-2 break-all">{user.email}</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <span className="label px-1.5 py-0.5 rounded-sm bg-surface-2 text-ink-3">
                {user.role.replace(/_/g, " ")}
              </span>
              {user.compensationScope === "none" && (
                <span className="label px-1.5 py-0.5 rounded-sm bg-brass-soft text-brass">
                  Salary masked
                </span>
              )}
            </div>
          </div>
          <DropdownItem>
            <Link href="/console/account" className="block w-full">
              My account
            </Link>
          </DropdownItem>
          <DropdownItem>
            <Link href="/console/account#password" className="block w-full">
              Change password
            </Link>
          </DropdownItem>
          <DropdownItem>
            <Link href="/console/setup" className="block w-full">
              Set up the company
            </Link>
          </DropdownItem>
          <DropdownItem>
            <Link href="/console/settings/users" className="block w-full">
              Accounts &amp; roles
            </Link>
          </DropdownItem>
          <div className="border-t border-line-2" />
          <DropdownItem>
            <Link href="/" className="block w-full">
              Public site
            </Link>
          </DropdownItem>
          <div className="px-4 py-2.5 border-t border-line-2">{signOut}</div>
        </div>
      )}
    </DropdownMenu>
  );
}

export default function ConsoleShell({
  user,
  sections,
  signOut,
  children,
}: {
  user: ShellUser;
  sections: ConsoleNavSection[];
  signOut: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Restore the collapsed preference. Wrapped because storage throws in
  // some embedded contexts.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* no stored preference available */
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, v ? "0" : "1");
      } catch {
        /* preference simply will not persist */
      }
      return !v;
    });
  };

  useEffect(() => setDrawer(false), [pathname]);
  useEffect(() => {
    document.body.style.overflow = drawer ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawer]);

  const sidebarWidth = collapsed ? "lg:w-[4.25rem]" : "lg:w-[15rem]";

  return (
    <ToastProvider>
      <CommandPalette />
      <div className="flex min-h-screen">
        {/* desktop sidebar */}
        <aside
          className={`hidden lg:flex flex-col shrink-0 border-r border-line bg-surface transition-[width] duration-[var(--duration-base)] sticky top-0 h-screen ${sidebarWidth}`}
        >
          <div
            className={`h-14 flex items-center border-b border-line px-3 ${
              collapsed ? "justify-center" : "justify-between"
            }`}
          >
            <Brand collapsed={collapsed} />
            {!collapsed && (
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-label="Collapse sidebar"
                className="p-1.5 rounded-md text-ink-3 hover:text-ink hover:bg-surface-2 transition-base"
              >
                <IconPanel />
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-2">
            <NavList sections={sections} pathname={pathname} collapsed={collapsed} />
          </div>

          {collapsed && (
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label="Expand sidebar"
              className="m-2 p-2 rounded-md text-ink-3 hover:text-ink hover:bg-surface-2 transition-base grid place-items-center"
            >
              <IconPanel />
            </button>
          )}
        </aside>

        {/* mobile drawer */}
        {drawer && (
          <>
            <div
              className="lg:hidden fixed inset-0 z-40 bg-ink/30"
              onClick={() => setDrawer(false)}
              aria-hidden
            />
            <aside className="lg:hidden fixed inset-y-0 left-0 z-50 w-[16rem] border-r border-line bg-surface overflow-y-auto">
              <div className="h-14 flex items-center justify-between border-b border-line px-3">
                <Brand collapsed={false} />
                <button
                  type="button"
                  onClick={() => setDrawer(false)}
                  aria-label="Close menu"
                  className="p-1.5 text-ink-3 hover:text-ink"
                >
                  <IconClose />
                </button>
              </div>
              <div className="px-2">
                <NavList
                  sections={sections}
                  pathname={pathname}
                  collapsed={false}
                  onNavigate={() => setDrawer(false)}
                />
              </div>
            </aside>
          </>
        )}

        {/* main column */}
        <div className="flex-1 flex flex-col min-w-0">
          <header
            data-print="hide"
            className="sticky top-0 z-30 h-14 shrink-0 border-b border-line bg-paper/95 backdrop-blur-sm"
          >
            <div className="h-full px-4 sm:px-6 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => setDrawer(true)}
                  aria-label="Open menu"
                  className="lg:hidden p-1.5 -ml-1.5 text-ink-2 hover:text-ink"
                >
                  <IconMenu />
                </button>
                <Breadcrumbs pathname={pathname} />
              </div>
              <div className="flex items-center gap-3">
                <SearchTrigger />
                <UserMenu user={user} signOut={signOut} />
              </div>
            </div>
          </header>

          <main className="flex-1 px-4 sm:px-6 py-6 min-w-0">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
