import { test, describe } from "node:test";
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
  gratuity: { accrualBps: 481 },
  bonusHeadcountThreshold: 20,
  wageCodeMinimumShareBps: 5000,
  minimumWages: [],
  bonus: {
    eligibilityWagePaise: L(21000),
    calculationCeilingPaise: L(7000),
    minPercent: 8.33,
    maxPercent: 20,
  },
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

describe("Working a weekly off", () => {
  const withTreatment = (
    treatment: "ignore" | "extra_day" | "comp_off",
    offDaysWorked: number,
  ) =>
    computeEmployeePay({
      employee: { ...employee, monthlyGrossPaise: 30_000_00, offDaysWorked },
      company: { ...company, weeklyOffWorkTreatment: treatment },
      statutory,
      year: 2026,
      month: 9, // 30 days, so a day is exactly ₹1,000
    });

  test("ignore pays nothing extra — the day was already paid", () => {
    const r = withTreatment("ignore", 2);
    assert.equal(r.grossPaise, 30_000_00);
    assert.ok(!r.lines.some((l) => l.code === "OFF_DAY_WORK"));
  });

  test("extra day pays a day's wages for each one", () => {
    const r = withTreatment("extra_day", 2);
    assert.equal(r.grossPaise, 32_000_00, "two days at ₹1,000 on a 30-day month");
    const line = r.lines.find((l) => l.code === "OFF_DAY_WORK");
    assert.equal(line?.amountPaise, 2_000_00);
    assert.equal(line?.kind, "earning");
  });

  test("half a day worked is half a day paid", () => {
    assert.equal(withTreatment("extra_day", 0.5).grossPaise, 30_500_00);
  });

  test("comp off is leave, not money, so payroll pays nothing extra", () => {
    const r = withTreatment("comp_off", 2);
    assert.equal(r.grossPaise, 30_000_00);
    assert.ok(!r.lines.some((l) => l.code === "OFF_DAY_WORK"));
  });

  test("nobody working a day off is unaffected whatever the setting", () => {
    for (const t of ["ignore", "extra_day", "comp_off"] as const) {
      assert.equal(withTreatment(t, 0).grossPaise, 30_000_00, t);
    }
  });

  test("the extra day still reconciles — gross less deductions is net", () => {
    const r = withTreatment("extra_day", 1);
    assert.equal(r.grossPaise - r.deductionsPaise, r.netPaise);
    assert.equal(
      r.lines.filter((l) => l.kind === "earning").reduce((a, l) => a + l.amountPaise, 0),
      r.grossPaise,
    );
  });
});

describe("ESIC on the Code's definition of wages", () => {
  const line = (r: ReturnType<typeof run>, code: string) =>
    r.lines.find((l) => l.code === code)?.amountPaise ?? 0;

  test("HRA and conveyance are left out of the wage when within half", () => {
    /* 20,000 gross on the default structure: basic 10,000, HRA 4,000,
       conveyance 1,600, special 4,400. Exclusions 5,600 — under 10,000. */
    const r = run({ monthlyGrossPaise: L(20000), esicCoveredAtPeriodStart: true });
    assert.equal(line(r, "ESIC_EE"), Math.ceil((L(14400) * 75) / 10000));
    assert.equal(line(r, "ESIC_ER"), Math.ceil((L(14400) * 325) / 10000));
  });

  test("a gross over ₹21,000 is still covered when its ESI wage is not", () => {
    /* 24,000 gross → 17,280 of wages once HRA and conveyance are out.
       Testing the ceiling on gross would have left this person unprotected. */
    const r = run({ monthlyGrossPaise: L(24000), esicCoveredAtPeriodStart: false });
    assert.ok(line(r, "ESIC_EE") > 0, "covered on ESI wages");
  });

  test("overtime is charged ESIC — it used to be paid out untouched", () => {
    const without = run({ monthlyGrossPaise: L(20000), esicCoveredAtPeriodStart: true });
    const withOt = run({
      monthlyGrossPaise: L(20000),
      esicCoveredAtPeriodStart: true,
      oneOffLines: [
        { code: "OT", label: "Overtime", kind: "earning", category: "ot", amountPaise: L(15000) },
      ],
    });
    /* Wages 14,400; exclusions 5,600 + 15,000 OT = 20,600 against half of
       35,000 — 3,100 over, so 3,100 is added back. */
    assert.equal(line(withOt, "ESIC_EE"), Math.ceil((L(17500) * 75) / 10000));
    assert.ok(line(withOt, "ESIC_EE") > line(without, "ESIC_EE"));
  });

  test("a large overtime month does not take somebody out of the scheme", () => {
    const r = run({
      monthlyGrossPaise: L(20000),
      esicCoveredAtPeriodStart: false,
      oneOffLines: [
        { code: "OT", label: "Overtime", kind: "earning", category: "ot", amountPaise: L(30000) },
      ],
    });
    assert.ok(line(r, "ESIC_EE") > 0, "the ceiling is tested without overtime");
  });

  test("an incentive is wages", () => {
    const base = run({ monthlyGrossPaise: L(16000), esicCoveredAtPeriodStart: true });
    const withIncentive = run({
      monthlyGrossPaise: L(16000),
      esicCoveredAtPeriodStart: true,
      oneOffLines: [
        { code: "INC", label: "Incentive", kind: "earning", category: "incentive", amountPaise: L(2000) },
      ],
    });
    assert.equal(line(withIncentive, "ESIC_ER") - line(base, "ESIC_ER"), Math.ceil((L(2000) * 325) / 10000));
  });

  test("a period before the Code keeps the ESI Act's wage", () => {
    const r = computeEmployeePay({
      employee: { ...employee, monthlyGrossPaise: L(20000), esicCoveredAtPeriodStart: true },
      company,
      statutory,
      year: 2025,
      month: 9,
    });
    assert.equal(line(r, "ESIC_EE"), Math.ceil((L(20000) * 75) / 10000), "full gross, as filed then");
  });

  test("the payslip says how the wage was reached", () => {
    const r = run({ monthlyGrossPaise: L(20000), esicCoveredAtPeriodStart: true });
    const basis = r.lines.find((l) => l.code === "ESIC_EE")!.basis;
    assert.match(basis, /ESI wages ₹14,400/);
  });
});

