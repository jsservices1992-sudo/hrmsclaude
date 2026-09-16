import type { BadgeTone } from "@/components/console/ui";

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Statuses where calculating the period again simply replaces the figures,
 * under the same version number. Past these, a run is signed off and only
 * a reopen — which creates a new version — may touch it.
 *
 * Shared so that the guard in the calculate action and what the payslip
 * tells the reader about its own figures cannot drift apart.
 */
export const RECALCULABLE_STATUSES = ["draft", "calculated", "in_review"];

export function isRecalculable(status: string | null | undefined): boolean {
  return RECALCULABLE_STATUSES.includes(status ?? "");
}

/** How far through its lifecycle a run is, at a glance. */
export const STATUS_TONE: Record<string, BadgeTone> = {
  draft: "neutral",
  inputs_locked: "neutral",
  calculated: "brass",
  in_review: "brass",
  approved: "teal",
  finalised: "teal",
  disbursed: "indigo",
  closed: "neutral",
};

/**
 * Segregation of duties: whoever prepared a run may not also approve it,
 * and only a run that has been calculated and not yet signed off is even
 * a candidate.
 */
export function canApproveRun(
  user: { email: string },
  run: { status: string; preparedBy: string | null },
  canMutate: boolean,
): boolean {
  if (!canMutate) return false;
  if (!["calculated", "in_review"].includes(run.status)) return false;
  return run.preparedBy !== user.email;
}

/**
 * The month as a process, not a menu.
 *
 * Paying people is a sequence: the master data has to be right, then
 * attendance settles the days, then this month's extras go in, then it is
 * calculated, reviewed, approved by a second person, and only then does
 * money move and the period close. Every one of those steps already
 * existed in the product — as separate screens with no idea of each
 * other, so nothing ever said what was done, what was blocking, or what
 * to do next. This assembles that state.
 */

export type StepState =
  | "done"
  | "ready" // nothing wrong, waiting to be actioned
  | "attention" // usable, but something is worth a look
  | "blocked" // cannot proceed until resolved
  | "waiting"; // an earlier step has to happen first

export type RunStepId =
  | "people"
  | "attendance"
  | "variable"
  | "calculate"
  | "review"
  | "approve"
  | "payslips"
  | "disburse"
  | "close";

export type RunStep = {
  id: RunStepId;
  title: string;
  state: StepState;
  /** One line of fact, not instruction. */
  detail: string;
  /** Where the work happens. */
  href?: string;
  actionLabel?: string;
  /** Counts worth showing as a chip. */
  blockingCount?: number;
  warningCount?: number;
};

export type RunStatusInput = {
  activeEmployees: number;
  missingSalary: number;
  missingBank: number;

  lopTotalDays: number;
  pendingLeave: number;
  pendingRegularisation: number;
  attendanceFinalised: boolean;

  variablePayCount: number;
  variablePayNetPaise: number;

  /** Null when the period has never been calculated. */
  run: { version: number; status: string; employees: number } | null;

  criticalExceptions: number;
  warningExceptions: number;

  /** Whether the signed-in user is the one who prepared the run. */
  viewerPreparedRun: boolean;
};

const APPROVED_ONWARDS = ["approved", "finalised", "disbursed", "closed"];

