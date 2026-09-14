import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  derivePeriodCalendar,
  describeCutoffTail,
  applyRounding,
  membersOfGroup,
  unassignedEmployees,
  resolveDepartmentConventions,
  type GroupableEmployee,
} from "./settings";

const R = (rupees: number) => Math.round(rupees * 100);

describe("Payroll calendar", () => {
  test("last calendar day pays on the 30th in September", () => {
    const c = derivePeriodCalendar({
      year: 2026,
      month: 9,
      defaults: { payDayConvention: "last_calendar_day", payDayOfMonth: 28, attendanceCutoffDay: 0 },
    });
    assert.equal(c.payDate, "2026-09-30");
    assert.equal(c.attendanceCutoff, "2026-09-30");
  });

  test("last working day walks back off a weekend", () => {
    // 31 Jan 2026 is a Saturday, so the last working day is Friday the 30th.
    const c = derivePeriodCalendar({
      year: 2026,
      month: 1,
      defaults: { payDayConvention: "last_working_day", payDayOfMonth: 28, attendanceCutoffDay: 0 },
    });
    assert.equal(new Date("2026-01-31T00:00:00Z").getUTCDay(), 6, "precondition: Saturday");
    assert.equal(c.payDate, "2026-01-30");
  });

  test("fixed date is clamped to the length of the month", () => {
    const feb = derivePeriodCalendar({
      year: 2026,
      month: 2,
      defaults: { payDayConvention: "fixed_date", payDayOfMonth: 30, attendanceCutoffDay: 0 },
    });
    assert.equal(feb.payDate, "2026-02-28", "cannot pay on 30 February");
  });

  test("a mid-month cut-off sets the freeze the following day", () => {
    const c = derivePeriodCalendar({
      year: 2026,
      month: 9,
      defaults: { payDayConvention: "last_working_day", payDayOfMonth: 28, attendanceCutoffDay: 25 },
    });
    assert.equal(c.attendanceCutoff, "2026-09-25");
    assert.equal(c.inputFreeze, "2026-09-26");
  });

  test("approval deadline is the day before pay", () => {
    const c = derivePeriodCalendar({
      year: 2026,
      month: 9,
      defaults: { payDayConvention: "last_calendar_day", payDayOfMonth: 28, attendanceCutoffDay: 25 },
    });
    assert.equal(c.payDate, "2026-09-30");
    assert.equal(c.approvalDeadline, "2026-09-29");
    assert.equal(c.processingDays, 5);
  });

  test("REGRESSION: month-end cut-off with weekend month-end flags a conflict", () => {
    // 31 Oct 2026 is a Saturday, so last-working-day pay is the 30th — before
    // inputs freeze on 1 Nov. Paying before inputs close is impossible.
    assert.equal(new Date("2026-10-31T00:00:00Z").getUTCDay(), 6, "precondition: Saturday");
    const c = derivePeriodCalendar({
      year: 2026,
      month: 10,
      defaults: { payDayConvention: "last_working_day", payDayOfMonth: 28, attendanceCutoffDay: 0 },
    });
    assert.equal(c.payDate, "2026-10-30");
    assert.equal(c.inputFreeze, "2026-11-01");
    assert.ok(c.conflict, "must be flagged, not silently produced");
    // Pay lands before the cut-off itself, which is the severer of the two.
    assert.match(c.conflict!, /on or before the attendance cut-off/);
  });

  test("a workable calendar reports no conflict", () => {
    const c = derivePeriodCalendar({
      year: 2026,
      month: 9,
      defaults: { payDayConvention: "last_calendar_day", payDayOfMonth: 28, attendanceCutoffDay: 25 },
    });
    assert.equal(c.conflict, null);
  });

  test("pay date on the cut-off itself is a conflict", () => {
    const c = derivePeriodCalendar({
      year: 2026,
      month: 9,
      defaults: { payDayConvention: "fixed_date", payDayOfMonth: 25, attendanceCutoffDay: 25 },
    });
    assert.ok(c.conflict);
    assert.match(c.conflict!, /on or before/);
  });

  test("cut-off at month end leaves no untracked tail", () => {
    const t = describeCutoffTail({ year: 2026, month: 9, attendanceCutoffDay: 0, treatment: "lag_to_next" });
    assert.equal(t.tailDays, 0);
  });

  test("a mid-month cut-off names the untracked tail and its treatment", () => {
    const lag = describeCutoffTail({ year: 2026, month: 9, attendanceCutoffDay: 25, treatment: "lag_to_next" });
    assert.equal(lag.tailDays, 5);
    assert.match(lag.note, /following month/);

    const est = describeCutoffTail({ year: 2026, month: 9, attendanceCutoffDay: 25, treatment: "estimate_and_true_up" });
    assert.match(est.note, /trued up/);
  });
});

