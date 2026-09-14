/**
 * Open positions, department by department.
 *
 * "How many can we still hire" is not simply approved headcount minus
 * bodies at desks. Someone serving notice is still on the payroll but
 * their seat is already free to fill, and a joiner who has accepted has
 * not started yet but their seat is already taken. Counting only current
 * employees double-hires on both counts — once for every leaver, and
 * again for every offer already out.
 */

export type DepartmentPlan = {
  departmentId: string | null;
  code: string;
  name: string;
  /** Budgeted headcount; null when nobody has set one. */
  approved: number | null;
  /** On the payroll today, including anyone serving notice. */
  filled: number;
  /** Of `filled`, those on the way out — their seats free up. */
  leaving: number;
  /** Accepted or in-flight joiners already allocated to this department. */
  incoming: number;
};

export type DepartmentHiring = DepartmentPlan & {
  /** Seats committed once the leavers go and the joiners start. */
  projected: number;
  /** Still to hire against the plan. Never negative — see `overBudget`. */
  openPositions: number;
  /** Committed beyond the plan, when that has happened. */
  overBudget: number;
  /** Null when no plan is set, so the UI can say "not set" not "0%". */
  utilisationPercent: number | null;
};

export type HiringSummary = {
  departments: DepartmentHiring[];
  totalApproved: number;
  totalProjected: number;
  totalOpen: number;
  totalIncoming: number;
  totalLeaving: number;
  /** Departments with a plan set, of those that exist. */
  planned: number;
  unplanned: number;
};

export function computeHiring(plan: DepartmentPlan): DepartmentHiring {
  const projected = plan.filled - plan.leaving + plan.incoming;
  const approved = plan.approved;

  // No plan set is not the same as a plan of zero: there is nothing to be
  // open or over against, so both read as zero and the UI says "not set".
  const gap = approved === null ? 0 : approved - projected;

  return {
    ...plan,
    projected,
    openPositions: Math.max(0, gap),
    overBudget: Math.max(0, -gap),
    utilisationPercent:
      approved === null || approved === 0
        ? approved === 0
          ? 0
          : null
        : Math.round((projected / approved) * 100),
  };
}

export function summariseHiring(plans: DepartmentPlan[]): HiringSummary {
  const departments = plans
    .map(computeHiring)
    .sort((a, b) => b.openPositions - a.openPositions || a.name.localeCompare(b.name));

  return {
    departments,
    totalApproved: departments.reduce((a, d) => a + (d.approved ?? 0), 0),
    totalProjected: departments.reduce((a, d) => a + d.projected, 0),
    totalOpen: departments.reduce((a, d) => a + d.openPositions, 0),
    totalIncoming: departments.reduce((a, d) => a + d.incoming, 0),
    totalLeaving: departments.reduce((a, d) => a + d.leaving, 0),
    planned: departments.filter((d) => d.approved !== null).length,
    unplanned: departments.filter((d) => d.approved === null).length,
  };
}
