import { test } from "node:test";
import assert from "node:assert/strict";
import {
  exemptGratuity,
  exemptLeaveEncashment,
  exemptSeparationCompensation,
  treatNoticePay,
  computeSeparationTax,
  assessAgeing,
  assessReceivable,
  marginalRateBps,
  SEPARATION_LIMITS_2026 as L,
} from "./settlement-tax";
import { OLD_REGIME_2026, NEW_REGIME_2026 } from "../tax/config";

const R = (rupees: number) => Math.round(rupees * 100);

/* ---------------- gratuity, section 10(10) ---------------- */

test("gratuity exemption is the least of the three limbs", () => {
  const r = exemptGratuity({
    receivedPaise: R(400000),
    monthlyBasicPaise: R(50000),
    completedYears: 10,
    coveredByAct: true,
    limits: L,
    regime: "old",
  });
  // 15/26 of 50,000 x 10 = 288,461
  assert.equal(r.exemptPaise, Math.round((R(50000) * 15 * 10) / 26));
  assert.equal(r.taxablePaise, R(400000) - r.exemptPaise);
  assert.equal(r.workings.length, 3);
});

test("the statutory ceiling binds on a long, well-paid career", () => {
  const r = exemptGratuity({
    receivedPaise: R(3000000),
    monthlyBasicPaise: R(400000),
    completedYears: 30,
    coveredByAct: true,
    limits: L,
    regime: "old",
  });
  assert.equal(r.exemptPaise, L.gratuityCeilingPaise);
  assert.equal(r.taxablePaise, R(3000000) - L.gratuityCeilingPaise);
});

test("gratuity within every limb is wholly exempt", () => {
  const r = exemptGratuity({
    receivedPaise: R(100000),
    monthlyBasicPaise: R(50000),
    completedYears: 10,
    coveredByAct: true,
    limits: L,
    regime: "old",
  });
  assert.equal(r.exemptPaise, R(100000));
  assert.equal(r.taxablePaise, 0);
});

test("the exemption survives the new regime, unlike Chapter VI-A", () => {
  const oldR = exemptGratuity({
    receivedPaise: R(400000), monthlyBasicPaise: R(50000), completedYears: 10,
    coveredByAct: true, limits: L, regime: "old",
  });
  const newR = exemptGratuity({
    receivedPaise: R(400000), monthlyBasicPaise: R(50000), completedYears: 10,
    coveredByAct: true, limits: L, regime: "new",
  });
  assert.equal(oldR.exemptPaise, newR.exemptPaise);
  assert.ok(newR.exemptPaise > 0);
});

test("an uncovered employee uses half a month's salary, not 15/26", () => {
  const covered = exemptGratuity({
    receivedPaise: R(400000), monthlyBasicPaise: R(50000), completedYears: 10,
    coveredByAct: true, limits: L, regime: "old",
  });
  const uncovered = exemptGratuity({
    receivedPaise: R(400000), monthlyBasicPaise: R(50000), completedYears: 10,
    coveredByAct: false, averageMonthlyBasicPaise: R(50000), limits: L, regime: "old",
  });
  assert.equal(uncovered.exemptPaise, R(250000), "half of 50,000 x 10 years");
  assert.notEqual(covered.exemptPaise, uncovered.exemptPaise);
});

test("an uncovered employee with no average supplied is flagged", () => {
  const r = exemptGratuity({
    receivedPaise: R(400000), monthlyBasicPaise: R(50000), completedYears: 10,
    coveredByAct: false, limits: L, regime: "old",
  });
  assert.ok(r.warnings.some((w) => w.includes("may overstate the exemption")));
});

test("no gratuity produces no exemption and no noise", () => {
  const r = exemptGratuity({
    receivedPaise: 0, monthlyBasicPaise: R(50000), completedYears: 2,
    coveredByAct: true, limits: L, regime: "old",
  });
  assert.equal(r.exemptPaise, 0);
  assert.equal(r.workings.length, 0);
});

/* ---------------- leave encashment, 10(10AA) ---------------- */

const leave = (over: Partial<Parameters<typeof exemptLeaveEncashment>[0]> = {}) =>
  exemptLeaveEncashment({
    receivedPaise: R(200000),
    averageMonthlySalaryPaise: R(60000),
    completedYears: 10,
    encashedDays: 90,
    isGovernmentEmployee: false,
    limits: L,
    ...over,
  });

