import { test } from "node:test";
import assert from "node:assert/strict";
import {
  provideGratuity,
  provideLeaveEncashment,
  provideBonus,
  reconcilePayments,
  type GratuityInput,
  type LeaveLiabilityInput,
  type BonusInput,
  type BankResponseRow,
} from "./provisions";

const L = (rupees: number) => Math.round(rupees * 100);

/* ---------------- gratuity ---------------- */

const gratuityEmployee = (over: Partial<GratuityInput> = {}): GratuityInput => ({
  employeeId: "e1",
  empCode: "KA0001",
  monthlyBasicPaise: L(26000),
  completedMonths: 24,
  openingProvisionPaise: 0,
  qualifyingMonths: 60,
  ceilingPaise: L(2000000),
  ...over,
});

test("gratuity accrues at fifteen days of wages a year on a 26-day month", () => {
  const p = provideGratuity({
    employees: [gratuityEmployee()],
    attritionDiscountBps: 0,
  });
  // 26,000 x 15 / 26 = 15,000 a year, two years completed
  assert.equal(p.closingPaise, L(30000));
});

test("gratuity accrues before it vests, so a cohort does not land at once", () => {
  const p = provideGratuity({
    employees: [gratuityEmployee({ completedMonths: 12 })],
    attritionDiscountBps: 0,
  });
  assert.ok(p.closingPaise > 0, "a first-year employee still carries a liability");
  assert.match(p.lines[0].basis, /not yet vested/);
});

test("a vested employee's basis stops mentioning vesting", () => {
  const p = provideGratuity({
    employees: [gratuityEmployee({ completedMonths: 72 })],
    attritionDiscountBps: 0,
  });
  assert.ok(!p.lines[0].basis.includes("not yet vested"));
});

test("the statutory ceiling caps the provision", () => {
  const p = provideGratuity({
    employees: [
      gratuityEmployee({
        monthlyBasicPaise: L(400000),
        completedMonths: 240,
        ceilingPaise: L(2000000),
      }),
    ],
    attritionDiscountBps: 0,
  });
  assert.equal(p.closingPaise, L(2000000));
  assert.match(p.lines[0].basis, /capped at ₹2000000/);
});

test("an attrition discount reduces the provision proportionally", () => {
  const full = provideGratuity({
    employees: [gratuityEmployee()],
    attritionDiscountBps: 0,
  });
  const discounted = provideGratuity({
    employees: [gratuityEmployee()],
    attritionDiscountBps: 2000,
  });
  assert.equal(discounted.closingPaise, Math.round(full.closingPaise * 0.8));
});

test("an impossible discount is ignored rather than applied", () => {
  const p = provideGratuity({
    employees: [gratuityEmployee()],
    attritionDiscountBps: 15000,
  });
  assert.equal(p.closingPaise, L(30000), "computed as if undiscounted");
  assert.ok(p.warnings.some((w) => w.includes("between 0% and 100%")));
});

test("the charge is the movement, not the closing balance", () => {
  const p = provideGratuity({
    employees: [gratuityEmployee({ openingProvisionPaise: L(28000) })],
    attritionDiscountBps: 0,
  });
  assert.equal(p.closingPaise, L(30000));
  assert.equal(p.chargePaise, L(2000), "only the increase posts");
});

test("a falling liability is a release and says so", () => {
  const p = provideGratuity({
    employees: [gratuityEmployee({ openingProvisionPaise: L(50000) })],
    attritionDiscountBps: 0,
  });
  assert.equal(p.isRelease, true);
  assert.ok(p.chargePaise < 0);
  assert.ok(p.warnings.some((w) => w.includes("release, not a cost")));
});

/* ---------------- leave encashment ---------------- */

const leaveEmployee = (
  over: Partial<LeaveLiabilityInput> = {},
): LeaveLiabilityInput => ({
  employeeId: "e1",
  empCode: "KA0001",
  encashableDays: 18,
  perDayPaise: L(1500),
  openingProvisionPaise: 0,
  encashmentCapDays: null,
  ...over,
});

test("leave liability is days times the daily rate", () => {
  const p = provideLeaveEncashment([leaveEmployee()]);
  assert.equal(p.closingPaise, L(27000));
});

test("a policy cap limits the liability and explains itself", () => {
  const p = provideLeaveEncashment([
    leaveEmployee({ encashableDays: 45, encashmentCapDays: 30 }),
  ]);
  assert.equal(p.closingPaise, L(45000), "30 days, not 45");
  assert.match(p.lines[0].basis, /30 of 45 days provided/);
});

test("a balance under the cap is provided in full", () => {
  const p = provideLeaveEncashment([
    leaveEmployee({ encashableDays: 12, encashmentCapDays: 30 }),
  ]);
  assert.equal(p.closingPaise, L(18000));
  assert.match(p.lines[0].basis, /12 days at/);
});

test("half-day balances do not lose their fraction", () => {
  const p = provideLeaveEncashment([leaveEmployee({ encashableDays: 12.5 })]);
  assert.equal(p.closingPaise, L(18750));
});

/* ---------------- bonus ---------------- */

const bonusEmployee = (over: Partial<BonusInput> = {}): BonusInput => ({
  employeeId: "e1",
  empCode: "KA0001",
  declaredAnnualPaise: L(24000),
  monthsElapsed: 6,
  openingProvisionPaise: 0,
  ...over,
});

