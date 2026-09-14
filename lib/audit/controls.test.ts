import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkRunApproval,
  checkSalaryApproval,
  detectAlerts,
  canErase,
  DEFAULT_SOD,
  DEFAULT_THRESHOLDS,
  RETENTION_RULES,
  type ChangeEvent,
  type LegalHold,
} from "./controls";

const L = (rupees: number) => Math.round(rupees * 100);

/* ---------------- segregation of duties ---------------- */

const approvalArgs = {
  approver: "checker@example.com",
  preparedBy: "maker@example.com",
  policies: DEFAULT_SOD,
  bankChanges: [],
  approvalAt: "2026-09-25T10:00:00.000Z",
};

test("a different approver is allowed", () => {
  const d = checkRunApproval(approvalArgs);
  assert.equal(d.allowed, true);
  assert.equal(d.logAs, null);
});

test("the preparer cannot approve their own run", () => {
  const d = checkRunApproval({ ...approvalArgs, approver: "maker@example.com" });
  assert.equal(d.allowed, false);
  assert.equal(d.rule, "preparer_cannot_approve");
  assert.equal(d.logAs, "run.approve.denied", "a blocked attempt is itself logged");
});

test("disabling a policy lets the preparer approve", () => {
  const d = checkRunApproval({
    ...approvalArgs,
    approver: "maker@example.com",
    policies: [{ rule: "preparer_cannot_approve", enabled: false }],
  });
  assert.equal(d.allowed, true);
});

test("someone who changed bank details cannot approve the run paying into them", () => {
  const d = checkRunApproval({
    ...approvalArgs,
    bankChanges: [
      {
        actor: "checker@example.com",
        at: "2026-09-22T09:00:00.000Z",
        employeeId: "e1",
      },
    ],
  });
  assert.equal(d.allowed, false);
  assert.equal(d.rule, "bank_changer_cannot_approve");
  assert.match(d.reason, /within the last 7 days/);
});

test("a bank change outside the cooling window does not block", () => {
  const d = checkRunApproval({
    ...approvalArgs,
    bankChanges: [
      {
        actor: "checker@example.com",
        at: "2026-09-01T09:00:00.000Z",
        employeeId: "e1",
      },
    ],
  });
  assert.equal(d.allowed, true);
});

test("someone else's bank change does not block this approver", () => {
  const d = checkRunApproval({
    ...approvalArgs,
    bankChanges: [
      { actor: "hr@example.com", at: "2026-09-24T09:00:00.000Z", employeeId: "e1" },
    ],
  });
  assert.equal(d.allowed, true);
});

test("the cooling window is configurable", () => {
  const policies = [
    { rule: "bank_changer_cannot_approve" as const, enabled: true, coolingDays: 1 },
  ];
  const d = checkRunApproval({
    ...approvalArgs,
    policies,
    bankChanges: [
      {
        actor: "checker@example.com",
        at: "2026-09-22T09:00:00.000Z",
        employeeId: "e1",
      },
    ],
  });
  assert.equal(d.allowed, true, "three days ago is outside a one-day window");
});

test("the creator of an employee cannot approve their salary", () => {
  const d = checkSalaryApproval({
    approver: "hr@example.com",
    employeeCreatedBy: "hr@example.com",
    policies: DEFAULT_SOD,
  });
  assert.equal(d.allowed, false);
  assert.match(d.reason, /classic payroll fraud/);
  assert.equal(d.logAs, "salary.approve.denied");
});

test("an unknown creator does not block, since there is nothing to compare", () => {
  const d = checkSalaryApproval({
    approver: "hr@example.com",
    employeeCreatedBy: null,
    policies: DEFAULT_SOD,
  });
  assert.equal(d.allowed, true);
});

/* ---------------- alerting ---------------- */

const event = (over: Partial<ChangeEvent> = {}): ChangeEvent => ({
  action: "employee.updated",
  actor: "hr@example.com",
  at: "2026-09-25T10:00:00.000Z",
  entity: "employee",
  entityId: "e1",
  source: "interface",
  before: null,
  after: null,
  ...over,
});