describe("Rounding policy", () => {
  const comps = [R(20000.4), R(8000.3), R(3200.2), R(8799.1)];
  const rawGross = comps.reduce((a, b) => a + b, 0);

  test("no rounding leaves everything untouched", () => {
    const r = applyRounding({
      components: comps,
      deductions: R(1800),
      policy: { mode: "nearest", components: false, gross: false, net: false },
    });
    assert.equal(r.gross, rawGross);
    assert.equal(r.net, rawGross - R(1800));
    assert.match(r.basis, /No rounding/);
  });

  test("THE INVARIANT: rounded components still sum exactly to gross", () => {
    const r = applyRounding({
      components: comps,
      deductions: R(1800),
      policy: { mode: "nearest", components: true, gross: false, net: false },
    });
    assert.equal(
      r.components.reduce((a, b) => a + b, 0),
      r.gross,
      "components must sum to the stated gross",
    );
    assert.equal(r.gross, rawGross, "component rounding must not move gross");
  });

  test("gross rounding absorbs the difference into a component", () => {
    const r = applyRounding({
      components: comps,
      deductions: R(1800),
      policy: { mode: "nearest", components: false, gross: true, net: false },
    });
    assert.equal(r.gross % 100, 0, "gross is a whole rupee");
    assert.equal(
      r.components.reduce((a, b) => a + b, 0),
      r.gross,
      "still sums after absorbing",
    );
  });

  test("net rounding produces whole rupees", () => {
    const r = applyRounding({
      components: comps,
      deductions: R(1799.55),
      policy: { mode: "nearest", components: false, gross: false, net: true },
    });
    assert.equal(r.net % 100, 0);
  });

  test("all three levels together keep the invariant", () => {
    const r = applyRounding({
      components: comps,
      deductions: R(1800.6),
      policy: { mode: "nearest", components: true, gross: true, net: true },
    });
    assert.equal(r.components.reduce((a, b) => a + b, 0), r.gross);
    assert.equal(r.gross % 100, 0);
    assert.equal(r.net % 100, 0);
    assert.match(r.basis, /components, gross, net/);
  });

  test("rounding up never lowers the gross", () => {
    const r = applyRounding({
      components: comps,
      deductions: 0,
      policy: { mode: "up", components: false, gross: true, net: false },
    });
    assert.ok(r.gross >= rawGross);
  });

  test("handles a single component without drift", () => {
    const r = applyRounding({
      components: [R(50000.7)],
      deductions: 0,
      policy: { mode: "nearest", components: true, gross: true, net: true },
    });
    assert.equal(r.components[0], r.gross);
  });
});

const emps: GroupableEmployee[] = [
  { id: "a", branchId: "br_blr", departmentId: "d_eng", gradeId: "g1", employmentType: "permanent" },
  { id: "b", branchId: "br_blr", departmentId: "d_sales", gradeId: "g2", employmentType: "permanent" },
  { id: "c", branchId: "br_mum", departmentId: "d_eng", gradeId: "g1", employmentType: "contract" },
  { id: "d", branchId: "br_pune", departmentId: null, gradeId: null, employmentType: "intern" },
];

describe("Payroll groups", () => {
  test("'all' matches everyone", () => {
    assert.equal(membersOfGroup({ name: "All", ruleType: "all", ruleValue: null }, emps).length, 4);
  });

  test("branch rule matches by id", () => {
    const m = membersOfGroup({ name: "BLR", ruleType: "branch", ruleValue: "br_blr" }, emps);
    assert.deepEqual(m.map((e) => e.id), ["a", "b"]);
  });

  test("multiple values are comma separated", () => {
    const m = membersOfGroup({ name: "Two", ruleType: "branch", ruleValue: "br_blr, br_mum" }, emps);
    assert.equal(m.length, 3);
  });

  test("employees with a null attribute never match that rule", () => {
    const m = membersOfGroup({ name: "Eng", ruleType: "department", ruleValue: "d_eng" }, emps);
    assert.equal(m.some((e) => e.id === "d"), false);
  });

  test("an empty rule value matches nobody rather than everybody", () => {
    const m = membersOfGroup({ name: "Empty", ruleType: "branch", ruleValue: "" }, emps);
    assert.equal(m.length, 0, "must not silently fall through to all");
  });

  test("UNASSIGNED employees are surfaced, not dropped", () => {
    const rules = [
      { name: "BLR", ruleType: "branch" as const, ruleValue: "br_blr" },
      { name: "MUM", ruleType: "branch" as const, ruleValue: "br_mum" },
    ];
    const left = unassignedEmployees(rules, emps);
    assert.deepEqual(left.map((e) => e.id), ["d"], "Pune employee is in no tranche");
  });

  test("full coverage leaves nobody unassigned", () => {
    const rules = [{ name: "All", ruleType: "all" as const, ruleValue: null }];
    assert.equal(unassignedEmployees(rules, emps).length, 0);
  });
});

describe("resolveDepartmentConventions", () => {
  const company = {
    prorationBasis: "calendar_days" as const,
    standardDays: 30,
    roundingMode: "nearest" as const,
    roundComponents: false,
    roundGross: false,
    roundNet: true,
  };

  test("no override at all falls back to the company config entirely", () => {
    assert.deepEqual(resolveDepartmentConventions(company, null), company);
    assert.deepEqual(resolveDepartmentConventions(company, undefined), company);
  });

  test("an empty override object still inherits every field", () => {
    assert.deepEqual(resolveDepartmentConventions(company, {}), company);
  });

  test("a partial override replaces only the fields it names", () => {
    const merged = resolveDepartmentConventions(company, { prorationBasis: "working_days" });
    assert.equal(merged.prorationBasis, "working_days");
    assert.equal(merged.standardDays, company.standardDays);
    assert.equal(merged.roundingMode, company.roundingMode);
  });

  test("a boolean override of false is honoured, not treated as absent", () => {
    // roundNet: false must win over the company's roundNet: true — a naive
    // `override.roundNet || company.roundNet` would get this backwards.
    const merged = resolveDepartmentConventions(company, { roundNet: false });
    assert.equal(merged.roundNet, false);
  });

  test("two departments in the same company can resolve to genuinely different conventions", () => {
    const factory = resolveDepartmentConventions(company, {
      prorationBasis: "working_days",
      standardDays: 26,
    });
    const hq = resolveDepartmentConventions(company, null);
    assert.notEqual(factory.prorationBasis, hq.prorationBasis);
    assert.notEqual(factory.standardDays, hq.standardDays);
  });
});
