import test, { describe } from "node:test";
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
    monthlyGrossPaise: 35_000_00,
    monthlyBasicPaise: 17_500_00,
    minimumWagePaise: null,
    minimumWageUnknown: null,
    bonusShortfallPaise: null,
    bonusEntitlementPaise: null,
    wageCodeShortfallPaise: null,
    wageCodeShare: null,
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

describe("Minimum wage", () => {
  const floor = { minimumWagePaise: 20_000_00 };

  test("pay below the floor blocks the run", () => {
    const found = detectExceptions(
      [row({ ...floor, monthlyGrossPaise: 19_999_00 })],
      ctx,
    );
    const hit = found.find((e) => e.code === "below_minimum_wage");
    assert.ok(hit, "expected a minimum wage exception");
    assert.equal(hit.severity, "critical", "it must stop approval, not merely warn");
    assert.match(hit.message, /₹19,999.00/);
    assert.match(hit.message, /₹20,000.00/);
  });

  test("pay exactly at the floor is compliant", () => {
    const found = detectExceptions(
      [row({ ...floor, monthlyGrossPaise: 20_000_00, monthlyBasicPaise: 20_000_00 })],
      ctx,
    );
    assert.equal(found.length, 0);
  });

  test("the floor is tested on the contracted rate, not what a part month paid", () => {
    /* Half the month unpaid: the rate still clears the floor, and
       reporting this person as underpaid would bury the real cases. */
    const found = detectExceptions(
      [row({ ...floor, monthlyGrossPaise: 22_000_00, grossPaise: 11_000_00, lopDays: 15, paidDays: 15 })],
      ctx,
    );
    assert.equal(found.filter((e) => e.code === "below_minimum_wage").length, 0);
  });

  test("basic under the floor is raised, but does not block", () => {
    const found = detectExceptions(
      [row({ ...floor, monthlyGrossPaise: 30_000_00, monthlyBasicPaise: 15_000_00 })],
      ctx,
    );
    const hit = found.find((e) => e.code === "basic_below_minimum_wage");
    assert.ok(hit);
    assert.equal(hit.severity, "warning", "an interpretation is for a human, not a gate");
  });

  test("a prorated month says nothing about basic rather than guessing", () => {
    const found = detectExceptions(
      [row({ ...floor, monthlyGrossPaise: 30_000_00, monthlyBasicPaise: null, lopDays: 3, paidDays: 27 })],
      ctx,
    );
    assert.equal(found.filter((e) => e.code === "basic_below_minimum_wage").length, 0);
  });

  test("being unable to check is reported, not skipped in silence", () => {
    const found = detectExceptions(
      [row({ minimumWagePaise: null, minimumWageUnknown: "No skill category on this person." })],
      ctx,
    );
    const hit = found.find((e) => e.code === "minimum_wage_unverifiable");
    assert.ok(hit, "silence is what let an unchecked salary go out");
    assert.equal(hit.severity, "warning");
    assert.match(hit.message, /skill category/i);
  });

  test("the worst case is reported once, not twice", () => {
    /* Gross below the floor implies basic is too — one clear message. */
    const found = detectExceptions(
      [row({ ...floor, monthlyGrossPaise: 10_000_00, monthlyBasicPaise: 5_000_00 })],
      ctx,
    );
    assert.equal(found.filter((e) => e.code.includes("minimum_wage")).length, 1);
  });
});

describe("Statutory bonus on a run", () => {
  test("a shortfall is raised against the person, and does not block", () => {
    const found = detectExceptions(
      [row({ bonusEntitlementPaise: 583_10, bonusShortfallPaise: 483_10 })],
      ctx,
    );
    const hit = found.find((e) => e.code === "statutory_bonus_short");
    assert.ok(hit);
    assert.equal(hit.severity, "warning", "an annual liability is not a reason to stop a month");
    assert.match(hit.message, /₹583.10/);
    assert.match(hit.message, /₹100.00/, "says what is already paid");
    assert.match(hit.message, /₹483.10/);
  });

  test("a structure already paying enough raises nothing", () => {
    const found = detectExceptions(
      [row({ bonusEntitlementPaise: 583_10, bonusShortfallPaise: 0 })],
      ctx,
    );
    assert.equal(found.length, 0);
  });

  test("an unassessable company is told once, not once per employee", () => {
    const found = detectExceptions(
      [row(), row({ employeeId: "e2", empCode: "KA0002" })],
      { ...ctx, bonusUnassessable: "No pay component is marked as paying the statutory bonus." },
    );
    assert.equal(found.filter((e) => e.code === "statutory_bonus_unassessable").length, 1);
    assert.equal(found[0].employeeId, undefined, "it is the company's answer, not a person's");
  });
});

describe("Code on Wages split on a run", () => {
  test("wages under half are raised, and do not block", () => {
    const found = detectExceptions(
      [row({ wageCodeShare: 0.4, wageCodeShortfallPaise: 2_000_00 })],
      ctx,
    );
    const hit = found.find((e) => e.code === "wage_code_below_share");
    assert.ok(hit);
    assert.equal(hit.severity, "warning", "stage one reports; it does not correct");
    assert.match(hit.message, /40.0%/);
    assert.match(hit.message, /₹2,000.00/);
    assert.match(hit.message, /PF and ESI are already charged on the Code.s wage/, "says PF and ESI already use the Code wage");
    assert.match(hit.message, /gratuity and bonus/, "says what else would move");
  });

  test("a compliant split raises nothing", () => {
    const found = detectExceptions(
      [row({ wageCodeShare: 0.5, wageCodeShortfallPaise: 0 })],
      ctx,
    );
    assert.equal(found.length, 0);
  });

  test("a month with nothing to judge is left alone", () => {
    const found = detectExceptions([row({ wageCodeShortfallPaise: null })], ctx);
    assert.equal(found.filter((e) => e.code === "wage_code_below_share").length, 0);
  });
});
