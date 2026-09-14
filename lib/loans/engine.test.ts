import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeEmi,
  buildSchedule,
  checkEligibility,
  planRecovery,
  applyPrepayment,
  foreclosureQuote,
  applyHold,
  recoverAtExit,
  monthEndBalances,
  type LoanScheme,
  type RecoverableLoan,
} from "./engine";

const L = (rupees: number) => Math.round(rupees * 100);

const scheme: LoanScheme = {
  code: "PERSONAL",
  label: "Personal loan",
  interestMethod: "reducing_balance",
  annualRateBps: 900,
  maxPrincipalPaise: L(500000),
  maxTenureMonths: 36,
  minServiceMonths: 12,
  maxInstalmentOfGrossBps: 3000,
  allowConcurrent: false,
  requiresGuarantor: false,
  minNetPayPaise: L(10000),
};

/* ---------------- instalment ---------------- */

test("an interest-free loan divides evenly", () => {
  const emi = computeEmi({
    principalPaise: L(120000),
    annualRateBps: 0,
    tenureMonths: 12,
    method: "interest_free",
  });
  assert.equal(emi, L(10000));
});

test("a zero rate on the reducing method does not divide by zero", () => {
  const emi = computeEmi({
    principalPaise: L(120000),
    annualRateBps: 0,
    tenureMonths: 12,
    method: "reducing_balance",
  });
  assert.equal(emi, L(10000));
});

test("reducing-balance EMI matches the standard formula", () => {
  const emi = computeEmi({
    principalPaise: L(500000),
    annualRateBps: 900,
    tenureMonths: 36,
    method: "reducing_balance",
  });
  // 5,00,000 at 9% over 36 months is about ₹15,900 a month.
  assert.ok(emi > L(15800) && emi < L(16000), `got ${emi / 100}`);
});

test("flat interest produces a higher instalment than reducing at the same rate", () => {
  const flat = computeEmi({
    principalPaise: L(500000),
    annualRateBps: 900,
    tenureMonths: 36,
    method: "flat",
  });
  const reducing = computeEmi({
    principalPaise: L(500000),
    annualRateBps: 900,
    tenureMonths: 36,
    method: "reducing_balance",
  });
  assert.ok(flat > reducing, "flat charges interest on the original principal");
});

test("a tenure of zero is refused rather than producing Infinity", () => {
  assert.throws(
    () =>
      computeEmi({
        principalPaise: L(100000),
        annualRateBps: 900,
        tenureMonths: 0,
        method: "reducing_balance",
      }),
    /at least one month/,
  );
});

test("a nil principal has a nil instalment", () => {
  assert.equal(
    computeEmi({
      principalPaise: 0,
      annualRateBps: 900,
      tenureMonths: 12,
      method: "reducing_balance",
    }),
    0,
  );
});

/* ---------------- schedule ---------------- */

test("the principal column sums to exactly the amount lent", () => {
  for (const method of ["interest_free", "flat", "reducing_balance"] as const) {
    const s = buildSchedule({
      principalPaise: L(237500),
      annualRateBps: 875,
      tenureMonths: 17,
      method,
    });
    const sum = s.rows.reduce((a, r) => a + r.principalPaise, 0);
    assert.equal(sum, L(237500), `${method} strands rounding`);
  }
});

test("the final closing balance is exactly zero", () => {
  for (const method of ["interest_free", "flat", "reducing_balance"] as const) {
    const s = buildSchedule({
      principalPaise: L(237500),
      annualRateBps: 875,
      tenureMonths: 17,
      method,
    });
    assert.equal(s.rows[s.rows.length - 1].closingPaise, 0, method);
  }
});

test("each row's closing is its opening less the principal repaid", () => {
  const s = buildSchedule({
    principalPaise: L(300000),
    annualRateBps: 900,
    tenureMonths: 24,
    method: "reducing_balance",
  });
  for (const r of s.rows) {
    assert.equal(r.closingPaise, r.openingPaise - r.principalPaise);
    assert.equal(r.instalmentPaise, r.principalPaise + r.interestPaise);
  }
});

