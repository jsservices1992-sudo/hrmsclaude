import test from "node:test";
import assert from "node:assert/strict";
import {
  detectExceptions,
  criticalsOf,
  blockingSummary,
  type ExceptionInput,
  type RunContext,
} from "./exceptions";

const ctx: RunContext = {
  year: 2026,
  month: 9,
  attendanceFinalised: true,
  statutoryConfigured: true,
};

function row(p: Partial<ExceptionInput> = {}): ExceptionInput {
  return {
    employeeId: "e1",
    empCode: "KA0001",
    name: "Aarav",
    paidDays: 30,
    totalDays: 30,
    lopDays: 0,
    netPaise: 30_000_00,
    grossPaise: 35_000_00,
    hasSalaryStructure: true,
    bankAccount: "123456",
    ifsc: "HDFC0000123",
    uan: "100000000001",
    esicIp: null,
    pfApplicable: true,
    esicApplicable: false,
    dateOfJoining: "2024-01-01",
    dateOfExit: null,
    salaryChangedInPeriod: false,
    engineWarnings: [],
    ...p,
  };
}

test("a clean row raises nothing", () => {
  assert.deepEqual(detectExceptions([row()], ctx), []);
});

test("no salary on record blocks approval", () => {
  const found = detectExceptions([row({ hasSalaryStructure: false })], ctx);
  const e = found.find((x) => x.code === "missing_salary_structure")!;
  assert.equal(e.severity, "critical");
  assert.equal(e.empCode, "KA0001");
});

test("missing bank details block, because the payment would simply fail", () => {
  const noAccount = detectExceptions([row({ bankAccount: null })], ctx);
  assert.equal(noAccount.find((x) => x.code === "missing_bank_details")?.severity, "critical");

  const noIfsc = detectExceptions([row({ ifsc: "   " })], ctx);
  assert.equal(noIfsc.find((x) => x.code === "missing_bank_details")?.severity, "critical");
});

test("missing bank details are not raised when there is nothing to pay", () => {
  // Fully unpaid month: no disbursement, so no account needed.
  const found = detectExceptions([row({ netPaise: 0, bankAccount: null, ifsc: null })], ctx);
  assert.equal(found.some((x) => x.code === "missing_bank_details"), false);
});

test("negative net blocks", () => {
  const found = detectExceptions([row({ netPaise: -500_00 })], ctx);
  assert.equal(found.find((x) => x.code === "negative_net")?.severity, "critical");
});

test("a missing UAN warns where PF applies, and is silent where it does not", () => {
  const applies = detectExceptions([row({ uan: null, pfApplicable: true })], ctx);
  assert.equal(applies.find((x) => x.code === "missing_uan")?.severity, "warning");

  const doesNot = detectExceptions([row({ uan: null, pfApplicable: false })], ctx);
  assert.equal(doesNot.some((x) => x.code === "missing_uan"), false);
});

test("a missing ESIC number warns only where ESIC applies", () => {
  const applies = detectExceptions([row({ esicApplicable: true, esicIp: null })], ctx);
  assert.equal(applies.some((x) => x.code === "missing_esic_id"), true);
  const doesNot = detectExceptions([row({ esicApplicable: false, esicIp: null })], ctx);
  assert.equal(doesNot.some((x) => x.code === "missing_esic_id"), false);
});

test("excessive loss of pay warns, but a normal amount does not", () => {
  assert.equal(
    detectExceptions([row({ lopDays: 20, paidDays: 10 })], ctx).some((x) => x.code === "excessive_lop"),
    true,
  );
  assert.equal(
    detectExceptions([row({ lopDays: 2, paidDays: 28 })], ctx).some((x) => x.code === "excessive_lop"),
    false,
  );
});

test("joiners and leavers inside the period are flagged for a look", () => {
  const joiner = detectExceptions([row({ dateOfJoining: "2026-09-15" })], ctx);
  assert.equal(joiner.find((x) => x.code === "new_joiner")?.severity, "warning");

  const leaver = detectExceptions([row({ dateOfExit: "2026-09-20" })], ctx);
  assert.equal(leaver.find((x) => x.code === "exit_in_period")?.severity, "warning");

  // A joiner from a previous period is not news.
  const old = detectExceptions([row({ dateOfJoining: "2024-01-01" })], ctx);
  assert.equal(old.some((x) => x.code === "new_joiner"), false);
});

test("run-wide problems are reported once, not per employee", () => {
  const found = detectExceptions([row(), row({ employeeId: "e2" })], {
    ...ctx,
    statutoryConfigured: false,
    attendanceFinalised: false,
  });
  assert.equal(found.filter((x) => x.code === "missing_statutory_config").length, 1);
  assert.equal(found.filter((x) => x.code === "attendance_not_finalised").length, 1);
  assert.equal(found.find((x) => x.code === "missing_statutory_config")?.severity, "critical");
  assert.equal(found.find((x) => x.code === "attendance_not_finalised")?.severity, "warning");
});

test("criticals sort ahead of warnings", () => {
  const found = detectExceptions(
    [row({ dateOfJoining: "2026-09-02", bankAccount: null })],
    ctx,
  );
  assert.equal(found[0].severity, "critical");
});

test("the blocking summary counts by kind, and is null when nothing blocks", () => {
  assert.equal(blockingSummary(detectExceptions([row()], ctx)), null);

  const found = detectExceptions(
    [row({ bankAccount: null }), row({ employeeId: "e2", empCode: "KA0002", bankAccount: null })],
    ctx,
  );
  assert.equal(criticalsOf(found).length, 2);
  assert.match(blockingSummary(found)!, /2 blocking issue\(s\).*2 × no bank details/);
});

test("an engine warning about recovery is typed as a shortfall, not swallowed", () => {
  const found = detectExceptions(
    [row({ engineWarnings: ["₹500 could not be recovered without breaching the net pay floor"] })],
    ctx,
  );
  assert.equal(found.find((x) => x.code === "loan_recovery_shortfall")?.severity, "warning");
});
