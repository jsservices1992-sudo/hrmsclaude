import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeEmployeePay,
  DEFAULT_STRUCTURE,
  type EmployeeInput,
  type CompanyConfig,
  type StatutoryConfig,
} from "./engine";

const L = (rupees: number) => Math.round(rupees * 100);

const company: CompanyConfig = {
  prorationBasis: "calendar_days",
  standardDays: 30,
  roundingMode: "nearest",
  roundNet: true,
  epfOnActualBasic: false,
  structure: DEFAULT_STRUCTURE,
};

const statutory: StatutoryConfig = {
  epf: {
    wageCeilingPaise: L(15000),
    employeeBps: 1200,
    employerBps: 1200,
    epsBps: 833,
    epsCeilingPaise: L(15000),
  },
  esic: { wageThresholdPaise: L(21000), employeeBps: 75, employerBps: 325 },
  ptSlabsByState: {},
  ptApplicableByState: {},
  lwfByState: {},
  lwfApplicableByState: {},
};

const employee: EmployeeInput = {
  id: "e1",
  name: "Test Employee",
  empCode: "T0001",
  gender: "other",
  stateCode: "KA",
  esicImplementedArea: true,
  monthlyGrossPaise: L(80000),
  dateOfJoining: "2020-04-01",
  dateOfExit: null,
  lopDays: 0,
  hadPriorPfMembership: true,
  pfOptedIn: true,
  vpfPercent: 0,
  esicCoveredAtPeriodStart: false,
  ptYtdPaise: 0,
};

const run = (e: Partial<EmployeeInput> = {}) =>
  computeEmployeePay({
    employee: { ...employee, ...e },
    company,
    statutory,
    year: 2026,
    month: 9,
  });

test("components sum to gross", () => {
  const r = run();
  const earnings = r.lines
    .filter((l) => l.kind === "earning")
    .reduce((a, l) => a + l.amountPaise, 0);
  assert.equal(earnings, r.grossPaise);
});

test("net is gross less deductions", () => {
  const r = run();
  assert.equal(r.netPaise, r.grossPaise - r.deductionsPaise);
});

test("no TDS line appears when the projection is nil", () => {
  const r = run();
  assert.equal(
    r.lines.find((l) => l.code === "TDS"),
    undefined,
  );
});

test("a projected TDS becomes a deduction line with its basis", () => {
  const r = run({
    monthlyTdsPaise: L(12000),
    tdsBasis: "₹84000 remaining over 7 month(s)",
  });
  const tds = r.lines.find((l) => l.code === "TDS")!;
  assert.equal(tds.kind, "deduction");
  assert.equal(tds.amountPaise, L(12000));
  assert.equal(tds.basis, "₹84000 remaining over 7 month(s)");
});

test("TDS reduces net pay by exactly its amount", () => {
  const without = run();
  const with_ = run({ monthlyTdsPaise: L(12000) });
  assert.equal(without.netPaise - with_.netPaise, L(12000));
  assert.equal(with_.deductionsPaise - without.deductionsPaise, L(12000));
});

test("TDS is not prorated by loss of pay", () => {
  // The projection is a monthly instalment of an annual liability. A day
  // of LOP reduces gross, not the tax already computed for the year.
  const full = run({ monthlyTdsPaise: L(12000) });
  const withLop = run({ lopDays: 10, monthlyTdsPaise: L(12000) });

  assert.ok(withLop.grossPaise < full.grossPaise, "gross does prorate");
  assert.equal(
    withLop.lines.find((l) => l.code === "TDS")!.amountPaise,
    L(12000),
    "TDS does not",
  );
});

test("TDS carries a default basis rather than an unexplained deduction", () => {
  const r = run({ monthlyTdsPaise: L(5000) });
  const tds = r.lines.find((l) => l.code === "TDS")!;
  assert.ok(tds.basis.length > 0);
});

/* ---------------- loan recovery (§3.10) ---------------- */

const aLoan = {
  loanId: "loan-abcdef12",
  label: "Personal loan",
  outstandingPaise: L(200000),
  instalmentPaise: L(10000),
  arrearsPaise: 0,
  status: "active" as const,
  startedOn: "2025-04-01",
};

test("no recovery block appears when there are no loans", () => {
  assert.equal(run().recovery, null);
});

test("a loan instalment becomes a deduction and reduces net pay", () => {
  const without = run();
  const with_ = run({ loans: [aLoan], minNetPayPaise: L(10000) });

  const line = with_.lines.find((l) => l.label === "Personal loan")!;
  assert.equal(line.kind, "deduction");
  assert.equal(line.amountPaise, L(10000));
  assert.equal(without.netPaise - with_.netPaise, L(10000));
});

test("recovery runs after statutory deductions, not against gross", () => {
  const r = run({ loans: [aLoan], minNetPayPaise: L(10000) });
  // Net before recovery is gross less PF and the rest; the plan must have
  // been given that figure, not the gross.
  assert.ok(r.recovery!.netAfterRecoveryPaise < r.grossPaise - L(10000));
  assert.equal(r.recovery!.totalRecoveredPaise, L(10000));
});