test("interest falls month on month under the reducing method", () => {
  const s = buildSchedule({
    principalPaise: L(300000),
    annualRateBps: 900,
    tenureMonths: 24,
    method: "reducing_balance",
  });
  for (let i = 1; i < s.rows.length; i++) {
    assert.ok(
      s.rows[i].interestPaise <= s.rows[i - 1].interestPaise,
      `interest rose at instalment ${i + 1}`,
    );
  }
});

test("an interest-free schedule books no interest at all", () => {
  const s = buildSchedule({
    principalPaise: L(120000),
    annualRateBps: 900,
    tenureMonths: 12,
    method: "interest_free",
  });
  assert.equal(s.totalInterestPaise, 0);
  assert.equal(s.totalPayablePaise, L(120000));
});

test("a single-instalment advance clears in one row", () => {
  const s = buildSchedule({
    principalPaise: L(25000),
    annualRateBps: 0,
    tenureMonths: 1,
    method: "interest_free",
  });
  assert.equal(s.rows.length, 1);
  assert.equal(s.rows[0].principalPaise, L(25000));
  assert.equal(s.rows[0].closingPaise, 0);
});

test("an odd principal still clears exactly, with the last instalment absorbing it", () => {
  const s = buildSchedule({
    principalPaise: 100003, // ₹1,000.03
    annualRateBps: 0,
    tenureMonths: 7,
    method: "interest_free",
  });
  assert.equal(s.rows.reduce((a, r) => a + r.principalPaise, 0), 100003);
  assert.equal(s.rows[s.rows.length - 1].closingPaise, 0);
});

/* ---------------- eligibility ---------------- */

const baseApplication = {
  scheme,
  serviceMonths: 30,
  monthlyGrossPaise: L(80000),
  requestedPrincipalPaise: L(300000),
  requestedTenureMonths: 24,
  existingActiveUnderScheme: 0,
  existingMonthlyRecoveryPaise: 0,
  hasGuarantor: false,
};

test("a reasonable application is eligible", () => {
  const r = checkEligibility(baseApplication);
  assert.equal(r.eligible, true);
  assert.deepEqual(r.errors, []);
  assert.ok(r.emiPaise > 0);
});

test("service shorter than the scheme minimum is refused", () => {
  const r = checkEligibility({ ...baseApplication, serviceMonths: 6 });
  assert.equal(r.eligible, false);
  assert.ok(r.errors.some((e) => e.includes("months of service")));
});

test("a principal above the scheme ceiling is refused", () => {
  const r = checkEligibility({
    ...baseApplication,
    requestedPrincipalPaise: L(600000),
  });
  assert.ok(r.errors.some((e) => e.includes("lends at most")));
});

test("a tenure beyond the scheme is refused", () => {
  const r = checkEligibility({ ...baseApplication, requestedTenureMonths: 48 });
  assert.ok(r.errors.some((e) => e.includes("at most 36 months")));
});

test("a second loan is refused where the scheme forbids it", () => {
  const r = checkEligibility({
    ...baseApplication,
    existingActiveUnderScheme: 1,
  });
  assert.ok(r.errors.some((e) => e.includes("only one live loan")));
});

test("the affordability cap counts recoveries already running", () => {
  const alone = checkEligibility(baseApplication);
  assert.equal(alone.eligible, true);

  const committed = checkEligibility({
    ...baseApplication,
    existingMonthlyRecoveryPaise: L(20000),
  });
  assert.equal(committed.eligible, false);
  assert.ok(
    committed.errors.some((e) => e.includes("already being recovered")),
    committed.errors.join("; "),
  );
});

test("a guarantor requirement is enforced", () => {
  const r = checkEligibility({
    ...baseApplication,
    scheme: { ...scheme, requiresGuarantor: true },
  });
  assert.ok(r.errors.some((e) => e.includes("guarantor")));
});

test("the maximum affordable principal is itself affordable", () => {
  const r = checkEligibility({
    ...baseApplication,
    requestedPrincipalPaise: L(500000),
    requestedTenureMonths: 24,
  });
  const emiAtMax = computeEmi({
    principalPaise: r.maxAffordablePrincipalPaise,
    annualRateBps: scheme.annualRateBps,
    tenureMonths: 24,
    method: scheme.interestMethod,
  });
  const ceiling = Math.round((L(80000) * scheme.maxInstalmentOfGrossBps) / 10000);
  assert.ok(emiAtMax <= ceiling, `${emiAtMax / 100} exceeds ${ceiling / 100}`);
});

