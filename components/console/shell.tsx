"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { SITE } from "@/lib/site";
import {
  SEGMENT_LABELS,
  isItemActive,
  type ConsoleNavEntry,
} from "@/lib/console-nav";
import { COMPANY_COOKIE } from "@/lib/company-cookie";
import { ICONS, IconMenu, IconClose, IconPanel, IconChevron, IconSearch } from "./icons";
import { DropdownMenu, DropdownItem } from "./ui/dropdown-menu";
import { ToastProvider } from "./ui/toast";
import { CommandPalette } from "./command-palette";
import { useStored } from "./use-stored";

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
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-indigo text-on-indigo font-display text-lg font-bold leading-none shadow-sm"
      >
        ल
      </span>
      {!collapsed && (
        <span className="font-display text-lg font-bold tracking-tight truncate">
          {SITE.name}
        </span>
      )}
    </Link>
  );
}

// "1" is what earlier versions wrote; both still read as collapsed.
const parseBool = (raw: string) => raw === "1" || raw === "true";

const macHint = () => "⌘K";
const noResubscribe = () => () => {};
const readShortcutHint = () =>
  /Mac|iPhone|iPad/.test(navigator.platform ?? navigator.userAgent)
    ? "⌘K"
    : "Ctrl K";

/**
 * Seven destinations. The one you are inside opens to show its pages;
 * the rest stay one line each, so the list is short enough to read at a
 * glance and where you are is never in doubt.
 */