test("a bank change close to disbursement is a high alert", () => {
  const alerts = detectAlerts({
    events: [event({ action: "employee.bank_changed", at: "2026-09-26T10:00:00.000Z" })],
    thresholds: DEFAULT_THRESHOLDS,
    disbursementDate: "2026-09-28T00:00:00.000Z",
  });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, "bank_change_near_disbursement");
  assert.equal(alerts[0].severity, "high");
  assert.match(alerts[0].detail, /payroll diversion/);
});

test("a bank change well before disbursement raises nothing", () => {
  const alerts = detectAlerts({
    events: [event({ action: "employee.bank_changed", at: "2026-09-01T10:00:00.000Z" })],
    thresholds: DEFAULT_THRESHOLDS,
    disbursementDate: "2026-09-28T00:00:00.000Z",
  });
  assert.equal(alerts.length, 0);
});

test("a bank change after disbursement is not a pre-payment risk", () => {
  const alerts = detectAlerts({
    events: [event({ action: "employee.bank_changed", at: "2026-09-30T10:00:00.000Z" })],
    thresholds: DEFAULT_THRESHOLDS,
    disbursementDate: "2026-09-28T00:00:00.000Z",
  });
  assert.equal(alerts.length, 0);
});

test("with no disbursement date a bank change cannot be judged for proximity", () => {
  const alerts = detectAlerts({
    events: [event({ action: "employee.bank_changed" })],
    thresholds: DEFAULT_THRESHOLDS,
    disbursementDate: null,
  });
  assert.equal(alerts.length, 0);
});

test("a large salary revision alerts with the percentage", () => {
  const alerts = detectAlerts({
    events: [
      event({
        action: "salary.revised",
        before: { monthlyGrossPaise: L(40000) },
        after: { monthlyGrossPaise: L(60000) },
      }),
    ],
    thresholds: DEFAULT_THRESHOLDS,
    disbursementDate: null,
  });
  assert.equal(alerts[0].kind, "large_salary_revision");
  assert.match(alerts[0].title, /50.0%/);
});

test("an ordinary increment stays below the threshold", () => {
  const alerts = detectAlerts({
    events: [
      event({
        action: "salary.revised",
        before: { monthlyGrossPaise: L(40000) },
        after: { monthlyGrossPaise: L(44000) },
      }),
    ],
    thresholds: DEFAULT_THRESHOLDS,
    disbursementDate: null,
  });
  assert.equal(alerts.length, 0);
});

test("a large salary cut alerts too, not only a rise", () => {
  const alerts = detectAlerts({
    events: [
      event({
        action: "salary.revised",
        before: { monthlyGrossPaise: L(60000) },
        after: { monthlyGrossPaise: L(30000) },
      }),
    ],
    thresholds: DEFAULT_THRESHOLDS,
    disbursementDate: null,
  });
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].title, /-50.0%/);
});

test("reopening an approved run alerts", () => {
  const alerts = detectAlerts({
    events: [event({ action: "run.reopened", entity: "payroll_run" })],
    thresholds: DEFAULT_THRESHOLDS,
    disbursementDate: null,
  });
  assert.equal(alerts[0].kind, "run_unlocked_after_approval");
});

test("editing statutory configuration alerts at medium", () => {
  const alerts = detectAlerts({
    events: [event({ action: "pt_slab.updated", entity: "pt_slab" })],
    thresholds: DEFAULT_THRESHOLDS,
    disbursementDate: null,
  });
  assert.equal(alerts[0].kind, "statutory_config_edited");
  assert.equal(alerts[0].severity, "medium");
});

test("a large import alerts, a small one does not", () => {
  const big = detectAlerts({
    events: [event({ source: "import", affectedCount: 200 })],
    thresholds: DEFAULT_THRESHOLDS,
    disbursementDate: null,
  });
  assert.equal(big[0].kind, "large_bulk_import");

  const small = detectAlerts({
    events: [event({ source: "import", affectedCount: 3 })],
    thresholds: DEFAULT_THRESHOLDS,
    disbursementDate: null,
  });
  assert.equal(small.length, 0);
});

test("a compensation change through the API always alerts", () => {
  const alerts = detectAlerts({
    events: [
      event({ action: "salary.revised", entity: "employee_salary", source: "api" }),
    ],
    thresholds: DEFAULT_THRESHOLDS,
    disbursementDate: null,
  });
  assert.ok(alerts.some((a) => a.kind === "api_compensation_change"));
});