test("flat schemes warn about the effective rate", () => {
  const r = checkEligibility({
    ...baseApplication,
    scheme: { ...scheme, interestMethod: "flat" },
  });
  assert.ok(r.warnings.some((w) => w.includes("effective rate")));
});

/* ---------------- monthly recovery ---------------- */

const loan = (over: Partial<RecoverableLoan> = {}): RecoverableLoan => ({
  loanId: "l1",
  label: "Personal loan",
  outstandingPaise: L(200000),
  instalmentPaise: L(10000),
  arrearsPaise: 0,
  status: "active",
  startedOn: "2025-04-01",
  ...over,
});

test("a full instalment is recovered when pay allows", () => {
  const r = planRecovery({
    loans: [loan()],
    netBeforeRecoveryPaise: L(60000),
    minNetPayPaise: L(10000),
  });
  assert.equal(r.totalRecoveredPaise, L(10000));
  assert.equal(r.totalShortfallPaise, 0);
  assert.equal(r.netAfterRecoveryPaise, L(50000));
});

test("recovery stops at the net-pay floor and carries the rest as arrears", () => {
  const r = planRecovery({
    loans: [loan()],
    netBeforeRecoveryPaise: L(14000),
    minNetPayPaise: L(10000),
  });
  assert.equal(r.totalRecoveredPaise, L(4000));
  assert.equal(r.totalShortfallPaise, L(6000));
  assert.equal(r.netAfterRecoveryPaise, L(10000), "the floor is respected exactly");
  assert.ok(r.warnings.some((w) => w.includes("carries as arrears")));
});

test("net pay already at the floor recovers nothing", () => {
  const r = planRecovery({
    loans: [loan()],
    netBeforeRecoveryPaise: L(9000),
    minNetPayPaise: L(10000),
  });
  assert.equal(r.totalRecoveredPaise, 0);
  assert.equal(r.lines[0].note, "Nothing recoverable this month; the instalment carries as arrears");
});

test("recovery never exceeds the outstanding balance", () => {
  const r = planRecovery({
    loans: [loan({ outstandingPaise: L(3000) })],
    netBeforeRecoveryPaise: L(60000),
    minNetPayPaise: L(10000),
  });
  assert.equal(r.totalRecoveredPaise, L(3000));
  assert.equal(r.lines[0].closesLoan, true);
  assert.match(r.lines[0].note, /Final instalment/);
});

test("arrears are collected on top of the current instalment", () => {
  const r = planRecovery({
    loans: [loan({ arrearsPaise: L(6000) })],
    netBeforeRecoveryPaise: L(60000),
    minNetPayPaise: L(10000),
  });
  assert.equal(r.lines[0].duePaise, L(16000));
  assert.equal(r.lines[0].note, "Instalment plus arrears");
});

test("a loan on hold is skipped without becoming arrears", () => {
  const r = planRecovery({
    loans: [loan({ status: "on_hold" })],
    netBeforeRecoveryPaise: L(60000),
    minNetPayPaise: L(10000),
  });
  assert.equal(r.totalRecoveredPaise, 0);
  assert.equal(r.totalShortfallPaise, 0);
  assert.match(r.lines[0].note, /On hold/);
});

test("a closed loan is not recovered at all", () => {
  const r = planRecovery({
    loans: [loan({ status: "closed" })],
    netBeforeRecoveryPaise: L(60000),
    minNetPayPaise: L(10000),
  });
  assert.equal(r.lines.length, 0);
});

test("the oldest loan is recovered first when pay cannot cover both", () => {
  const r = planRecovery({
    loans: [
      loan({ loanId: "new", label: "Newer", startedOn: "2026-01-01" }),
      loan({ loanId: "old", label: "Older", startedOn: "2024-01-01" }),
    ],
    netBeforeRecoveryPaise: L(22000),
    minNetPayPaise: L(10000),
  });
  const older = r.lines.find((l) => l.loanId === "old")!;
  const newer = r.lines.find((l) => l.loanId === "new")!;
  assert.equal(older.recoveredPaise, L(10000), "older is served first");
  assert.equal(newer.recoveredPaise, L(2000));
  assert.equal(newer.shortfallPaise, L(8000));
});

