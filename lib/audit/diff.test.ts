import { test } from "node:test";
import assert from "node:assert/strict";
import { diffRuns, computeVariance, type RunSide } from "./diff";

const L = (rupees: number) => Math.round(rupees * 100);

const employee = (over: Partial<RunSide["employees"][number]> = {}) => ({
  employeeId: "e1",
  empCode: "KA0001",
  name: "Aarav Nair",
  grossPaise: L(45000),
  deductionsPaise: L(2000),
  netPaise: L(43000),
  paidDays: 30,
  lopDays: 0,
  lines: [
    { code: "BASIC", label: "Basic", amountPaise: L(22500) },
    { code: "HRA", label: "House rent allowance", amountPaise: L(9000) },
    { code: "PT", label: "Professional tax", amountPaise: L(200) },
  ],
  ...over,
});

const side = (version: number, employees: RunSide["employees"]): RunSide => ({
  version,
  status: "approved",
  calculatedAt: `2026-09-0${version}T10:00:00.000Z`,
  preparedBy: "payroll@example.com",
  employees,
});

/* ---------------- run diff ---------------- */

test("identical runs report every employee unchanged", () => {
  const d = diffRuns(side(1, [employee()]), side(2, [employee()]));
  assert.equal(d.unchangedCount, 1);
  assert.equal(d.changed.length, 0);
  assert.equal(d.totals.netDeltaPaise, 0);
  assert.equal(d.componentImpact.length, 0);
});

test("a changed component is reported with its delta, not just a total", () => {
  const after = employee({
    netPaise: L(42800),
    lines: [
      { code: "BASIC", label: "Basic", amountPaise: L(22500) },
      { code: "HRA", label: "House rent allowance", amountPaise: L(9000) },
      { code: "PT", label: "Professional tax", amountPaise: L(400) },
    ],
  });
  const d = diffRuns(side(1, [employee()]), side(2, [after]));

  assert.equal(d.changed.length, 1);
  const pt = d.changed[0].components.find((c) => c.code === "PT")!;
  assert.equal(pt.fromPaise, L(200));
  assert.equal(pt.toPaise, L(400));
  assert.equal(pt.deltaPaise, L(200));
  assert.equal(pt.change, "changed");
});

test("a component appearing is 'added', not a change from zero", () => {
  const after = employee({
    lines: [...employee().lines, { code: "TDS", label: "Income tax", amountPaise: L(1500) }],
  });
  const d = diffRuns(side(1, [employee()]), side(2, [after]));
  const tds = d.changed[0].components.find((c) => c.code === "TDS")!;
  assert.equal(tds.change, "added");
  assert.equal(tds.fromPaise, 0);
});

test("a component disappearing is 'removed'", () => {
  const before = employee({
    lines: [...employee().lines, { code: "TDS", label: "Income tax", amountPaise: L(1500) }],
  });
  const d = diffRuns(side(1, [before]), side(2, [employee()]));
  const tds = d.changed[0].components.find((c) => c.code === "TDS")!;
  assert.equal(tds.change, "removed");
  assert.equal(tds.toPaise, 0);
});

test("components are ordered by how much they moved", () => {
  const after = employee({
    lines: [
      { code: "BASIC", label: "Basic", amountPaise: L(25000) },
      { code: "HRA", label: "House rent allowance", amountPaise: L(9000) },
      { code: "PT", label: "Professional tax", amountPaise: L(250) },
    ],
  });
  const d = diffRuns(side(1, [employee()]), side(2, [after]));
  assert.equal(d.changed[0].components[0].code, "BASIC");
});

test("an employee added between versions is flagged, with a warning", () => {
  const d = diffRuns(
    side(1, [employee()]),
    side(2, [employee(), employee({ employeeId: "e2", empCode: "KA0002", name: "New Joiner" })]),
  );
  assert.equal(d.added.length, 1);
  assert.equal(d.added[0].empCode, "KA0002");
  assert.ok(d.warnings.some((w) => w.includes("change in headcount")));
});

test("an employee removed between versions is flagged", () => {
  const d = diffRuns(
    side(1, [employee(), employee({ employeeId: "e2", empCode: "KA0002" })]),
    side(2, [employee()]),
  );
  assert.equal(d.removed.length, 1);
  assert.equal(d.removed[0].toNetPaise, 0);
});

test("loss-of-pay movement is reported even when components did not change", () => {
  const d = diffRuns(
    side(1, [employee()]),
    side(2, [employee({ lopDays: 3, netPaise: L(38700) })]),
  );
  assert.equal(d.changed[0].lopDelta, 3);
});

test("component impact aggregates across employees", () => {
  const before = [employee(), employee({ employeeId: "e2", empCode: "KA0002" })];
  const after = before.map((e) => ({
    ...e,
    lines: e.lines.map((l) =>
      l.code === "PT" ? { ...l, amountPaise: L(400) } : l,
    ),
  }));
  const d = diffRuns(side(1, before), side(2, after));
  const pt = d.componentImpact.find((c) => c.code === "PT")!;
  assert.equal(pt.deltaPaise, L(400), "₹200 each across two employees");
  assert.equal(pt.employeeCount, 2);
});