test("a government employee's encashment is wholly exempt", () => {
  const r = leave({ isGovernmentEmployee: true });
  assert.equal(r.exemptPaise, R(200000));
  assert.equal(r.taxablePaise, 0);
});

test("the private-sector exemption is the least of four limbs", () => {
  const r = leave();
  assert.equal(r.workings.length, 4);
  // 90 days at 2,000 a day = 180,000, the binding limb here
  assert.equal(r.exemptPaise, R(180000));
  assert.equal(r.taxablePaise, R(20000));
});

test("only 30 days a year of service qualify", () => {
  // 10 years allows 300 days; encashing 400 does not extend the limb
  const r = leave({ encashedDays: 400, receivedPaise: R(900000) });
  assert.ok(r.warnings.some((w) => w.includes("qualify for the exemption")));
  assert.equal(r.exemptPaise, R(600000), "300 days at 2,000");
});

test("ten months' average salary caps a large encashment", () => {
  const r = leave({
    receivedPaise: R(900000),
    encashedDays: 300,
    averageMonthlySalaryPaise: R(50000),
  });
  // 10 months of 50,000 = 500,000, below 300 days at 1,666
  assert.equal(r.exemptPaise, R(500000));
});

test("the lifetime ceiling is reduced by what an earlier employer used", () => {
  const fresh = leave({ receivedPaise: R(3000000), encashedDays: 300, averageMonthlySalaryPaise: R(400000) });
  const used = leave({
    receivedPaise: R(3000000),
    encashedDays: 300,
    averageMonthlySalaryPaise: R(400000),
    previouslyExemptPaise: R(2000000),
  });
  assert.equal(fresh.exemptPaise, L.leaveEncashmentCeilingPaise);
  assert.equal(used.exemptPaise, L.leaveEncashmentCeilingPaise - R(2000000));
  assert.ok(used.warnings.some((w) => w.includes("already been used")));
});

/* ---------------- retrenchment and VRS ---------------- */

test("VRS compensation is exempt up to the ceiling, with its conditions flagged", () => {
  const r = exemptSeparationCompensation({
    receivedPaise: R(800000),
    kind: "vrs",
    limits: L,
  });
  assert.equal(r.exemptPaise, L.vrsCeilingPaise);
  assert.equal(r.taxablePaise, R(300000));
  assert.ok(r.warnings.some((w) => w.includes("once in a lifetime")));
});

test("retrenchment takes the least of received, ceiling and the ID Act limb", () => {
  const r = exemptSeparationCompensation({
    receivedPaise: R(800000),
    kind: "retrenchment",
    averageDailyPaise: R(2000),
    completedYears: 10,
    limits: L,
  });
  // 15 days x 2,000 x 10 = 300,000, the least
  assert.equal(r.exemptPaise, R(300000));
});

test("no separation compensation leaves nothing taxable", () => {
  const r = exemptSeparationCompensation({
    receivedPaise: 0,
    kind: "none",
    limits: L,
  });
  assert.equal(r.exemptPaise, 0);
  assert.equal(r.taxablePaise, 0);
});

/* ---------------- notice pay ---------------- */

test("notice pay paid by the employer is taxable", () => {
  const r = treatNoticePay({
    paidByEmployerPaise: R(100000),
    recoveredFromEmployeePaise: 0,
    reducesTaxableSalary: false,
  });
  assert.equal(r.taxableEffectPaise, R(100000));
  assert.match(r.basis, /profits in lieu of salary/);
});

test("recovery reduces taxable salary when the company takes that view", () => {
  const r = treatNoticePay({
    paidByEmployerPaise: 0,
    recoveredFromEmployeePaise: R(100000),
    reducesTaxableSalary: true,
  });
  assert.equal(r.taxableEffectPaise, R(-100000));
  assert.ok(r.warnings.some((w) => w.includes("can be questioned on assessment")));
});

test("recovery does not reduce salary on the other view, and says so plainly", () => {
  const r = treatNoticePay({
    paidByEmployerPaise: 0,
    recoveredFromEmployeePaise: R(100000),
    reducesTaxableSalary: false,
  });
  assert.equal(r.taxableEffectPaise, 0);
  assert.ok(
    r.warnings.some((w) => w.includes("taxed on salary they did not keep")),
  );
});