test("recovery stops at the floor and reports the shortfall as a warning", () => {
  // A high floor against a modest salary leaves little room to recover.
  const r = run({
    monthlyGrossPaise: L(20000),
    loans: [aLoan],
    minNetPayPaise: L(18000),
  });
  assert.ok(r.recovery!.totalShortfallPaise > 0);
  assert.ok(r.netPaise >= L(18000), "the floor holds");
  assert.ok(
    r.warnings.some((w) => w.includes("carries as arrears")),
    r.warnings.join("; "),
  );
});

test("a loan on hold produces no deduction line", () => {
  const r = run({
    loans: [{ ...aLoan, status: "on_hold" }],
    minNetPayPaise: L(10000),
  });
  assert.equal(r.recovery!.totalRecoveredPaise, 0);
  assert.equal(
    r.lines.find((l) => l.label === "Personal loan"),
    undefined,
  );
});

test("TDS is deducted before loan recovery is even considered", () => {
  const r = run({
    monthlyGrossPaise: L(30000),
    monthlyTdsPaise: L(8000),
    loans: [aLoan],
    minNetPayPaise: L(15000),
  });
  const tds = r.lines.find((l) => l.code === "TDS")!;
  assert.equal(tds.amountPaise, L(8000), "tax is not squeezed by the loan");
  assert.ok(
    r.recovery!.totalRecoveredPaise < L(10000),
    "the loan absorbs what is left, not the other way round",
  );
});

test("net stays equal to gross less every deduction, recovery included", () => {
  const r = run({ loans: [aLoan], minNetPayPaise: L(10000), monthlyTdsPaise: L(5000) });
  const deducted = r.lines
    .filter((l) => l.kind === "deduction")
    .reduce((a, l) => a + l.amountPaise, 0);
  assert.equal(r.deductionsPaise, deducted);
  assert.equal(r.netPaise, r.grossPaise - deducted);
});

test("a zero projection does not add an empty line", () => {
  const r = run({ monthlyTdsPaise: 0 });
  assert.equal(
    r.lines.find((l) => l.code === "TDS"),
    undefined,
  );
});

test("a one-off incentive raises gross and net by exactly its amount", () => {
  const without = run();
  const with_ = run({
    oneOffLines: [{ code: "INCENTIVE", label: "Diwali incentive", kind: "earning", amountPaise: L(5000) }],
  });
  assert.equal(with_.grossPaise - without.grossPaise, L(5000));
  assert.equal(with_.netPaise - without.netPaise, L(5000));
  const line = with_.lines.find((l) => l.code === "INCENTIVE")!;
  assert.equal(line.kind, "earning");
  assert.equal(line.amountPaise, L(5000));
});

test("a one-off deduction lowers net by exactly its amount and leaves gross untouched", () => {
  const without = run();
  const with_ = run({
    oneOffLines: [{ code: "DAMAGE", label: "Equipment damage recovery", kind: "deduction", amountPaise: L(2000) }],
  });
  assert.equal(with_.grossPaise, without.grossPaise);
  assert.equal(without.netPaise - with_.netPaise, L(2000));
  const line = with_.lines.find((l) => l.code === "DAMAGE")!;
  assert.equal(line.kind, "deduction");
  assert.equal(line.amountPaise, L(2000));
});

test("an incentive is available for loan recovery to draw against", () => {
  // A tight floor leaves a shortfall without the incentive; the same floor
  // with an incentive added should recover more (or the whole instalment).
  const tight = run({
    monthlyGrossPaise: L(20000),
    loans: [aLoan],
    minNetPayPaise: L(18500),
  });
  const withIncentive = run({
    monthlyGrossPaise: L(20000),
    loans: [aLoan],
    minNetPayPaise: L(18500),
    oneOffLines: [{ code: "INCENTIVE", label: "Bonus", kind: "earning", amountPaise: L(5000) }],
  });
  assert.ok(withIncentive.recovery!.totalRecoveredPaise > tight.recovery!.totalRecoveredPaise);
});

/* ---------------- reconciliation ---------------- */

test("gross less deductions equals net exactly, whatever the rounding", () => {
  /* Rounding the net to the rupee used to leave a few paise unaccounted
     for, so a register built by summing columns did not add up. */
  for (const lopDays of [0, 1, 1.5, 2, 2.5, 3.5]) {
    const r = run({ lopDays });
    assert.equal(
      r.grossPaise - r.deductionsPaise,
      r.netPaise,
      `gross - deductions must equal net at ${lopDays} LOP`,
    );
  }
});