function money(paise: number): string {
  const sign = paise < 0 ? "−" : "";
  return `${sign}₹${Math.abs(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function buildRunSteps(i: RunStatusInput, query: string): RunStep[] {
  const calculated = i.run !== null;
  const approved = i.run !== null && APPROVED_ONWARDS.includes(i.run.status);
  const disbursed = i.run !== null && ["disbursed", "closed"].includes(i.run.status);
  const closed = i.run?.status === "closed";

  const steps: RunStep[] = [];

  /* 1 — the master data every later step depends on */
  const peopleProblems = i.missingSalary + i.missingBank;
  steps.push({
    id: "people",
    title: "People & salary",
    state: peopleProblems > 0 ? "blocked" : "done",
    detail:
      peopleProblems === 0
        ? `${i.activeEmployees} active, all with salary and bank details`
        : [
            i.missingSalary > 0 ? `${i.missingSalary} without salary` : null,
            i.missingBank > 0 ? `${i.missingBank} without bank details` : null,
          ]
            .filter(Boolean)
            .join(", "),
    blockingCount: peopleProblems || undefined,
    href: "/console/employees",
    actionLabel: "Employees",
  });

  /* 2 — attendance settles how many days are actually paid */
  const attendancePending = i.pendingLeave + i.pendingRegularisation;
  steps.push({
    id: "attendance",
    title: "Attendance & leave",
    state: !i.attendanceFinalised ? "attention" : attendancePending > 0 ? "attention" : "done",
    detail: [
      i.lopTotalDays > 0
        ? `${i.lopTotalDays.toFixed(2)} day(s) will not be paid`
        : "Every active day is paid",
      attendancePending > 0 ? `${attendancePending} awaiting a decision` : null,
      !i.attendanceFinalised ? "changed since the last calculation" : null,
    ]
      .filter(Boolean)
      .join(" · "),
    warningCount: attendancePending || undefined,
    href: `/console/attendance?${query}`,
    actionLabel: "Attendance",
  });

  /* 3 — this month's extras */
  steps.push({
    id: "variable",
    title: "Incentives & deductions",
    state: i.variablePayCount === 0 ? "ready" : "done",
    detail:
      i.variablePayCount === 0
        ? "Nothing added — a bonus, an incentive, overtime, or a one-off deduction"
        : `${i.variablePayCount} entr${i.variablePayCount === 1 ? "y" : "ies"} · ${money(i.variablePayNetPaise)} net`,
    href: `/console/payroll/inputs?${query}`,
    actionLabel: "Add one",
  });

  /* 4 — calculate */
  steps.push({
    id: "calculate",
    title: "Calculate",
    state: peopleProblems > 0 ? "waiting" : calculated ? "done" : "ready",
    detail: calculated
      ? `Version ${i.run!.version} · ${i.run!.employees} employees · ${i.run!.status.replace(/_/g, " ")}`
      : peopleProblems > 0
        ? "Resolve the master-data problems above first"
        : "Not yet calculated for this period",
    href: `/console/runs?${query}`,
    actionLabel: calculated ? "Recalculate" : "Calculate",
  });

  /* 5 — review what it produced */
  steps.push({
    id: "review",
    title: "Review",
    state: !calculated
      ? "waiting"
      : i.criticalExceptions > 0
        ? "blocked"
        : i.warningExceptions > 0
          ? "attention"
          : "done",
    detail: !calculated
      ? "Calculate the period first"
      : i.criticalExceptions > 0
        ? `${i.criticalExceptions} blocking · ${i.warningExceptions} advisory`
        : i.warningExceptions > 0
          ? `${i.warningExceptions} advisory finding(s)`
          : "Every check passed",
    blockingCount: i.criticalExceptions || undefined,
    warningCount: i.warningExceptions || undefined,
    href: `/console/payroll?${query}&tab=findings`,
    actionLabel: "Findings",
  });

  /* 6 — a second person signs it off */
  steps.push({
    id: "approve",
    title: "Approve",
    state: !calculated
      ? "waiting"
      : approved
        ? "done"
        : i.criticalExceptions > 0
          ? "blocked"
          : i.viewerPreparedRun
            ? "attention"
            : "ready",
    detail: approved
      ? `Approved · version ${i.run!.version}`
      : !calculated
        ? "Nothing to approve yet"
        : i.criticalExceptions > 0
          ? "Blocked by the findings above"
          : i.viewerPreparedRun
            ? "You prepared this run — a second person must approve it"
            : "Ready for your approval",
    href: `/console/runs?${query}`,
    actionLabel: "Runs & approvals",
  });

  /* 7 — what the employee gets */
  steps.push({
    id: "payslips",
    title: "Payslips",
    /* Provisional until the run is signed off, final after — and they
       stay available for good once the period closes. */
    state: !calculated ? "waiting" : approved ? "done" : "ready",
    detail: !calculated
      ? "Available once the period is calculated"
      : approved
        ? "Final — one per employee"
        : "Provisional until the run is approved",
    href: `/console/payroll/payslips?${query}`,
    actionLabel: "Payslips",
  });

  /* 8 — money actually moves */
  steps.push({
    id: "disburse",
    title: "Bank file & disbursement",
    state: disbursed ? "done" : approved ? "ready" : "waiting",
    detail: disbursed
      ? "Paid"
      : approved
        ? "Download the bank sheet and send it to the bank"
        : "Money may only move against an approved run",
    href: `/console/banking?${query}`,
    actionLabel: "Banking",
  });

  /* 9 — shut the period */
  steps.push({
    id: "close",
    title: "Reconcile & lock",
    state: closed ? "done" : disbursed ? "ready" : "waiting",
    detail: closed
      ? "Period closed"
      : disbursed
        ? "Reconcile the payments, then close the period"
        : "Closes once salaries are paid",
    href: `/console/banking?${query}`,
    actionLabel: "Reconcile",
  });

  return steps;
}

/** The step the user should act on now — the first not already done. */
export function nextStep(steps: RunStep[]): RunStep | null {
  return (
    steps.find((s) => s.state === "blocked") ??
    steps.find((s) => s.state === "ready" || s.state === "attention") ??
    null
  );
}

export function progressOf(steps: RunStep[]): { done: number; total: number } {
  return { done: steps.filter((s) => s.state === "done").length, total: steps.length };
}
