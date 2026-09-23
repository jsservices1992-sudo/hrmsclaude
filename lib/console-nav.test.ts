import { test } from "node:test";
import assert from "node:assert/strict";
import { CONSOLE_NAV, isItemActive, navFor, navPages } from "./console-nav";

function findItem(href: string) {
  for (const entry of CONSOLE_NAV) {
    const item = entry.children?.find((i) => i.href === href);
    if (item) return item;
  }
  return undefined;
}

test("Run payroll is the only Payroll nav entry — the register, incentives and approvals are reached through it, not beside it", () => {
  const runPayroll = findItem("/console/payroll/run");
  assert.ok(runPayroll, "Run payroll item must exist");

  const stray = ["/console/payroll", "/console/payroll/inputs", "/console/runs"]
    .map((href) => findItem(href))
    .filter(Boolean);
  assert.deepEqual(stray, [], "no separate nav item for the pages Run payroll already links to");
});

test("landing on the register, incentives, payslips or approvals still lights up Run payroll", () => {
  const runPayroll = findItem("/console/payroll/run")!;
  for (const pathname of [
    "/console/payroll",
    "/console/payroll/inputs",
    "/console/payroll/payslips",
    "/console/payslip/emp_0001",
    "/console/runs",
    "/console/runs/run_123",
  ]) {
    assert.ok(isItemActive(runPayroll, pathname), `${pathname} should activate Run payroll`);
  }
});

test("Run payroll does not light up for an unrelated payroll-adjacent page", () => {
  const runPayroll = findItem("/console/payroll/run")!;
  assert.equal(isItemActive(runPayroll, "/console/banking"), false);
  assert.equal(isItemActive(runPayroll, "/console/tax"), false);
});

test("the console has seven destinations", () => {
  assert.deepEqual(
    CONSOLE_NAV.map((e) => e.label),
    ["Home", "People", "Attendance", "Payroll", "Compliance", "Reports", "Settings"],
  );
});

test("a module lights up for every page inside it", () => {
  const people = CONSOLE_NAV.find((e) => e.label === "People")!;
  for (const p of ["/console/employees/x", "/console/onboarding", "/console/exits/e1/settlement", "/console/org"]) {
    assert.ok(isItemActive(people, p), p);
  }
  const payroll = CONSOLE_NAV.find((e) => e.label === "Payroll")!;
  assert.ok(isItemActive(payroll, "/console/banking"));
  assert.equal(isItemActive(payroll, "/console/employees"), false);
});

test("someone without pay visibility never sees Payroll or the filings page", () => {
  const nav = navFor({ compensation: false, tenantWide: true });
  assert.equal(nav.some((e) => e.label === "Payroll"), false);
  const compliance = nav.find((e) => e.label === "Compliance")!;
  assert.equal(compliance.children!.some((c) => c.href === "/console/statutory"), false);
  // …and the module opens on a page they can see, not the hidden one.
  assert.equal(compliance.href, "/console/compliance");
  assert.equal(navPages(nav).some((p) => p.href === "/console/statutory"), false);
});

test("the audit log is only offered to tenant-wide users", () => {
  const confined = navFor({ compensation: true, tenantWide: false });
  const compliance = confined.find((e) => e.label === "Compliance")!;
  assert.equal(compliance.children!.some((c) => c.href === "/console/audit"), false);
});