test("comparing a version to itself says so rather than showing an empty diff", () => {
  const d = diffRuns(side(2, [employee()]), side(2, [employee()]));
  assert.ok(d.warnings.some((w) => w.includes("nothing to compare")));
});

test("comparing backwards warns that the direction is reversed", () => {
  const d = diffRuns(side(3, [employee()]), side(1, [employee()]));
  assert.ok(d.warnings.some((w) => w.includes("direction of every difference")));
});

test("a code appearing twice in a run is summed, not overwritten", () => {
  const before = employee({
    lines: [{ code: "LOAN", label: "Loan", amountPaise: L(5000) }],
  });
  const after = employee({
    lines: [
      { code: "LOAN", label: "Loan", amountPaise: L(5000) },
      { code: "LOAN", label: "Loan", amountPaise: L(3000) },
    ],
  });
  const d = diffRuns(side(1, [before]), side(2, [after]));
  const loan = d.changed[0].components.find((c) => c.code === "LOAN")!;
  assert.equal(loan.toPaise, L(8000));
  assert.equal(loan.deltaPaise, L(3000));
});

/* ---------------- variance ---------------- */

test("no movement is within tolerance and not flagged", () => {
  const v = computeVariance({
    prior: side(1, [employee()]),
    current: side(1, [employee()]),
    thresholdBps: 1000,
    absoluteThresholdPaise: L(5000),
  });
  assert.equal(v.flagged.length, 0);
  assert.equal(v.rows[0].reason, "No change");
});

test("a move beyond the percentage threshold is flagged", () => {
  const v = computeVariance({
    prior: side(1, [employee()]),
    current: side(1, [employee({ netPaise: L(50000) })]),
    thresholdBps: 1000,
    absoluteThresholdPaise: L(100000),
  });
  assert.equal(v.flagged.length, 1);
  assert.match(v.flagged[0].reason, /Net moved by 16.3%/);
});

test("a large absolute move is flagged even when the percentage is small", () => {
  const rich = employee({ netPaise: L(500000) });
  const v = computeVariance({
    prior: side(1, [rich]),
    current: side(1, [employee({ netPaise: L(510000) })]),
    thresholdBps: 5000,
    absoluteThresholdPaise: L(5000),
  });
  assert.equal(v.flagged.length, 1, "2% but ₹10,000");
});

test("a small move within both thresholds is not flagged", () => {
  const v = computeVariance({
    prior: side(1, [employee()]),
    current: side(1, [employee({ netPaise: L(43200) })]),
    thresholdBps: 1000,
    absoluteThresholdPaise: L(5000),
  });
  assert.equal(v.flagged.length, 0);
  assert.match(v.rows[0].reason, /Within tolerance/);
});

test("a joiner is always flagged, however small the amount", () => {
  const v = computeVariance({
    prior: side(1, []),
    current: side(1, [employee({ netPaise: L(100) })]),
    thresholdBps: 9999,
    absoluteThresholdPaise: L(999999),
  });
  assert.equal(v.flagged.length, 1);
  assert.match(v.flagged[0].reason, /New this period/);
});

test("a leaver is always flagged", () => {
  const v = computeVariance({
    prior: side(1, [employee()]),
    current: side(1, []),
    thresholdBps: 9999,
    absoluteThresholdPaise: L(999999),
  });
  assert.match(v.flagged[0].reason, /Not paid this period/);
});

test("loss-of-pay movement is named in the reason", () => {
  const v = computeVariance({
    prior: side(1, [employee()]),
    current: side(1, [employee({ netPaise: L(38000), lopDays: 3 })]),
    thresholdBps: 500,
    absoluteThresholdPaise: L(5000),
  });
  assert.match(v.flagged[0].reason, /loss of pay changed by 3.0 day\(s\)/);
});

test("a first run says the variance report is not meaningful", () => {
  const v = computeVariance({
    prior: null,
    current: side(1, [employee()]),
    thresholdBps: 1000,
    absoluteThresholdPaise: L(5000),
  });
  assert.ok(v.warnings.some((w) => w.includes("not meaningful for a first run")));
});

test("rows are ordered by the size of the move", () => {
  const v = computeVariance({
    prior: side(1, [
      employee(),
      employee({ employeeId: "e2", empCode: "KA0002" }),
    ]),
    current: side(1, [
      employee({ netPaise: L(43500) }),
      employee({ employeeId: "e2", empCode: "KA0002", netPaise: L(60000) }),
    ]),
    thresholdBps: 1000,
    absoluteThresholdPaise: L(5000),
  });
  assert.equal(v.rows[0].empCode, "KA0002");
});
