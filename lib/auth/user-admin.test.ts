import test from "node:test";
import assert from "node:assert/strict";
import {
  canManageUsers,
  checkUserDraft,
  checkNoLockout,
  ASSIGNABLE_ROLES,
  type UserDraft,
} from "./user-admin";
import type { Role } from "./permissions";

const draft = (over: Partial<UserDraft> = {}): UserDraft => ({
  email: "ops@acme.in",
  name: "Ops Lead",
  role: "hr_manager",
  companyId: "co_1",
  employeeId: null,
  compensationScope: "none",
  active: true,
  ...over,
});

test("only an administrator may manage accounts", () => {
  assert.equal(canManageUsers({ role: "admin" }), true);
  for (const role of ["payroll_manager", "hr_manager", "auditor", "employee"] as Role[]) {
    assert.equal(canManageUsers({ role }), false, role);
  }
});

test("a payroll manager cannot mint themselves an administrator", () => {
  assert.equal(canManageUsers({ role: "payroll_manager" }), false);
});

test("a coherent account has nothing to say about it", () => {
  assert.deepEqual(checkUserDraft(draft()), []);
});

test("an employee account must be linked to a record", () => {
  const issues = checkUserDraft(draft({ role: "employee", compensationScope: "own" }));
  assert.equal(issues.length, 1);
  assert.match(issues[0], /linked to an employee record/);

  assert.deepEqual(
    checkUserDraft(draft({ role: "employee", employeeId: "emp_1", compensationScope: "own" })),
    [],
  );
});

test("an employee account cannot be given everyone else's pay", () => {
  for (const scope of ["company", "all"] as const) {
    const issues = checkUserDraft(
      draft({ role: "employee", employeeId: "emp_1", compensationScope: scope, companyId: null }),
    );
    assert.ok(
      issues.some((i) => /cannot be given other people/.test(i)),
      scope,
    );
  }
});

test("tenant-wide pay access contradicts being confined to one company", () => {
  const issues = checkUserDraft(draft({ compensationScope: "all", companyId: "co_1" }));
  assert.ok(issues.some((i) => /not confined to one company/.test(i)));
  assert.deepEqual(checkUserDraft(draft({ compensationScope: "all", companyId: null })), []);
});

test("an auditor scoped to their own payslip is a contradiction", () => {
  const issues = checkUserDraft(draft({ role: "auditor", compensationScope: "own" }));
  assert.ok(issues.some((i) => /not their own/.test(i)));
});

test("a malformed email or blank name is refused", () => {
  assert.ok(checkUserDraft(draft({ email: "nope" })).length > 0);
  assert.ok(checkUserDraft(draft({ name: "   " })).length > 0);
});

const ctx = (over: Partial<Parameters<typeof checkNoLockout>[0]> = {}) => ({
  targetUserId: "u2",
  targetRole: "hr_manager" as Role,
  targetActive: true,
  actorUserId: "u1",
  activeAdminIds: ["u1"],
  ...over,
});

test("an ordinary edit by someone else is allowed", () => {
  assert.deepEqual(checkNoLockout(ctx(), { role: "auditor", active: true }), []);
});

test("you cannot change your own role or switch yourself off", () => {
  const self = ctx({ targetUserId: "u1", targetRole: "admin", activeAdminIds: ["u1", "u3"] });
  assert.match(
    checkNoLockout(self, { role: "auditor", active: true }).join(" "),
    /cannot change your own role/,
  );
  assert.match(
    checkNoLockout(self, { role: "admin", active: false }).join(" "),
    /cannot deactivate your own account/,
  );
});

test("the last administrator cannot be demoted or deactivated", () => {
  const last = ctx({ targetUserId: "u2", targetRole: "admin", activeAdminIds: ["u2"] });
  assert.match(
    checkNoLockout(last, { role: "hr_manager", active: true }).join(" "),
    /only active administrator/,
  );
  assert.match(
    checkNoLockout(last, { role: "admin", active: false }).join(" "),
    /only active administrator/,
  );
});

test("an administrator may be demoted while another remains", () => {
  const notLast = ctx({ targetUserId: "u2", targetRole: "admin", activeAdminIds: ["u1", "u2"] });
  assert.deepEqual(checkNoLockout(notLast, { role: "hr_manager", active: true }), []);
});

test("demoting an already-inactive admin is not a lockout", () => {
  const inactive = ctx({ targetUserId: "u2", targetRole: "admin", targetActive: false, activeAdminIds: [] });
  assert.deepEqual(checkNoLockout(inactive, { role: "hr_manager", active: false }), []);
});

test("every assignable role is a real role, listed once", () => {
  const roles = ASSIGNABLE_ROLES.map((r) => r.role);
  assert.equal(new Set(roles).size, roles.length);
  assert.deepEqual(roles.sort(), ["admin", "auditor", "employee", "hr_manager", "payroll_manager"]);
});

test("a payroll manager must be able to see the pay they manage", () => {
  const base = {
    email: "p@x.test", name: "P", role: "payroll_manager" as const,
    companyId: "c1", employeeId: null, active: true,
  };
  for (const compensationScope of ["none", "own"] as const) {
    const issues = checkUserDraft({ ...base, compensationScope });
    assert.ok(
      issues.some((i) => i.includes("payroll manager needs access")),
      `scope ${compensationScope} should be refused`,
    );
  }
  assert.deepEqual(checkUserDraft({ ...base, compensationScope: "company" }), []);
});

test("the other roles are left alone by that rule", () => {
  for (const role of ["admin", "hr_manager"] as const) {
    const issues = checkUserDraft({
      email: "x@x.test", name: "X", role, companyId: "c1",
      employeeId: null, compensationScope: "none", active: true,
    });
    assert.deepEqual(issues, [], `${role} may be created without pay access`);
  }
});