test("the rounding residue is shown as its own line, not hidden", () => {
  const r = run({ lopDays: 1.5 });
  const rounding = r.lines.filter((l) => l.code === "ROUND_OFF");
  const residue = rounding.reduce(
    (a, l) => a + (l.kind === "deduction" ? l.amountPaise : -l.amountPaise),
    0,
  );
  // Whatever it is, it is under a rupee and it is on the payslip.
  assert.ok(Math.abs(residue) < 100, "rounding never exceeds a rupee");
  if (residue !== 0) {
    assert.equal(rounding.length, 1, "booked once, with a label");
    assert.match(rounding[0].basis, /round/i);
  }
});

test("a whole run reconciles: summed earnings less deductions equals summed net", () => {
  const results = [0, 1, 2.5, 0.5, 3].map((lopDays) => run({ lopDays }));
  const gross = results.reduce((a, r) => a + r.grossPaise, 0);
  const deductions = results.reduce((a, r) => a + r.deductionsPaise, 0);
  const net = results.reduce((a, r) => a + r.netPaise, 0);

  assert.equal(gross - deductions, net, "the register must add up across employees");
});

test("employer contributions never reduce net pay", () => {
  const r = run({ lopDays: 0 });
  assert.ok(r.employerCostPaise > 0, "there is employer cost to speak of");
  assert.equal(
    r.grossPaise - r.deductionsPaise,
    r.netPaise,
    "employer cost sits outside the employee's net",
  );
  const employerLines = r.lines.filter((l) => l.kind === "employer_contribution");
  const employerInDeductions = employerLines.some((l) =>
    r.lines.some((d) => d.kind === "deduction" && d.code === l.code),
  );
  assert.equal(employerInDeductions, false, "never double-booked as a deduction");
});

/* ---------------- the 30-day salary basis ---------------- */

const thirtyDayCompany: CompanyConfig = { ...company, prorationBasis: "fixed_30", standardDays: 30 };

const runThirty = (e: Partial<EmployeeInput> = {}) =>
  computeEmployeePay({
    employee: { ...employee, monthlyGrossPaise: L(30_000), ...e },
    company: thirtyDayCompany,
    statutory,
    year: 2026,
    month: 7, // 31 calendar days — the basis must still divide by 30
  });

test("on a 30-day basis a full month pays the whole gross", () => {
  assert.equal(runThirty().grossPaise, L(30_000));
});

test("one LOP day costs exactly a thirtieth, in a 31-day month", () => {
  // 30,000 / 30 = 1,000 a day. July has 31 days; the basis is still 30.
  const r = runThirty({ lopDays: 1 });
  assert.equal(r.grossPaise, L(29_000));
  assert.equal(r.paidDays, 29);
  assert.equal(r.totalDays, 30, "the divisor is the basis, not the calendar");
});

test("two LOP days cost exactly two thirtieths", () => {
  assert.equal(runThirty({ lopDays: 2 }).grossPaise, L(28_000));
});

test("half a day of loss of pay costs half a day's gross", () => {
  assert.equal(runThirty({ lopDays: 0.5 }).grossPaise, L(29_500));
});

test("loss of pay is taken off earnings, never counted twice", () => {
  const full = runThirty();
  const one = runThirty({ lopDays: 1 });
  assert.equal(
    full.grossPaise - one.grossPaise,
    L(1_000),
    "a day off costs a day's pay, once",
  );
});

test("rounding the net never changes the gross", () => {
  /* A net that rounds up used to be balanced with an earning, which
     added the residue to gross — so somebody on ₹12,000 whose net
     rounded up by a few paise had a payslip headed ₹12,000.43. */
  for (const grossPaise of [12_000_00, 15_000_00, 23_456_78, 47_333_21]) {
    const r = computeEmployeePay({
      employee: {
        ...employee,
        monthlyGrossPaise: grossPaise,
        // A fractional deduction, so the net does not land on a rupee.
        monthlyTdsPaise: 1_971_43,
      },
      company: { ...company, roundNet: true, roundComponents: false, roundGross: false },
      statutory,
      year: 2026,
      month: 9,
    });

    assert.equal(
      r.grossPaise,
      grossPaise,
      `gross must stay ${grossPaise}, got ${r.grossPaise}`,
    );
    assert.equal(
      r.lines.filter((l) => l.kind === "earning").reduce((a, l) => a + l.amountPaise, 0),
      r.grossPaise,
      "earnings still sum to gross",
    );
    assert.equal(
      r.grossPaise - r.deductionsPaise,
      r.netPaise,
      "and the register still reconciles to the rupee",
    );
    assert.equal(r.netPaise % 100, 0, "net is a whole rupee");
  }
});

test("a rounding adjustment is a deduction whichever way it went", () => {
  const r = computeEmployeePay({
    employee: { ...employee, monthlyGrossPaise: 12_000_00, monthlyTdsPaise: 1_971_43 },
    company: { ...company, roundNet: true },
    statutory,
    year: 2026,
    month: 9,
  });
  const roundOff = r.lines.find((l) => l.code === "ROUND_OFF");
  assert.ok(roundOff, "the residue is shown rather than absorbed silently");
  assert.equal(roundOff.kind, "deduction");
});
