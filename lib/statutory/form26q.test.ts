import { test } from "node:test";
import assert from "node:assert/strict";
import { buildForm26q, depositDueOn, returnDueOn, type DeductionRow } from "./form26q";

const R = (r: number) => r * 100;
const row = (over: Partial<DeductionRow> = {}): DeductionRow => ({
  employeeId: "e1",
  empCode: "C001",
  name: "A Consultant",
  pan: "ABCDE1234F",
  section: "194J",
  month: 4,
  grossPaise: R(60_000),
  tdsPaise: R(6_000),
  ...over,
});

test("a payee's months in the quarter are added up into one deductee entry", () => {
  const v = buildForm26q({
    financialYear: 2026,
    quarter: "Q1",
    rows: [row({ month: 4 }), row({ month: 5 }), row({ month: 6 })],
  });
  assert.equal(v.payees.length, 1);
  assert.equal(v.payees[0].grossPaise, R(180_000));
  assert.equal(v.payees[0].tdsPaise, R(18_000));
  assert.deepEqual(v.payees[0].months, [4, 5, 6]);
});

test("one person paid under two sections is two entries, not one", () => {
  /* 26Q reports by deductee and section. Merging them would understate
     one section and overstate the other in the same return. */
  const v = buildForm26q({
    financialYear: 2026,
    quarter: "Q1",
    rows: [row({ section: "194J" }), row({ section: "194C", tdsPaise: R(600) })],
  });
  assert.equal(v.payees.length, 2);
  assert.deepEqual(
    v.payees.map((p) => p.section).sort(),
    ["194C", "194J"],
  );
});

test("a payment below the threshold is still reported, with nil tax", () => {
  const v = buildForm26q({
    financialYear: 2026,
    quarter: "Q1",
    rows: [row({ tdsPaise: 0, grossPaise: R(20_000) })],
  });
  assert.equal(v.payees.length, 1);
  assert.equal(v.totalTdsPaise, 0);
  assert.equal(v.totalGrossPaise, R(20_000));
});

test("a missing PAN is raised, because the return is rejected without one", () => {
  const v = buildForm26q({
    financialYear: 2026,
    quarter: "Q1",
    rows: [row({ pan: null })],
  });
  assert.equal(v.warnings.length, 1);
  assert.match(v.warnings[0], /C001/);
  assert.match(v.warnings[0], /206AA/);
});

test("tax deducted in March is payable by 30 April, not the 7th", () => {
  /* The exception every payroll calendar gets wrong. */
  assert.equal(depositDueOn(2027, 3), "2027-04-30");
  assert.equal(depositDueOn(2026, 4), "2026-05-07");
  assert.equal(depositDueOn(2026, 12), "2027-01-07");
});

test("return due dates follow the quarter, across the year boundary", () => {
  assert.equal(returnDueOn(2026, "Q1"), "2026-07-31");
  assert.equal(returnDueOn(2026, "Q2"), "2026-10-31");
  assert.equal(returnDueOn(2026, "Q3"), "2027-01-31");
  assert.equal(returnDueOn(2026, "Q4"), "2027-05-31");
});

test("Q4's months are dated in the following calendar year", () => {
  const v = buildForm26q({
    financialYear: 2026,
    quarter: "Q4",
    rows: [row({ month: 1 }), row({ month: 3 })],
  });
  assert.deepEqual(v.months, [1, 2, 3]);
  assert.equal(v.monthly.find((m) => m.month === 1)!.dueOn, "2027-02-07");
  assert.equal(v.monthly.find((m) => m.month === 3)!.dueOn, "2027-04-30");
});

test("the monthly challan figures add up to the quarter's total", () => {
  const v = buildForm26q({
    financialYear: 2026,
    quarter: "Q2",
    rows: [row({ month: 7 }), row({ month: 8 }), row({ month: 9, employeeId: "e2", empCode: "C002" })],
  });
  assert.equal(
    v.monthly.reduce((a, m) => a + m.tdsPaise, 0),
    v.totalTdsPaise,
  );
});