describe("Statutory bonus on a part month", () => {
  const withBonus: CompanyConfig = {
    ...company,
    structure: [
      ...DEFAULT_STRUCTURE.filter((c) => c.code !== "SPL"),
      {
        code: "BONUS", label: "Statutory Bonus", kind: "earning",
        calcMethod: "statutory_bonus", percentValue: 8.33, fixedPaise: L(7000),
        taxable: true, epfBase: false, esicBase: true, ptBase: true,
        bonusBase: false, gratuityBase: false, prorates: true, sequence: 4,
      },
      ...DEFAULT_STRUCTURE.filter((c) => c.code === "SPL"),
    ],
  };

  const pay = (over: Partial<EmployeeInput>) =>
    computeEmployeePay({
      employee: { ...employee, ...over },
      company: withBonus,
      statutory,
      year: 2026,
      month: 8,
    });

  const bonusOf = (r: ReturnType<typeof pay>) =>
    r.lines.find((l) => l.code === "BONUS")!.amountPaise;

  test("a full month pays the percentage of the capped wage", () => {
    assert.equal(bonusOf(pay({})), Math.round(L(7000) * 8.33 / 100));
  });

  test("a joiner still earning above the ceiling gets the same, not a prorated share", () => {
    /* Half a month on ₹80,000 is basic of ₹20,000 — comfortably over the
       ₹7,000 ceiling, so the Act's figure has not changed. Prorating the
       capped amount applies the cap twice. */
    const r = pay({ dateOfJoining: "2026-08-16" });
    assert.ok(r.paidDays < r.totalDays, "this is a part month");
    assert.equal(bonusOf(r), Math.round(L(7000) * 8.33 / 100));
  });

  test("when earned wages fall under the ceiling it is the percentage of those wages", () => {
    // Basic is half of gross; joining late leaves earned basic under ₹7,000.
    const r = pay({ monthlyGrossPaise: L(20000), dateOfJoining: "2026-08-22" });
    const basic = r.lines.find((l) => l.code === "BASIC")!.amountPaise;
    assert.ok(basic < L(7000), "earned basic is under the ceiling");
    assert.equal(bonusOf(r), Math.round(basic * 8.33 / 100));
  });

  test("gross still totals what it was solved for — the balance pays for it", () => {
    const r = pay({});
    const earnings = r.lines
      .filter((l) => l.kind === "earning")
      .reduce((a, l) => a + l.amountPaise, 0);
    assert.equal(earnings, r.grossPaise);
    assert.equal(r.grossPaise, L(80000));
  });
});

describe("Both kinds of people in one company", () => {
  /* A company of a dozen routinely holds somebody carrying PF membership
     from a previous job alongside somebody who has never been a member.
     The establishment's coverage is one answer; the person's own record
     is the other, and it wins in both directions. */
  const pay = (over: Partial<EmployeeInput>) =>
    computeEmployeePay({
      employee: { ...employee, monthlyGrossPaise: L(30000), ...over },
      company,
      statutory,
      year: 2026,
      month: 8,
    });

  const deducted = (r: ReturnType<typeof pay>, code: string) =>
    r.lines.find((l) => l.code === code)?.amountPaise ?? 0;

  test("switched off, nothing is deducted or contributed", () => {
    const r = pay({ pfApplicability: "no", epfEstablishmentCovered: false });
    assert.equal(deducted(r, "EPF_EE"), 0);
    assert.equal(deducted(r, "EPF_ER"), 0);
  });

  test("and it is not reported every month as though it were a problem", () => {
    /* The decision was made once, on the person's record, with a name
       against it in the audit trail. A finding a month for every such
       person buries the findings that do need reading. */
    const r = pay({ pfApplicability: "no", epfEstablishmentCovered: false });
    assert.equal(
      r.warnings.filter((w) => /switched off|not applicable/i.test(w)).length,
      0,
    );
  });

  test("switched on, it is deducted even where the establishment is outside the Act", () => {
    /* Voluntary coverage for one person and not another — a real thing a
       small company does. */
    const r = pay({ pfApplicability: "yes", epfEstablishmentCovered: true });
    assert.ok(deducted(r, "EPF_EE") > 0);
    assert.ok(deducted(r, "EPF_ER") > 0);
  });

  test("the two sit side by side in the same month", () => {
    const withPf = pay({ pfApplicability: "yes", epfEstablishmentCovered: true });
    const withoutPf = pay({ pfApplicability: "no", epfEstablishmentCovered: false });
    assert.ok(withPf.netPaise < withoutPf.netPaise, "one pays into the fund, the other does not");
    assert.equal(withPf.grossPaise, withoutPf.grossPaise, "and neither one's gross moved");
  });

  test("professional tax switched off is not deducted", () => {
    const on = pay({});
    const off = pay({ ptApplicability: "no" });
    if (deducted(on, "PT") > 0) {
      assert.equal(deducted(off, "PT"), 0);
      assert.equal(
        off.warnings.filter((w) => /switched off/i.test(w)).length,
        0,
        "a deliberate setting is not a finding",
      );
    }
  });
});