test("the same change through the interface does not raise the API alert", () => {
  const alerts = detectAlerts({
    events: [
      event({ action: "salary.revised", entity: "employee_salary", source: "interface" }),
    ],
    thresholds: DEFAULT_THRESHOLDS,
    disbursementDate: null,
  });
  assert.ok(!alerts.some((a) => a.kind === "api_compensation_change"));
});

test("high-severity alerts sort above medium", () => {
  const alerts = detectAlerts({
    events: [
      event({ action: "pt_slab.updated", entity: "pt_slab" }),
      event({ action: "run.reopened", entity: "payroll_run" }),
    ],
    thresholds: DEFAULT_THRESHOLDS,
    disbursementDate: null,
  });
  assert.equal(alerts[0].severity, "high");
  assert.equal(alerts[1].severity, "medium");
});

/* ---------------- retention & legal hold ---------------- */

const hold = (over: Partial<LegalHold> = {}): LegalHold => ({
  id: "h1",
  employeeId: null,
  periodYear: null,
  reason: "Employment tribunal claim",
  placedBy: "legal@example.com",
  placedAt: "2026-01-01T00:00:00.000Z",
  releasedAt: null,
  ...over,
});

test("a payroll register cannot be erased inside its retention period", () => {
  const d = canErase({
    recordClass: "payroll_register",
    recordYear: 2024,
    today: "2026-09-25",
    holds: [],
    employeeId: "e1",
  });
  assert.equal(d.allowed, false);
  assert.equal(d.blockedBy, "retention");
  assert.match(d.reason, /cannot override a statutory retention obligation/);
  assert.equal(d.eligibleAfter, "2033-03-31");
});

test("the same record becomes erasable once the period has run", () => {
  const d = canErase({
    recordClass: "payroll_register",
    recordYear: 2010,
    today: "2026-09-25",
    holds: [],
    employeeId: "e1",
  });
  assert.equal(d.allowed, true);
  assert.equal(d.blockedBy, null);
});

test("candidate data carries no obligation and can be erased", () => {
  const d = canErase({
    recordClass: "candidate_data",
    recordYear: 2026,
    today: "2026-09-25",
    holds: [],
    employeeId: "c1",
  });
  assert.equal(d.allowed, true);
  assert.match(d.reason, /no statutory retention obligation/);
});

test("a legal hold overrides even an erasable class", () => {
  const d = canErase({
    recordClass: "candidate_data",
    recordYear: 2026,
    today: "2026-09-25",
    holds: [hold()],
    employeeId: "c1",
  });
  assert.equal(d.allowed, false);
  assert.equal(d.blockedBy, "legal_hold");
  assert.match(d.reason, /Employment tribunal claim/);
});

test("a hold scoped to one employee does not block another", () => {
  const d = canErase({
    recordClass: "candidate_data",
    recordYear: 2026,
    today: "2026-09-25",
    holds: [hold({ employeeId: "someone_else" })],
    employeeId: "c1",
  });
  assert.equal(d.allowed, true);
});

test("a hold scoped to one year does not block another year", () => {
  const d = canErase({
    recordClass: "candidate_data",
    recordYear: 2026,
    today: "2026-09-25",
    holds: [hold({ periodYear: 2020 })],
    employeeId: "c1",
  });
  assert.equal(d.allowed, true);
});

test("a released hold stops blocking", () => {
  const d = canErase({
    recordClass: "candidate_data",
    recordYear: 2026,
    today: "2026-09-25",
    holds: [hold({ releasedAt: "2026-06-01T00:00:00.000Z" })],
    employeeId: "c1",
  });
  assert.equal(d.allowed, true);
});

test("an unknown record class is refused rather than guessed at", () => {
  const d = canErase({
    recordClass: "something_new" as never,
    recordYear: 2020,
    today: "2026-09-25",
    holds: [],
    employeeId: "e1",
  });
  assert.equal(d.allowed, false);
  assert.match(d.reason, /refused rather than guessed/);
});

test("every retention rule states the basis it rests on", () => {
  for (const rule of RETENTION_RULES) {
    assert.ok(rule.basis.length > 10, `${rule.recordClass} has no stated basis`);
    assert.ok(rule.retainYears > 0);
  }
});
