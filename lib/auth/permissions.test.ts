import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  canActOnPeople,
  canMutate,
  canAccessConsole,
  canSeeCompensation,
  canOpenEmployeeDocument,
  canExportCompanyData,
  type Principal,
} from "./permissions";

const who = (over: Partial<Principal>): Principal => ({
  email: "x@example.in",
  role: "employee",
  companyId: "co_a",
  employeeId: "emp_1",
  compensationScope: "own",
  ...over,
});

const employee = who({});
const hr = who({ role: "hr_manager", employeeId: null, compensationScope: "none" });
const payroll = who({ role: "payroll_manager", employeeId: null, compensationScope: "company" });
const auditor = who({ role: "auditor", companyId: null, employeeId: null, compensationScope: "all" });
const admin = who({ role: "admin", companyId: null, employeeId: null, compensationScope: "all" });

test("scope 'own' is not company-wide compensation access", () => {
  assert.equal(canSeeCompensation(employee), false);
  assert.equal(canSeeCompensation(hr), false);
  assert.equal(canSeeCompensation(payroll), true);
  assert.equal(canSeeCompensation(admin), true);
});

test("an employee cannot export company data, whatever their scope says", () => {
  assert.equal(canExportCompanyData(employee, "co_a"), false);
  // Even a mis-provisioned employee row with company scope stays out:
  // the console role is checked as well as the scope.
  assert.equal(
    canExportCompanyData(who({ compensationScope: "company" }), "co_a"),
    false,
  );
});

test("exports are confined to the user's company", () => {
  assert.equal(canExportCompanyData(payroll, "co_a"), true);
  assert.equal(canExportCompanyData(payroll, "co_b"), false);
  assert.equal(canExportCompanyData(auditor, "co_b"), true);
  assert.equal(canExportCompanyData(hr, "co_a"), false);
});

test("an employee opens their own documents and nobody else's", () => {
  assert.equal(canOpenEmployeeDocument(employee, { employeeId: "emp_1", companyId: "co_a" }), true);
  assert.equal(canOpenEmployeeDocument(employee, { employeeId: "emp_2", companyId: "co_a" }), false);
});

test("HR can open identity papers it must verify, within its company", () => {
  assert.equal(canOpenEmployeeDocument(hr, { employeeId: "emp_2", companyId: "co_a" }), true);
  assert.equal(canOpenEmployeeDocument(hr, { employeeId: "emp_9", companyId: "co_b" }), false);
});

test("console roles exclude employees", () => {
  assert.equal(canAccessConsole(employee), false);
  assert.equal(canAccessConsole(hr), true);
});

describe("canActOnPeople", () => {
  test("admin, payroll and HR may act on employment decisions", () => {
    for (const role of ["admin", "payroll_manager", "hr_manager"] as const) {
      assert.equal(canActOnPeople({ role }), true, role);
    }
  });

  test("an auditor may not — read-only is the whole point of the role", () => {
    assert.equal(canActOnPeople({ role: "auditor" }), false);
  });

  test("an employee may not act on anybody, including themselves", () => {
    assert.equal(canActOnPeople({ role: "employee" }), false);
  });

  test("it is wider than canMutate, which is the money permission", () => {
    assert.equal(canMutate({ role: "hr_manager" }), false, "HR cannot change pay");
    assert.equal(canActOnPeople({ role: "hr_manager" }), true, "but can record an exit");
  });
});