test("a declared bonus is spread evenly across the bonus year", () => {
  const p = provideBonus([bonusEmployee()]);
  assert.equal(p.closingPaise, L(12000), "half the year elapsed");
});

test("a full year provides the whole declared amount", () => {
  const p = provideBonus([bonusEmployee({ monthsElapsed: 12 })]);
  assert.equal(p.closingPaise, L(24000));
});

test("months beyond twelve do not over-provide", () => {
  const p = provideBonus([bonusEmployee({ monthsElapsed: 15 })]);
  assert.equal(p.closingPaise, L(24000));
});

test("nothing declared means nothing provided", () => {
  const p = provideBonus([bonusEmployee({ declaredAnnualPaise: 0 })]);
  assert.equal(p.closingPaise, 0);
  assert.equal(p.chargePaise, 0);
});

/* ---------------- payment reconciliation ---------------- */

const instructed = [
  { employeeId: "e1", empCode: "KA0001", accountNumber: "50100111", amountPaise: L(45000) },
  { employeeId: "e2", empCode: "KA0002", accountNumber: "50100222", amountPaise: L(32000) },
];

const response = (over: Partial<BankResponseRow> = {}): BankResponseRow => ({
  reference: "REF1",
  accountNumber: "50100111",
  amountPaise: L(45000),
  status: "paid",
  reason: null,
  ...over,
});

test("a matched payment is marked paid and not held", () => {
  const r = reconcilePayments({
    instructed: [instructed[0]],
    responses: [response()],
  });
  assert.equal(r.payments[0].status, "paid");
  assert.equal(r.payments[0].heldAsLiability, false);
  assert.equal(r.paidPaise, L(45000));
});

test("a failed payment stays a liability and is re-queued", () => {
  const r = reconcilePayments({
    instructed: [instructed[0]],
    responses: [
      response({ status: "failed", reason: "Account closed" }),
    ],
  });
  const p = r.payments[0];
  assert.equal(p.status, "failed");
  assert.equal(p.heldAsLiability, true);
  assert.equal(p.requeue, true);
  assert.equal(p.reason, "Account closed");
  assert.equal(r.failedPaise, L(45000));
  assert.ok(r.warnings.some((w) => w.includes("re-queued into the next run")));
});

test("a returned payment is treated the same as a failure", () => {
  const r = reconcilePayments({
    instructed: [instructed[0]],
    responses: [response({ status: "returned", reason: "Name mismatch" })],
  });
  assert.equal(r.payments[0].requeue, true);
  assert.equal(r.payments[0].heldAsLiability, true);
});

test("a failure with no reason is flagged as unactionable", () => {
  const r = reconcilePayments({
    instructed: [instructed[0]],
    responses: [response({ status: "failed", reason: null })],
  });
  assert.ok(
    r.payments[0].warnings.some((w) => w.includes("cannot be corrected")),
  );
});

test("an instruction the bank never reported stays pending and owed", () => {
  const r = reconcilePayments({ instructed, responses: [response()] });
  const pending = r.payments.find((p) => p.empCode === "KA0002")!;
  assert.equal(pending.status, "pending");
  assert.equal(pending.heldAsLiability, true);
  assert.equal(pending.requeue, false, "pending is not the same as failed");
  assert.equal(r.pendingPaise, L(32000));
});

test("a bank paying a different amount is a discrepancy, not a rounding", () => {
  const r = reconcilePayments({
    instructed: [instructed[0]],
    responses: [response({ amountPaise: L(44000) })],
  });
  assert.ok(
    r.payments[0].warnings.some((w) => w.includes("against an instruction of")),
  );
});

test("a response matching no instruction is surfaced, not ignored", () => {
  const r = reconcilePayments({
    instructed: [instructed[0]],
    responses: [response(), response({ accountNumber: "99999999" })],
  });
  assert.equal(r.unmatchedResponses.length, 1);
  assert.ok(
    r.warnings.some((w) => w.includes("belongs to this run")),
  );
});

test("two instructions to the same account each consume one response", () => {
  // A split payee can have two lines on the same account number.
  const r = reconcilePayments({
    instructed: [
      { employeeId: "e1", empCode: "KA0001", accountNumber: "50100111", amountPaise: L(10000) },
      { employeeId: "e1", empCode: "KA0001", accountNumber: "50100111", amountPaise: L(35000) },
    ],
    responses: [
      response({ amountPaise: L(10000) }),
      response({ amountPaise: L(35000) }),
    ],
  });
  assert.equal(r.payments.filter((p) => p.status === "paid").length, 2);
  assert.equal(r.unmatchedResponses.length, 0);
});

test("totals split cleanly across paid, failed and pending", () => {
  const r = reconcilePayments({
    instructed: [
      ...instructed,
      { employeeId: "e3", empCode: "KA0003", accountNumber: "50100333", amountPaise: L(20000) },
    ],
    responses: [
      response(),
      response({ accountNumber: "50100222", amountPaise: L(32000), status: "failed", reason: "Closed" }),
    ],
  });
  assert.equal(r.paidPaise, L(45000));
  assert.equal(r.failedPaise, L(32000));
  assert.equal(r.pendingPaise, L(20000));
});
