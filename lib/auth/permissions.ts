/**
 * Authorisation rules, kept pure so they can be tested.
 *
 * These used to live beside the session code, which imports server-only
 * modules and so could not be tested at all. That is how scope "own" came
 * to pass a check meant for company-wide pay data: nothing exercised it.
 */

export type Role =
  | "admin"
  | "payroll_manager"
  | "hr_manager"
  | "auditor"
  | "employee";

export type CompensationScope = "none" | "own" | "company" | "all";

export type Principal = {
  email: string;
  role: Role;
  companyId: string | null;
  employeeId: string | null;
  compensationScope: CompensationScope;
};

const CONSOLE_ROLES: Role[] = ["admin", "payroll_manager", "hr_manager", "auditor"];

export function canAccessConsole(p: Pick<Principal, "role">): boolean {
  return CONSOLE_ROLES.includes(p.role);
}

/** Only these roles may change anything. The auditor is read-only by design. */
export function canMutate(p: Pick<Principal, "role">): boolean {
  return p.role === "admin" || p.role === "payroll_manager";
}

/**
 * Decisions about a person's employment rather than their pay: hiring
 * them, recording an exit, accepting a resignation, closing clearance.
 *
 * HR belongs here and not in `canMutate`, which is the payroll-money
 * permission — an HR manager should be able to accept a resignation
 * without being able to change what anybody is paid. The rule had been
 * spelled out as `canMutate(user) || user.role === "hr_manager"` at each
 * call site, which is the same rule written six times and six chances
 * for one of them to drift.
 */
export function canActOnPeople(p: Pick<Principal, "role">): boolean {
  return p.role === "admin" || p.role === "payroll_manager" || p.role === "hr_manager";
}

/**
 * Company-wide compensation data: registers, exports, other people's pay.
 *
 * Scope "own" does NOT qualify. It means "your own payslip", which is
 * served from self-service and checked there against the employee id. A
 * rule that let "own" through here let any employee download every
 * colleague's pay and identity numbers.
 */
export function canSeeCompensation(
  p: Pick<Principal, "compensationScope">,
): boolean {
  return p.compensationScope === "company" || p.compensationScope === "all";
}

export function isTenantWide(p: Pick<Principal, "companyId">): boolean {
  return p.companyId === null;
}

export function canAccessCompany(
  p: Pick<Principal, "companyId">,
  companyId: string,
): boolean {
  return p.companyId === null || p.companyId === companyId;
}

/**
 * Whether someone may open one employee's stored document.
 *
 * Anyone may open their own. Otherwise it takes console access to the
 * right company: HR verifies identity papers, so identity papers cannot
 * be gated on pay clearance, which HR deliberately lacks.
 */
export function canOpenEmployeeDocument(
  p: Principal,
  subject: { employeeId: string; companyId: string },
): boolean {
  if (p.employeeId && p.employeeId === subject.employeeId) return true;
  return canAccessConsole(p) && canAccessCompany(p, subject.companyId);
}

/**
 * Whether someone may pull a company-wide file — a register, a return, a
 * bank file, an audit pack. Route handlers do not pass through the console
 * layout, so this has to be asked explicitly in every one of them.
 */
export function canExportCompanyData(p: Principal, companyId: string): boolean {
  return (
    canAccessConsole(p) && canSeeCompensation(p) && canAccessCompany(p, companyId)
  );
}