test("the two directions are not symmetrical", () => {
  const paid = treatNoticePay({
    paidByEmployerPaise: R(100000), recoveredFromEmployeePaise: 0, reducesTaxableSalary: true,
  });
  const recovered = treatNoticePay({
    paidByEmployerPaise: 0, recoveredFromEmployeePaise: R(100000), reducesTaxableSalary: false,
  });
  assert.equal(paid.taxableEffectPaise, R(100000));
  assert.equal(recovered.taxableEffectPaise, 0, "not a mirror image");
});

/* ---------------- the final computation ---------------- */

const nil = {
  section: "—", component: "none", receivedPaise: 0, exemptPaise: 0,
  taxablePaise: 0, workings: [], basis: "", warnings: [],
};

const separation = (over: Partial<Parameters<typeof computeSeparationTax>[0]> = {}) =>
  computeSeparationTax({
    regime: "new",
    config: NEW_REGIME_2026,
    limits: L,
    salaryToDatePaise: R(600000),
    exemptAllowancesToDatePaise: 0,
    chapterViAPaise: 0,
    professionalTaxPaidPaise: 0,
    tdsDeductedToDatePaise: R(20000),
    previousEmployerSalaryPaise: 0,
    previousEmployerTdsPaise: 0,
    gratuity: nil,
    leaveEncashment: nil,
    separationCompensation: nil,
    notice: treatNoticePay({
      paidByEmployerPaise: 0,
      recoveredFromEmployeePaise: 0,
      reducesTaxableSalary: false,
    }),
    otherTaxablePaise: 0,
    ...over,
  });

test("the settlement is taxed with the year, not as a separate month", () => {
  const r = separation({
    gratuity: exemptGratuity({
      receivedPaise: R(400000), monthlyBasicPaise: R(50000), completedYears: 10,
      coveredByAct: true, limits: L, regime: "new",
    }),
  });
  // The taxable income includes salary to date plus the taxable part of
  // the settlement, not the settlement alone.
  assert.ok(r.taxableIncomePaise > R(600000) - R(75000));
  assert.equal(r.alreadyDeductedPaise, R(20000));
});

test("only the non-exempt part of a settlement component is taxed", () => {
  const g = exemptGratuity({
    receivedPaise: R(400000), monthlyBasicPaise: R(50000), completedYears: 10,
    coveredByAct: true, limits: L, regime: "new",
  });
  const r = separation({ gratuity: g });
  assert.equal(r.totalSettlementPaise, R(400000));
  assert.equal(r.totalExemptPaise, g.exemptPaise);
  assert.equal(r.totalTaxablePaise, g.taxablePaise);
});

test("tax already deducted is credited once", () => {
  const withCredit = separation({ tdsDeductedToDatePaise: R(20000) });
  const without = separation({ tdsDeductedToDatePaise: 0 });
  assert.equal(
    without.tdsOnSettlementPaise - withCredit.tdsOnSettlementPaise,
    R(20000),
  );
});

test("over-deduction across the year resolves to a refund, not a zero", () => {
  const r = separation({
    salaryToDatePaise: R(300000),
    tdsDeductedToDatePaise: R(50000),
  });
  assert.equal(r.isRefund, true);
  assert.ok(r.tdsOnSettlementPaise < 0);
  assert.ok(
    r.warnings.some((w) => w.includes("must be paid with the settlement")),
  );
});

test("a year with no TDS at all is flagged rather than silently caught up", () => {
  const r = separation({
    tdsDeductedToDatePaise: 0,
    otherTaxablePaise: R(200000),
  });
  assert.ok(r.warnings.some((w) => w.includes("never projected")));
});

test("notice recovered reduces the taxable settlement where policy allows", () => {
  const reduces = separation({
    notice: treatNoticePay({
      paidByEmployerPaise: 0,
      recoveredFromEmployeePaise: R(100000),
      reducesTaxableSalary: true,
    }),
  });
  const doesNot = separation({
    notice: treatNoticePay({
      paidByEmployerPaise: 0,
      recoveredFromEmployeePaise: R(100000),
      reducesTaxableSalary: false,
    }),
  });
  assert.ok(reduces.taxableIncomePaise < doesNot.taxableIncomePaise);
});

test("only components actually received appear on the statement", () => {
  const r = separation();
  assert.equal(r.components.length, 0);
});

