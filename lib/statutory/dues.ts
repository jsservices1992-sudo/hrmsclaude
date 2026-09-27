import type { Paise } from "../payroll/money";
import type { CalendarItem, FilingKind, TrackedItem } from "./calendar";

/**
 * What each monthly filing carries, read off the month's pay lines — the
 * same codes the PF, ESIC, TDS, PT and LWF remittances are built from.
 * Returns and quarterly statements move no money of their own, so they
 * carry none.
 */
const CODES: Partial<Record<FilingKind, string[]>> = {
  epf_ecr: ["EPF_EE", "VPF", "EPF_ER", "EPS_ER", "EDLI_ER", "EPF_ADMIN_ER"],
  esic_contribution: ["ESIC_EE", "ESIC_ER"],
  tds_deposit: ["TDS"],
  pt_return: ["PT"],
  lwf_return: ["LWF_EE", "LWF_ER"],
};

type Line = { code: string; amountPaise: Paise; basis?: string | null };

/**
 * The amount a filing will carry for the month. PT and LWF are paid state
 * by state, and each of their lines starts with the state it was charged
 * in ("HR — …"), so a state's filing counts only its own lines.
 */
export function dueAmount(item: Pick<CalendarItem, "kind" | "stateCode">, lines: Line[]): Paise | null {
  const codes = CODES[item.kind];
  if (!codes) return null;
  return lines
    .filter((l) => codes.includes(l.code))
    .filter((l) => !item.stateCode || (l.basis ?? "").startsWith(`${item.stateCode} `))
    .reduce((a, l) => a + l.amountPaise, 0);
}

export type DashboardDue = {
  key: string;
  label: string;
  authority: string;
  companyName: string;
  dueDate: string;
  daysUntilDue: number;
  status: TrackedItem["status"];
  /** Null for a return that moves no money; 0 when nothing is owed this month. */
  amountPaise: Paise | null;
  periodLabel: string;
};

/**
 * The deadlines worth a place on the dashboard: everything not yet filed,
 * soonest first, with overdue ones leading. A monthly remittance with
 * nothing to pay is dropped — there is nothing to deposit.
 */
export function dashboardDues(items: DashboardDue[]): DashboardDue[] {
  return items
    .filter((d) => d.status !== "filed")
    .filter((d) => d.amountPaise === null || d.amountPaise > 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.label.localeCompare(b.label));
}
