/**
 * What an employee is allowed to see of their own pay.
 *
 * The console deliberately shows figures before a run exists, because
 * that is how payroll is checked. The employee portal must not: a net
 * pay shown to someone in week two and a different one paid in week four
 * is the single fastest way to lose their trust in the system. So a
 * period reaches the portal only once the run carrying it has been
 * approved — after that the figures are of record and cannot move
 * without a visible revision.
 */
export const PUBLISHED_RUN_STATUSES = [
  "approved",
  "finalised",
  "disbursed",
  "closed",
] as const;

export type PublishedRunStatus = (typeof PUBLISHED_RUN_STATUSES)[number];

/** True once the run's figures are of record rather than in progress. */
export function isPublishedToEmployee(status: string): boolean {
  return (PUBLISHED_RUN_STATUSES as readonly string[]).includes(status);
}

/**
 * What to tell the employee about a period that is not published, so the
 * portal explains rather than showing an unexplained blank.
 */
export function unpublishedReason(status: string | null): string {
  if (!status) return "Payroll for this month has not been run yet.";
  switch (status) {
    case "draft":
    case "inputs_locked":
      return "Payroll for this month is still being prepared.";
    case "calculated":
    case "in_review":
      return "Payroll for this month is calculated but not yet approved. Your payslip appears here once it is.";
    default:
      return "Your payslip for this month is not available yet.";
  }
}