test("the old regime allows Chapter VI-A against the settlement, the new does not", () => {
  const oldR = separation({
    regime: "old",
    config: OLD_REGIME_2026,
    chapterViAPaise: R(150000),
  });
  const newR = separation({ chapterViAPaise: R(150000) });
  assert.ok(oldR.taxableIncomePaise < newR.taxableIncomePaise + R(150000));
});

test("the marginal rate names the band the settlement lands in", () => {
  assert.equal(marginalRateBps(R(1000000), NEW_REGIME_2026), 1000);
  assert.equal(marginalRateBps(R(300000), NEW_REGIME_2026), 0);
});

/* ---------------- ageing ---------------- */

test("a settlement inside its SLA is not due", () => {
  const a = assessAgeing({
    lastWorkingDay: "2026-09-01",
    today: "2026-09-11",
    slaDays: 45,
    gratuityPayable: false,
    settled: false,
  });
  assert.equal(a.status, "not_due");
  assert.equal(a.daysSinceLastWorkingDay, 10);
});

test("a week from the deadline is due soon", () => {
  const a = assessAgeing({
    lastWorkingDay: "2026-08-01",
    today: "2026-09-11",
    slaDays: 45,
    gratuityPayable: false,
    settled: false,
  });
  assert.equal(a.status, "due_soon");
});

test("past the SLA is overdue, and says by how much", () => {
  const a = assessAgeing({
    lastWorkingDay: "2026-07-01",
    today: "2026-09-11",
    slaDays: 45,
    gratuityPayable: false,
    settled: false,
  });
  assert.equal(a.status, "overdue");
  assert.match(a.note, /past the 45-day settlement commitment/);
});

test("gratuity has its own faster clock and wins over the SLA", () => {
  const a = assessAgeing({
    lastWorkingDay: "2026-08-01",
    today: "2026-09-11",
    slaDays: 45,
    gratuityPayable: true,
    settled: false,
  });
  assert.equal(a.status, "gratuity_overdue", "41 days is inside 45 but past 30");
  assert.match(a.note, /interest runs on a delay/);
});

test("a settled case drops out of the queue", () => {
  const a = assessAgeing({
    lastWorkingDay: "2026-01-01",
    today: "2026-09-11",
    slaDays: 45,
    gratuityPayable: true,
    settled: true,
  });
  assert.equal(a.status, "not_due");
  assert.equal(a.note, "Settled");
});

/* ---------------- receivables ---------------- */

test("an unrecovered demand stays outstanding in full", () => {
  const r = assessReceivable({
    originalPaise: R(50000),
    recoveries: [],
    writtenOffPaise: 0,
  });
  assert.equal(r.status, "outstanding");
  assert.equal(r.outstandingPaise, R(50000));
  assert.equal(r.settled, false);
});

test("part recovery is tracked rather than rounded away", () => {
  const r = assessReceivable({
    originalPaise: R(50000),
    recoveries: [{ amountPaise: R(20000), at: "2026-09-01", method: "bank transfer", reference: "UTR1" }],
    writtenOffPaise: 0,
  });
  assert.equal(r.status, "part_recovered");
  assert.equal(r.recoveredPaise, R(20000));
  assert.equal(r.outstandingPaise, R(30000));
});

test("full recovery settles the receivable", () => {
  const r = assessReceivable({
    originalPaise: R(50000),
    recoveries: [
      { amountPaise: R(20000), at: "2026-09-01", method: "bank", reference: null },
      { amountPaise: R(30000), at: "2026-10-01", method: "bank", reference: null },
    ],
    writtenOffPaise: 0,
  });
  assert.equal(r.status, "recovered");
  assert.equal(r.settled, true);
});

test("a write-off clears the balance but is never called a recovery", () => {
  const r = assessReceivable({
    originalPaise: R(50000),
    recoveries: [],
    writtenOffPaise: R(50000),
  });
  assert.equal(r.status, "written_off");
  assert.equal(r.recoveredPaise, 0, "nothing was actually collected");
  assert.equal(r.settled, true);
});

test("collecting more than was owed is flagged", () => {
  const r = assessReceivable({
    originalPaise: R(50000),
    recoveries: [{ amountPaise: R(60000), at: "2026-09-01", method: "bank", reference: null }],
    writtenOffPaise: 0,
  });
  assert.ok(r.warnings.some((w) => w.includes("More has been collected than was owed")));
  assert.equal(r.outstandingPaise, 0, "never negative");
});