/* ---------------- prepayment ---------------- */

test("a prepayment that covers the balance forecloses the loan", () => {
  const r = applyPrepayment({
    outstandingPaise: L(50000),
    instalmentPaise: L(10000),
    remainingMonths: 5,
    annualRateBps: 900,
    method: "reducing_balance",
    amountPaise: L(60000),
    mode: "reduce_tenure",
  });
  assert.equal(r.closesLoan, true);
  assert.equal(r.newOutstandingPaise, 0);
  assert.ok(r.interestSavedPaise > 0);
});

test("reducing the tenure keeps the instalment and shortens the loan", () => {
  const r = applyPrepayment({
    outstandingPaise: L(200000),
    instalmentPaise: L(10000),
    remainingMonths: 21,
    annualRateBps: 900,
    method: "reducing_balance",
    amountPaise: L(50000),
    mode: "reduce_tenure",
  });
  assert.equal(r.newInstalmentPaise, L(10000));
  assert.ok(r.newTenureMonths < 21);
  assert.ok(r.interestSavedPaise > 0);
});

test("reducing the instalment keeps the tenure", () => {
  const r = applyPrepayment({
    outstandingPaise: L(200000),
    instalmentPaise: L(10000),
    remainingMonths: 21,
    annualRateBps: 900,
    method: "reducing_balance",
    amountPaise: L(50000),
    mode: "reduce_instalment",
  });
  assert.equal(r.newTenureMonths, 21);
  assert.ok(r.newInstalmentPaise < L(10000));
});

test("shortening the tenure saves more interest than cutting the instalment", () => {
  const common = {
    outstandingPaise: L(200000),
    instalmentPaise: L(10000),
    remainingMonths: 21,
    annualRateBps: 900,
    method: "reducing_balance" as const,
    amountPaise: L(50000),
  };
  const tenure = applyPrepayment({ ...common, mode: "reduce_tenure" });
  const instalment = applyPrepayment({ ...common, mode: "reduce_instalment" });
  assert.ok(tenure.interestSavedPaise > instalment.interestSavedPaise);
});

test("a prepayment cannot be zero or negative", () => {
  assert.throws(
    () =>
      applyPrepayment({
        outstandingPaise: L(100000),
        instalmentPaise: L(10000),
        remainingMonths: 12,
        annualRateBps: 900,
        method: "reducing_balance",
        amountPaise: 0,
        mode: "reduce_tenure",
      }),
    /positive amount/,
  );
});

test("an instalment below the monthly interest is refused, not looped forever", () => {
  assert.throws(
    () =>
      applyPrepayment({
        outstandingPaise: L(1000000),
        instalmentPaise: L(100),
        remainingMonths: 60,
        annualRateBps: 1800,
        method: "reducing_balance",
        amountPaise: L(1000),
        mode: "reduce_tenure",
      }),
    /never close/,
  );
});

/* ---------------- foreclosure ---------------- */

test("a foreclosure quote adds accrued interest and any charge", () => {
  const q = foreclosureQuote({
    outstandingPaise: L(200000),
    annualRateBps: 900,
    method: "reducing_balance",
    daysSinceLastInstalment: 20,
    foreclosureChargeBps: 200,
  });
  assert.ok(q.accruedInterestPaise > 0);
  assert.equal(q.chargePaise, L(4000));
  assert.equal(
    q.totalPaise,
    q.outstandingPaise + q.accruedInterestPaise + q.chargePaise,
  );
});

test("an interest-free loan accrues nothing on foreclosure", () => {
  const q = foreclosureQuote({
    outstandingPaise: L(200000),
    annualRateBps: 900,
    method: "interest_free",
    daysSinceLastInstalment: 20,
    foreclosureChargeBps: 0,
  });
  assert.equal(q.accruedInterestPaise, 0);
  assert.equal(q.totalPaise, L(200000));
});

