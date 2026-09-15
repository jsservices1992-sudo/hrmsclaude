import type { CompensationScope, Principal, Role } from "./permissions";

/**
 * Who may create and change accounts, and which accounts make sense.
 *
 * Managing users is the one screen that can hand out every other
 * permission in the product, so it is narrower than "can mutate": a
 * payroll manager may run payroll but may not mint themselves an
 * administrator. The rules below are the ones that stop an instance
 * being locked out of itself or quietly escalated, and they are pure so
 * that each has a test rather than a comment claiming it holds.
 */

export function canManageUsers(p: Pick<Principal, "role">): boolean {
  return p.role === "admin";
}

export const ASSIGNABLE_ROLES: { role: Role; label: string; note: string }[] = [
  { role: "admin", label: "Administrator", note: "Everything, including these accounts" },
  { role: "payroll_manager", label: "Payroll manager", note: "Runs, compensation and approvals" },
  { role: "hr_manager", label: "HR manager", note: "People and attendance; pay figures masked" },
  { role: "auditor", label: "Auditor", note: "Read-only; cannot change anything" },
  { role: "employee", label: "Employee", note: "Self-service only — must be linked to a record" },
];

export const SCOPE_LABELS: { scope: CompensationScope; label: string }[] = [
  { scope: "none", label: "No pay data" },
  { scope: "own", label: "Their own payslip only" },
  { scope: "company", label: "Their company's pay data" },
  { scope: "all", label: "Every company's pay data" },
];

export type UserDraft = {
  email: string;
  name: string;
  role: Role;
  /** Null means every company in the tenant. */
  companyId: string | null;
  employeeId: string | null;
  compensationScope: CompensationScope;
  active: boolean;
};

export type UserIssue = string;

/** Whether an account's settings are coherent on their own terms. */
export function checkUserDraft(draft: UserDraft): UserIssue[] {
  const issues: UserIssue[] = [];

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) {
    issues.push("That is not an email address.");
  }
  if (!draft.name.trim()) issues.push("A name is required.");

  if (draft.role === "employee") {
    if (!draft.employeeId) {
      issues.push(
        "An employee account must be linked to an employee record — that link is what self-service checks before showing anyone their own pay.",
      );
    }
    if (draft.compensationScope === "company" || draft.compensationScope === "all") {
      issues.push(
        "An employee account cannot be given other people's pay data. Use “their own payslip only”.",
      );
    }
  }

  if (draft.compensationScope === "all" && draft.companyId !== null) {
    issues.push(
      "Every company's pay data only makes sense for an account that is not confined to one company.",
    );
  }

  if (draft.role === "auditor" && draft.compensationScope === "own") {
    issues.push("An auditor reviews other people's figures, not their own.");
  }

  /* A payroll manager whose scope is "none" or "own" can sign in and do
     nothing: every page they exist for — runs, registers, settlements —
     is gated on seeing company pay data, so they are bounced off each
     one without being told why. The role and the scope have to agree. */
  if (
    draft.role === "payroll_manager" &&
    draft.compensationScope !== "company" &&
    draft.compensationScope !== "all"
  ) {
    issues.push(
      "A payroll manager needs access to this company's pay data — otherwise every payroll screen refuses them. Choose “this company's pay”.",
    );
  }

  return issues;
}

export type LockoutContext = {
  /** The account being changed. */
  targetUserId: string;
  targetRole: Role;
  targetActive: boolean;
  /** Who is making the change. */
  actorUserId: string;
  /** Active administrators in the instance, including the target. */
  activeAdminIds: string[];
};

/**
 * The two ways an instance loses its administrator: the last one
 * deactivates themselves, or the last one is demoted. Both look like
 * ordinary edits until nobody can sign in to undo them.
 */
export function checkNoLockout(
  ctx: LockoutContext,
  next: { role: Role; active: boolean },
): UserIssue[] {
  const issues: UserIssue[] = [];

  if (ctx.targetUserId === ctx.actorUserId) {
    if (next.role !== ctx.targetRole) {
      issues.push("You cannot change your own role. Ask another administrator.");
    }
    if (!next.active) {
      issues.push("You cannot deactivate your own account.");
    }
  }

  const losingAnAdmin =
    ctx.targetRole === "admin" &&
    ctx.targetActive &&
    (next.role !== "admin" || !next.active);

  if (losingAnAdmin && ctx.activeAdminIds.filter((id) => id !== ctx.targetUserId).length === 0) {
    issues.push(
      "This is the only active administrator. Promote someone else first, or nobody can administer this instance.",
    );
  }

  return issues;
}

/**
 * The pay access each role is created with.
 *
 * A default, not a rule — an administrator can widen or narrow it. It
 * exists because the previous default was "none" for everybody, which
 * quietly produced payroll managers who could sign in and reach none of
 * the screens their role is for.
 */
export const SCOPE_FOR_ROLE: Record<string, string> = {
  admin: "company",
  payroll_manager: "company",
  hr_manager: "none",
  auditor: "company",
  employee: "own",
};
