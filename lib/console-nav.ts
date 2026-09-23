import type { IconName } from "@/components/console/icons";

export type ConsoleNavItem = {
  href: string;
  label: string;
  icon: IconName;
  /** Hidden from roles with no compensation visibility. */
  needsCompensation?: boolean;
  /** Hidden from users confined to a single legal entity. */
  needsTenantWide?: boolean;
  /** Match only this exact path, not its children. */
  exact?: boolean;
  /** Extra paths that should light this item up. */
  alsoMatches?: string[];
};

/**
 * A top-level destination. Seven of them, named for the job somebody
 * came to do — not for how the code is split. One with `children` is a
 * module: it opens to show its pages while you are inside it.
 */
export type ConsoleNavEntry = ConsoleNavItem & { children?: ConsoleNavItem[] };

export const CONSOLE_NAV: ConsoleNavEntry[] = [
  { href: "/console", label: "Home", icon: "home", exact: true },
  {
    href: "/console/employees",
    label: "People",
    icon: "users",
    alsoMatches: ["/console/org", "/console/onboarding", "/console/exits", "/console/assets"],
    children: [
      { href: "/console/employees", label: "Employees", icon: "users" },
      { href: "/console/org", label: "Org chart", icon: "sitemap" },
      { href: "/console/onboarding", label: "Joiners", icon: "userPlus" },
      { href: "/console/exits", label: "Leavers & settlement", icon: "userMinus" },
      { href: "/console/assets", label: "Assets", icon: "box" },
    ],
  },
  { href: "/console/attendance", label: "Attendance", icon: "calendar" },
  {
    href: "/console/payroll/run",
    label: "Payroll",
    icon: "banknote",
    needsCompensation: true,
    alsoMatches: [
      "/console/payroll",
      "/console/payslip",
      "/console/runs",
      "/console/tax",
      "/console/loans",
      "/console/flexi",
      "/console/banking",
    ],
    children: [
      {
        /* One door, not four: the register, incentives, payslips and
           approvals are steps of the month, reached from here. */
        href: "/console/payroll/run",
        label: "Run payroll",
        icon: "check",
        needsCompensation: true,
        alsoMatches: [
          "/console/payroll",
          "/console/payroll/inputs",
          "/console/payroll/payslips",
          "/console/payslip",
          "/console/runs",
        ],
      },
      { href: "/console/banking", label: "Bank & accounting", icon: "ledger", needsCompensation: true },
      { href: "/console/tax", label: "Income tax & TDS", icon: "percent", needsCompensation: true },
      { href: "/console/loans", label: "Loans & recoveries", icon: "banknote", needsCompensation: true },
      { href: "/console/flexi", label: "Flexible benefits", icon: "sliders", needsCompensation: true },
    ],
  },
  {
    href: "/console/statutory",
    label: "Compliance",
    icon: "shield",
    alsoMatches: ["/console/compliance", "/console/audit"],
    children: [
      { href: "/console/statutory", label: "Returns & filings", icon: "stamp", needsCompensation: true },
      { href: "/console/compliance", label: "Statutory rules", icon: "shield" },
      { href: "/console/audit", label: "Audit log", icon: "history", needsTenantWide: true },
    ],
  },
  { href: "/console/reports", label: "Reports", icon: "table" },
  {
    href: "/console/settings",
    label: "Settings",
    icon: "building",
    alsoMatches: ["/console/setup", "/console/import", "/console/workflows", "/console/account"],
    children: [
      {
        href: "/console/settings",
        label: "Company",
        icon: "building",
        exact: true,
        alsoMatches: ["/console/settings/companies"],
      },
      { href: "/console/settings/payroll", label: "Payroll rules", icon: "sliders" },
      { href: "/console/settings/master-data", label: "Master data", icon: "table" },
      { href: "/console/settings/users", label: "Users & access", icon: "users" },
      { href: "/console/workflows", label: "Approval workflows", icon: "flow" },
      { href: "/console/import", label: "Import data", icon: "box" },
      { href: "/console/settings/api", label: "API & webhooks", icon: "flow" },
      { href: "/console/setup", label: "Setup checklist", icon: "check" },
    ],
  },
];

/** The nav a given user sees: hidden pages are never named to them. */
export function navFor(
  can: { compensation: boolean; tenantWide: boolean },
  nav: ConsoleNavEntry[] = CONSOLE_NAV,
): ConsoleNavEntry[] {
  const allowed = (i: ConsoleNavItem) =>
    (!i.needsCompensation || can.compensation) && (!i.needsTenantWide || can.tenantWide);
  return nav
    .map((e) => (e.children ? { ...e, children: e.children.filter(allowed) } : e))
    .filter((e) => allowed(e) && (!e.children || e.children.length > 0))
    .map((e) =>
      /* A module whose first page is hidden opens on the first one left. */
      e.children && !e.children.some((c) => c.href === e.href) ? { ...e, href: e.children[0].href } : e,
    );
}

/** Every page in the nav, flat — what the command palette offers as "Go to". */
export function navPages(nav: ConsoleNavEntry[]): { href: string; label: string; module: string }[] {
  return nav.flatMap((e) =>
    e.children
      ? e.children.map((c) => ({ href: c.href, label: c.label, module: e.label }))
      : [{ href: e.href, label: e.label, module: "" }],
  );
}

/** Suggested actions shown in the command palette when the query is empty. */
export const QUICK_ACTIONS: { label: string; href: string; icon: IconName }[] = [
  { href: "/console/employees/new", label: "New employee", icon: "userPlus" },
  { href: "/console/onboarding/new", label: "Start onboarding", icon: "userPlus" },
  { href: "/console/payroll/run", label: "Run payroll", icon: "check" },
  { href: "/console/assets", label: "Assets", icon: "box" },
];

/** Human labels for breadcrumbs, keyed by path segment. */
export const SEGMENT_LABELS: Record<string, string> = {
  console: "Home",
  employees: "Employees",
  org: "Org chart",
  onboarding: "Joiners",
  assets: "Assets",
  exits: "Leavers & settlement",
  attendance: "Attendance",
  payroll: "Payroll",
  payslip: "Payslip",
  runs: "Runs & approvals",
  compliance: "Statutory rules",
  settings: "Settings",
  companies: "Companies",
  flexi: "Flexible benefits",
  tax: "Income tax & TDS",
  loans: "Loans & recoveries",
  statutory: "Returns & filings",
  banking: "Bank & accounting",
  workflows: "Approval workflows",
  audit: "Audit log",
  reports: "Reports",
  api: "API & webhooks",
  inputs: "Incentives & deductions",
  run: "Run payroll",
  "master-data": "Master data",
  account: "My account",
  new: "New",
  import: "Import data",
  setup: "Setup checklist",
  users: "Users & access",
};

export function isItemActive(item: ConsoleNavItem, pathname: string): boolean {
  if (item.exact) {
    if (pathname === item.href) return true;
  } else if (pathname === item.href || pathname.startsWith(item.href + "/")) {
    return true;
  }
  return (item.alsoMatches ?? []).some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}