/* ---------------- holds ---------------- */

test("a hold on an interest-bearing loan accrues interest and says so", () => {
  const r = applyHold({
    outstandingPaise: L(200000),
    instalmentPaise: L(10000),
    annualRateBps: 900,
    method: "reducing_balance",
    holdMonths: 3,
    waiveInterestDuringHold: false,
  });
  assert.ok(r.interestAccruedPaise > 0);
  assert.equal(r.outstandingAfterHoldPaise, L(200000) + r.interestAccruedPaise);
  assert.ok(r.warnings.some((w) => w.includes("Waive it explicitly")));
});

test("waiving interest during a hold leaves the balance untouched", () => {
  const r = applyHold({
    outstandingPaise: L(200000),
    instalmentPaise: L(10000),
    annualRateBps: 900,
    method: "reducing_balance",
    holdMonths: 3,
    waiveInterestDuringHold: true,
  });
  assert.equal(r.interestAccruedPaise, 0);
  assert.equal(r.outstandingAfterHoldPaise, L(200000));
  assert.equal(r.warnings.length, 0);
});

test("an interest-free loan on hold accrues nothing regardless", () => {
  const r = applyHold({
    outstandingPaise: L(200000),
    instalmentPaise: L(10000),
    annualRateBps: 900,
    method: "interest_free",
    holdMonths: 6,
    waiveInterestDuringHold: false,
  });
  assert.equal(r.interestAccruedPaise, 0);
});

/* ---------------- exit ---------------- */

test("the settlement clears what it can and names what it cannot", () => {
  const r = recoverAtExit({
    loans: [
      loan({ loanId: "big", label: "Personal", outstandingPaise: L(240000) }),
      loan({ loanId: "small", label: "Advance", outstandingPaise: L(20000) }),
    ],
    settlementPayablePaise: L(150000),
  });
  assert.equal(r.totalRecoveredPaise, L(150000));
  assert.equal(r.totalUnrecoveredPaise, L(110000));
  assert.equal(r.settlementAfterPaise, 0);
  assert.ok(r.warnings.some((w) => w.includes("pursued separately")));
});

test("a settlement that covers everything leaves a positive balance to pay out", () => {
  const r = recoverAtExit({
    loans: [loan({ outstandingPaise: L(40000) })],
    settlementPayablePaise: L(150000),
  });
  assert.equal(r.totalUnrecoveredPaise, 0);
  assert.equal(r.settlementAfterPaise, L(110000));
  assert.equal(r.warnings.length, 0);
});

test("a nil settlement recovers nothing and reports the whole balance", () => {
  const r = recoverAtExit({
    loans: [loan({ outstandingPaise: L(240000) })],
    settlementPayablePaise: 0,
  });
  assert.equal(r.totalRecoveredPaise, 0);
  assert.equal(r.totalUnrecoveredPaise, L(240000));
  assert.match(r.lines[0].note, /covers none/);
});

/* ---------------- perquisite feed ---------------- */

test("month-end balances run twelve months and fall to zero once repaid", () => {
  const schedule = buildSchedule({
    principalPaise: L(120000),
    annualRateBps: 0,
    tenureMonths: 6,
    method: "interest_free",
  });
  const balances = monthEndBalances({
    schedule,
    firstInstalmentFyMonth: 1,
    principalPaise: L(120000),
  });
  assert.equal(balances.length, 12);
  assert.equal(balances[0], L(100000), "one instalment repaid by the end of April");
  assert.equal(balances[5], 0, "cleared after six instalments");
  assert.equal(balances[11], 0);
});

test("months before the first instalment carry the full principal", () => {
  const schedule = buildSchedule({
    principalPaise: L(120000),
    annualRateBps: 0,
    tenureMonths: 6,
    method: "interest_free",
  });
  const balances = monthEndBalances({
    schedule,
    firstInstalmentFyMonth: 4,
    principalPaise: L(120000),
  });
  assert.equal(balances[0], L(120000));
  assert.equal(balances[2], L(120000));
  assert.equal(balances[3], L(100000), "recovery starts in the fourth month");
});
