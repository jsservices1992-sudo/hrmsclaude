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

export type ConsoleNavGroup = {
  /** Null renders the items without a sub-heading. */
  label: string | null;
  items: ConsoleNavItem[];
};

export type ConsoleNavSection = {
  /** Null renders the section without a top-level heading. */
  label: string | null;
  groups: ConsoleNavGroup[];
};

export const CONSOLE_SECTIONS: ConsoleNavSection[] = [
  {
    /* Always visible, never a section to open: the two things everybody
       lands on. */
    label: null,
    groups: [
      {
        label: null,
        items: [
          { href: "/console", label: "Dashboard", icon: "home", exact: true },
          { href: "/console/reports", label: "Reports", icon: "table" },
        ],
      },
    ],
  },
  {
    label: "Workforce",
    groups: [
      {
        label: "People",
        items: [
          { href: "/console/employees", label: "Employees", icon: "users" },
          { href: "/console/org", label: "Org chart", icon: "sitemap" },
          { href: "/console/onboarding", label: "Onboarding", icon: "userPlus" },
          { href: "/console/exits", label: "Exits & settlement", icon: "userMinus" },
        ],
      },
      {
        /* Attendance and assets keep their own heading — a different daily
           job — but they are still about the same people, so they no longer
           sit in a section of their own. */
        label: "Day to day",
        items: [
          { href: "/console/attendance", label: "Attendance & leave", icon: "calendar" },
          { href: "/console/assets", label: "Assets", icon: "box" },
        ],
      },
    ],
  },
  {
    label: "Payroll",
    groups: [
      {
        /* One door, not four. The register, incentives, and approvals
           were each their own nav item — one workflow with four
           entrances, none of which said what to do next. Run payroll
           is that answer: a status page that already links to every
           one of these, in the order they actually happen. Landing on
           any of them straight (a bookmark, a step link) still lights
           this item up, so where you are stays visible. */
        label: null,
        items: [
          {
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
        ],
      },
      {
        label: "Pay components",
        items: [
          {
            href: "/console/flexi",
            label: "Flexible benefits",
            icon: "sliders",
            needsCompensation: true,
          },
          {
            href: "/console/tax",
            label: "Income tax & TDS",
            icon: "percent",
            needsCompensation: true,
          },
          {
            href: "/console/loans",
            label: "Loans & recoveries",
            icon: "banknote",
            needsCompensation: true,
          },
          {
            href: "/console/banking",
            label: "Banking & accounting",
            icon: "ledger",
            needsCompensation: true,
          },
        ],
      },
    ],
  },
  {
    label: "Compliance",
    groups: [
      {
        label: null,
        items: [
          { href: "/console/compliance", label: "Statutory rules", icon: "shield" },
          {
            href: "/console/statutory",
            label: "Returns & filings",
            icon: "stamp",
            needsCompensation: true,
          },
          { href: "/console/workflows", label: "Workflows", icon: "flow" },
          {
            href: "/console/audit",
            label: "Audit & controls",
            icon: "history",
            needsTenantWide: true,
          },
        ],
      },
    ],
  },
  {
    /* Administration and Governance were two headings over eight items
       nobody visits twice a week. One section, two groups. */
    label: "Settings",
    groups: [
      {
        label: "Organisation",
        items: [
          {
            href: "/console/settings",
            label: "Organisation",
            icon: "building",
            exact: true,
            alsoMatches: ["/console/settings/companies"],
          },
          { href: "/console/setup", label: "Set up", icon: "check" },
          { href: "/console/import", label: "Migrate", icon: "box" },
          { href: "/console/settings/payroll", label: "Payroll settings", icon: "sliders" },
          { href: "/console/settings/master-data", label: "Master data", icon: "table" },
        ],
      },
      {
        label: "Access",
        items: [
          {
            /* Not tenant-wide: a company administrator manages their own
               company's logins. The page scopes what it lists. */
            href: "/console/settings/users",
            label: "Accounts",
            icon: "users",
          },
          { href: "/console/account", label: "My account", icon: "userPlus" },
          { href: "/console/settings/api", label: "API & webhooks", icon: "flow" },
        ],
      },
    ],
  },
];

/** Suggested actions shown in the command palette when the query is empty. */
export const QUICK_ACTIONS: { label: string; href: string; icon: IconName }[] = [
  { href: "/console/employees/new", label: "New employee", icon: "userPlus" },
  { href: "/console/onboarding/new", label: "Start onboarding", icon: "userPlus" },
  { href: "/console/payroll/run", label: "Run payroll", icon: "check" },
  { href: "/console/assets", label: "Assets", icon: "box" },
];

/** Human labels for breadcrumbs, keyed by path segment. */
export const SEGMENT_LABELS: Record<string, string> = {
  console: "Console",
  employees: "Employees",
  org: "Org chart",
  onboarding: "Onboarding",
  assets: "Assets",
  exits: "Exits & settlement",
  attendance: "Attendance & leave",
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
  banking: "Banking & accounting",
  workflows: "Workflows",
  audit: "Audit & controls",
  reports: "Reports",
  api: "API & webhooks",
  inputs: "Incentives & deductions",
  run: "Run payroll",
  "master-data": "Master data",
  account: "My account",
  new: "New",
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
