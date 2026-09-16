import { test } from "node:test";
import assert from "node:assert/strict";
import { CONSOLE_SECTIONS, isItemActive } from "./console-nav";

function findItem(href: string) {
  for (const section of CONSOLE_SECTIONS) {
    for (const group of section.groups) {
      const item = group.items.find((i) => i.href === href);
      if (item) return item;
    }
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