function NavList({
  nav,
  pathname,
  collapsed,
  onNavigate,
}: {
  nav: ConsoleNavEntry[];
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Console" className="flex flex-col gap-0.5 py-3">
      {nav.map((entry) => {
        const active = isItemActive(entry, pathname);
        const Icon = ICONS[entry.icon];
        const open = active && !collapsed && (entry.children?.length ?? 0) > 1;
        return (
          <div key={entry.label}>
            <Link
              href={entry.href}
              onClick={onNavigate}
              aria-current={active && !entry.children ? "page" : undefined}
              title={collapsed ? entry.label : undefined}
              className={`flex items-center gap-2.5 px-3 min-h-10 rounded-lg text-sm transition-base focus-visible:shadow-ring ${
                !active
                  ? "text-ink-2 hover:text-ink hover:bg-surface-2"
                  : open
                    ? "text-ink font-semibold"
                    : "bg-indigo-soft text-indigo font-semibold"
              } ${collapsed ? "justify-center" : ""}`}
            >
              <span className={active ? "text-indigo" : ""}>
                <Icon />
              </span>
              {!collapsed && <span className="truncate">{entry.label}</span>}
            </Link>
            {open && (
              <ul className="mt-0.5 mb-1.5 ml-[1.35rem] border-l border-line pl-2 flex flex-col gap-0.5">
                {entry.children!.map((child) => {
                  const on = isItemActive(child, pathname);
                  return (
                    <li key={child.href}>
                      <Link
                        href={child.href}
                        onClick={onNavigate}
                        aria-current={on ? "page" : undefined}
                        className={`block px-2.5 py-1.5 rounded-md text-[13px] transition-base focus-visible:shadow-ring ${
                          on ? "bg-indigo-soft text-indigo font-semibold" : "text-ink-2 hover:text-ink hover:bg-surface-2"
                        }`}
                      >
                        {child.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}

/* Written here as well as by proxy.ts, so the choice holds even on a
   page reached without ?company= in its address. */
function rememberCompany(id: string | null) {
  document.cookie = `${COMPANY_COOKIE}=${id ?? "all"}; path=/; max-age=31536000; samesite=lax`;
}

/* A uuid, or a code with digits in it — a record, not a section. */
const looksLikeRecord = (seg: string) => /\d/.test(seg) && seg.length > 6;

/**
 * The one place a company is chosen. Switching keeps you on the same
 * screen for the new company; on a single record (an employee, a run)
 * it steps back to the list, because that record belongs to the old one.
 */
function CompanySwitcher({
  companies,
  selected,
  wide = false,
}: {
  companies: { id: string; name: string }[];
  selected: string | null;
  /** Full-width, two-line, for the top of the sidebar. */
  wide?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  /* A company's own settings page names it in the path, not the query. */
  const fromPath = pathname.match(/^\/console\/settings\/companies\/([^/]+)/)?.[1] ?? null;
  const fromUrl = fromPath ?? params.get("company");
  const current =
    (fromUrl && companies.some((c) => c.id === fromUrl) ? fromUrl : null) ?? selected;
  const currentName = companies.find((c) => c.id === current)?.name ?? "All companies";

  const choose = (id: string | null) => {
    rememberCompany(id);
    const parts = pathname.split("/");
    const cut = parts.findIndex(looksLikeRecord);
    const path = cut > 0 ? parts.slice(0, cut).join("/") : pathname;
    const next = new URLSearchParams(cut > 0 ? "" : params.toString());
    if (id) next.set("company", id);
    else next.set("company", "");
    router.push(`${path}?${next.toString()}`);
  };

  return (
    <DropdownMenu
      align="start"
      block={wide}
      trigger={({ onClick, open }) =>
        wide ? (
          <button
            type="button"
            onClick={onClick}
            aria-expanded={open}
            aria-haspopup="true"
            aria-label={`Company: ${currentName}. Change company`}
            className="flex w-full items-center gap-2.5 rounded-lg border border-line bg-surface px-2.5 py-2 text-left hover:bg-surface-2 transition-base focus-visible:shadow-ring"
          >
            <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-indigo-soft text-xs font-bold text-indigo">
              {currentName.slice(0, 2).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">{currentName}</span>
              <span className="block text-xs text-ink-3">{current ? "Company" : `${companies.length} companies`}</span>
            </span>
            <IconChevron className="h-3 w-3 shrink-0 text-ink-3 rotate-90" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onClick}
            aria-expanded={open}
            aria-haspopup="true"
            aria-label={`Company: ${currentName}. Change company`}
            className="flex items-center gap-2 min-h-9 max-w-[12rem] rounded-lg border border-line bg-surface px-2.5 text-sm font-semibold text-ink hover:bg-surface-2 transition-base focus-visible:shadow-ring"
          >
            <span aria-hidden className="grid h-5 w-5 shrink-0 place-items-center rounded bg-indigo-soft text-[10px] font-bold text-indigo">
              {currentName.slice(0, 1).toUpperCase()}
            </span>
            <span className="truncate">{currentName}</span>
            <IconChevron className="h-3 w-3 shrink-0 text-ink-3 rotate-90" />
          </button>
        )
      }
    >
      {({ close }) => (
        <div className="w-64">
          <p className="px-3 pt-2 pb-1 text-xs font-semibold text-ink-3">Show</p>
          {[{ id: null as string | null, name: "All companies" }, ...companies].map((c) => {
            const on = c.id === current;
            return (
              <DropdownItem
                key={c.id ?? "all"}
                aria-checked={on}
                role="menuitemradio"
                onClick={() => {
                  close();
                  choose(c.id);
                }}
                className={`flex items-center justify-between gap-3 ${on ? "text-indigo font-semibold" : ""}`}
              >
                <span className="truncate">{c.name}</span>
                {on && <span aria-hidden>✓</span>}
              </DropdownItem>
            );
          })}
        </div>
      )}
    </DropdownMenu>
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
  /* Which key this machine actually uses. Subscribed to rather than set
     from an effect, so the server's markup and the first client render
     agree on ⌘K and the correction, if any, arrives without a second
     pass through state. */
  const hint = useSyncExternalStore(noResubscribe, readShortcutHint, macHint);

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
            className="grid h-7 w-7 place-items-center rounded-full bg-indigo text-on-indigo text-xs font-semibold shrink-0"
          >
            {initials}
          </span>
          <span className="hidden sm:flex flex-col items-start leading-tight min-w-0">
            <span className="text-sm truncate max-w-[10rem]">{user.name}</span>
            <span className="label text-ink-3 capitalize">{user.role.replace(/_/g, " ")}</span>
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
              <span className="label px-2 py-0.5 rounded-full bg-surface-2 text-ink-3 capitalize">
                {user.role.replace(/_/g, " ")}
              </span>
              {user.compensationScope === "none" && (
                <span className="label px-1.5 py-0.5 rounded-sm bg-amber-soft text-amber">
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
  nav,
  companies,
  selectedCompany,
  signOut,
  children,
}: {
  user: ShellUser;
  nav: ConsoleNavEntry[];
  companies: { id: string; name: string }[];
  selectedCompany: string | null;
  signOut: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  /* Which page the drawer was opened on, rather than a plain boolean and
     an effect that closes it again on every navigation: following a link
     changes the path, and the drawer belonging to the page you have left
     is simply no longer open. */
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const drawer = openedAt === pathname;
  const setDrawer = (next: boolean) => setOpenedAt(next ? pathname : null);
  const [collapsed, setCollapsed] = useStored(COLLAPSE_KEY, false, parseBool);

  const toggleCollapsed = () => setCollapsed(!collapsed);
  useEffect(() => {
    if (!drawer) return;
    /* `overflow: hidden` alone does not stop touch scrolling on iOS
       Safari — the page behind keeps moving under the drawer, which is
       what "the menu won't open, the page is stuck" turns out to be:
       the drawer is there, but the layout viewport is scrolling under
       a `fixed` sheet computed against a stale scroll position. Pinning
       the body in place with its own scroll offset, the way every mobile
       drawer library does it, is what actually holds it still. */
    const { body } = document;
    const scrollY = window.scrollY;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      window.scrollTo(0, scrollY);
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

          {!collapsed && companies.length > 1 && (
            <div className="px-3 pt-3">
              <Suspense fallback={null}>
                <CompanySwitcher companies={companies} selected={selectedCompany} wide />
              </Suspense>
            </div>
          )}
          <div className="flex-1 overflow-y-auto px-2">
            <NavList nav={nav} pathname={pathname} collapsed={collapsed} />
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
                  nav={nav}
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
            className="sticky top-0 z-30 h-14 shrink-0 border-b border-line bg-surface/90 backdrop-blur-md"
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
                {companies.length > 1 && (
                  <div className={collapsed ? "" : "lg:hidden"}>
                    <Suspense fallback={null}>
                      <CompanySwitcher companies={companies} selected={selectedCompany} />
                    </Suspense>
                  </div>
                )}
                <div className={companies.length > 1 ? "hidden md:block min-w-0" : "min-w-0"}>
                  <Breadcrumbs pathname={pathname} />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <SearchTrigger />
                <UserMenu user={user} signOut={signOut} />
              </div>
            </div>
          </header>

          <main className="flex-1 min-w-0 px-4 py-6 sm:px-8 sm:py-8">
            <div className="mx-auto w-full max-w-[84rem]">{children}</div>
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
