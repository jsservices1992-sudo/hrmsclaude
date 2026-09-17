import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeGratuity, computeLeaveEncashment, serviceYears, completedYears } from "./gratuity";
import { computeSettlement, type SettlementInput } from "./settlement";
import {
  computeNotice,
  resolveNoticeDays,
  valueNotice,
  daysBetween,
} from "../exit/notice";

const R = (rupees: number) => Math.round(rupees * 100);

/* ==================== Gratuity ==================== */

describe("Gratuity", () => {
  test("not payable below the five-year qualifying period", () => {
    const g = computeGratuity({
      dateOfJoining: "2022-04-01",
      lastWorkingDay: "2026-03-31",
      lastDrawnWagePaise: R(50000),
      exitType: "resignation",
    });
    assert.equal(g.eligible, false);
    assert.match(g.reason, /qualifying period/);
  });

  test("15/26 formula on completed years", () => {
    // Exactly 6 years, ₹52,000 basic.
    const g = computeGratuity({
      dateOfJoining: "2020-04-01",
      lastWorkingDay: "2026-04-01",
      lastDrawnWagePaise: R(52000),
      exitType: "resignation",
    });
    assert.equal(g.eligible, true);
    assert.equal(g.countedYears, 6);
    // 52000 * 15 / 26 = 30000 per year → 180000
    assert.equal(g.cappedPaise, R(180000));
  });

  test("part year of six months or more rounds up", () => {
    const g = computeGratuity({
      dateOfJoining: "2019-01-01",
      lastWorkingDay: "2026-08-01", // ~7.58 years
      lastDrawnWagePaise: R(26000),
      exitType: "resignation",
    });
    assert.equal(g.countedYears, 8, "7.58 years counts as 8");
  });

  test("part year below six months rounds down", () => {
    const g = computeGratuity({
      dateOfJoining: "2019-01-01",
      lastWorkingDay: "2026-03-01", // ~7.16 years
      lastDrawnWagePaise: R(26000),
      exitType: "resignation",
    });
    assert.equal(g.countedYears, 7);
  });

  test("qualifying period is waived on death in service", () => {
    const g = computeGratuity({
      dateOfJoining: "2024-01-01",
      lastWorkingDay: "2026-01-01", // only 2 years
      lastDrawnWagePaise: R(52000),
      exitType: "death_in_service",
    });
    assert.equal(g.eligible, true);
    assert.match(g.reason, /waived on death/i);
  });

  test("caps at the statutory ceiling", () => {
    const g = computeGratuity({
      dateOfJoining: "1990-01-01",
      lastWorkingDay: "2026-01-01",
      lastDrawnWagePaise: R(500000),
      exitType: "retirement",
    });
    assert.equal(g.cappedPaise, R(2000000), "capped at ₹20,00,000");
    assert.ok(g.grossPaise > g.cappedPaise);
    assert.equal(g.taxablePaise, 0, "fully exempt up to the ceiling");
  });

  test("forfeiture must be explicit and carries a reason", () => {
    const g = computeGratuity({
      dateOfJoining: "2010-01-01",
      lastWorkingDay: "2026-01-01",
      lastDrawnWagePaise: R(50000),
      exitType: "termination_cause",
      forfeited: true,
      forfeitureReason: "Proven misconduct causing loss",
    });
    assert.equal(g.eligible, false);
    assert.match(g.reason, /Proven misconduct/);
  });

  test("termination for cause alone does not forfeit by default", () => {
    const g = computeGratuity({
      dateOfJoining: "2010-01-01",
      lastWorkingDay: "2026-01-01",
      lastDrawnWagePaise: R(50000),
      exitType: "termination_cause",
    });
    assert.equal(g.eligible, true, "forfeiture is a decision, not a default");
  });

  test("service years", () => {
    assert.ok(Math.abs(serviceYears("2020-01-01", "2026-01-01") - 6) < 0.02);
    assert.equal(serviceYears("2026-01-01", "2020-01-01"), 0);
  });
});

/* ==================== Leave encashment ==================== */

describe("Leave encashment", () => {
  test("exempt on separation under 10(10AA)", () => {
    const l = computeLeaveEncashment({
      balanceDays: 30,
      perDayPaise: R(2000),
      exitType: "resignation",
      isSeparation: true,
    });
    assert.equal(l.grossPaise, R(60000));
    assert.equal(l.exemptPaise, R(60000));
    assert.equal(l.taxablePaise, 0);
  });

  test("fully taxable when encashed in service", () => {
    const l = computeLeaveEncashment({
      balanceDays: 10,
      perDayPaise: R(2000),
      exitType: "resignation",
      isSeparation: false,
    });
    assert.equal(l.taxablePaise, R(20000));
    assert.equal(l.exemptPaise, 0);
  });

  test("exemption is capped", () => {
    const l = computeLeaveEncashment({
      balanceDays: 400,
      perDayPaise: R(10000),
      exitType: "retirement",
      isSeparation: true,
      exemptionCeilingPaise: R(2500000),
    });
    assert.equal(l.grossPaise, R(4000000));
    assert.equal(l.exemptPaise, R(2500000));
    assert.equal(l.taxablePaise, R(1500000));
  });
});

/* ==================== Notice ==================== */

describe("Notice period", () => {
  test("precedence: override beats grade beats type beats default", () => {
    assert.equal(
      resolveNoticeDays({
        employeeOverrideDays: 45,
        gradeDays: 60,
        employmentTypeDays: 30,
        companyDefaultDays: 90,
      }).days,
      45,
    );
    assert.equal(
      resolveNoticeDays({
        gradeDays: 60,
        employmentTypeDays: 30,
        companyDefaultDays: 90,
      }).days,
      60,
    );
    assert.equal(
      resolveNoticeDays({ employmentTypeDays: 30, companyDefaultDays: 90 }).days,
      30,
    );
    assert.equal(resolveNoticeDays({ companyDefaultDays: 90 }).source, "company default");
  });

  test("computes the earliest permissible last working day", () => {
    const n = computeNotice({
      resignationDate: "2026-09-01",
      agreedLastWorkingDay: "2026-11-30",
      requiredDays: 90,
      source: "grade",
      leaveExtendsNotice: false,
    });
    assert.equal(n.earliestLastWorkingDay, "2026-11-30");
    assert.equal(n.shortfallDays, 0);
  });

  test("detects a shortfall", () => {
    const n = computeNotice({
      resignationDate: "2026-09-01",
      agreedLastWorkingDay: "2026-10-01",
      requiredDays: 60,
      source: "grade",
      leaveExtendsNotice: false,
    });
    assert.equal(n.shortfallDays, 30);
  });

  test("leave during notice extends the date only when policy says so", () => {
    const base = {
      resignationDate: "2026-09-01",
      agreedLastWorkingDay: "2026-10-31",
      requiredDays: 60,
      source: "grade",
      leaveDaysDuringNotice: 10,
    };
    const without = computeNotice({ ...base, leaveExtendsNotice: false });
    assert.equal(without.shortfallDays, 0);
    assert.equal(without.extendedByLeaveDays, 0);

    const with_ = computeNotice({ ...base, leaveExtendsNotice: true });
    assert.equal(with_.extendedByLeaveDays, 10);
    assert.equal(with_.shortfallDays, 10, "leave pushes the date out by 10 days");
  });

  test("values a shortfall as a recovery", () => {
    const v = valueNotice({
      shortfallDays: 15,
      perDayPaise: R(3000),
      exitType: "resignation",
      waived: false,
    });
    assert.equal(v.kind, "recovery");
    assert.equal(v.amountPaise, R(45000));
  });

  test("waiver zeroes the recovery", () => {
    const v = valueNotice({
      shortfallDays: 15,
      perDayPaise: R(3000),
      exitType: "resignation",
      waived: true,
    });
    assert.equal(v.kind, "waived");
    assert.equal(v.amountPaise, 0);
  });

  test("employer paying in lieu is a payout, not a recovery", () => {
    const v = valueNotice({
      shortfallDays: 30,
      perDayPaise: R(3000),
      exitType: "termination",
      waived: false,
      employerPaysInLieu: true,
    });
    assert.equal(v.kind, "payout");
    assert.equal(v.amountPaise, R(90000));
  });

  test("no notice recovery on death in service", () => {
    const v = valueNotice({
      shortfallDays: 60,
      perDayPaise: R(3000),
      exitType: "death_in_service",
      waived: false,
    });
    assert.equal(v.kind, "none");
    assert.equal(v.amountPaise, 0);
  });

  test("daysBetween", () => {
    assert.equal(daysBetween("2026-09-01", "2026-09-30"), 29);
    assert.equal(daysBetween("2026-09-30", "2026-09-01"), -29);
  });
});

/* ==================== Full settlement ==================== */

function baseInput(over: Partial<SettlementInput> = {}): SettlementInput {
  return {
    employeeId: "emp_1",
    name: "Test Employee",
    exitType: "resignation",
    dateOfJoining: "2018-04-01",
    lastWorkingDay: "2026-09-30",
    resignationDate: "2026-07-01",
    finalMonthSalaryPaise: R(80000),
    finalMonthBasis: "30/30 calendar days",
    finalMonthDeductionsPaise: R(2000),
    monthlyBasicPaise: R(40000),
    perDayPaise: R(2667),
    leaveBalanceDays: 18,
    companyDefaultNoticeDays: 90,
    leaveExtendsNotice: false,
    noticeWaived: false,
    loanOutstandingPaise: 0,
    assetRecoveryPaise: 0,
    reimbursementsPaise: 0,
    variablePayPaise: 0,
    ...over,
  };
}

describe("Full and final settlement", () => {
  test("assembles payables and recoveries and nets correctly", () => {
    const r = computeSettlement(baseInput());
    const sum =
      r.lines.filter((l) => l.kind === "payable").reduce((a, l) => a + l.amountPaise, 0) -
      r.lines.filter((l) => l.kind === "recovery").reduce((a, l) => a + l.amountPaise, 0);
    assert.equal(r.netPaise, Math.round(sum / 100) * 100);
    assert.equal(r.isRecoverable, false);
    assert.ok(r.payablesPaise > 0);
  });

  test("includes gratuity for a long-service leaver", () => {
    const r = computeSettlement(baseInput());
    const g = r.lines.find((l) => l.code === "GRATUITY");
    assert.ok(g, "gratuity line present");
    assert.equal(r.gratuity.eligible, true);
  });

  test("omits gratuity below the qualifying period, with a warning", () => {
    const r = computeSettlement(
      baseInput({ dateOfJoining: "2024-01-01" }),
    );
    assert.equal(r.lines.some((l) => l.code === "GRATUITY"), false);
    assert.ok(r.warnings.some((w) => /Gratuity not payable/.test(w)));
  });

  test("THE NEGATIVE CASE: recoveries exceeding payables settle as a demand", () => {
    const r = computeSettlement(
      baseInput({
        dateOfJoining: "2024-06-01", // no gratuity
        leaveBalanceDays: 0,
        loanOutstandingPaise: R(300000),
        assetRecoveryPaise: R(45000),
        resignationDate: "2026-09-15",
        lastWorkingDay: "2026-09-30",
      }),
    );
    assert.equal(r.isRecoverable, true, "must be flagged recoverable");
    assert.ok(r.netPaise < 0, "net is negative, not clamped to zero");
    assert.ok(
      r.warnings.some((w) => /demand on the employee/.test(w)),
      "warns that this is a demand, not a payment",
    );
  });

  test("notice shortfall appears as a recovery line", () => {
    const r = computeSettlement(
      baseInput({ resignationDate: "2026-09-01", lastWorkingDay: "2026-09-30" }),
    );
    const n = r.lines.find((l) => l.code === "NOTICE_REC");
    assert.ok(n, "shortfall recovered");
    assert.equal(r.notice.shortfallDays, 61);
  });

  test("waived notice records an info line, not a recovery", () => {
    const r = computeSettlement(
      baseInput({
        resignationDate: "2026-09-01",
        lastWorkingDay: "2026-09-30",
        noticeWaived: true,
      }),
    );
    assert.equal(r.lines.some((l) => l.code === "NOTICE_REC"), false);
    assert.ok(r.lines.some((l) => l.code === "NOTICE_WAIVED"));
    assert.ok(r.warnings.some((w) => /authorised approver/.test(w)));
  });

  test("death in service: gratuity payable, no notice recovery", () => {
    const r = computeSettlement(
      baseInput({
        exitType: "death_in_service",
        dateOfJoining: "2025-01-01", // under 5 years
        resignationDate: "2026-09-25",
        lastWorkingDay: "2026-09-30",
      }),
    );
    assert.equal(r.gratuity.eligible, true, "qualifying period waived");
    assert.equal(r.lines.some((l) => l.code === "NOTICE_REC"), false);
  });

  test("exempt amounts are tracked separately from payables", () => {
    const r = computeSettlement(baseInput());
    assert.ok(r.exemptTotalPaise > 0, "leave and gratuity carry exemptions");
    assert.ok(
      r.taxableAdditionPaise < r.payablesPaise,
      "taxable addition excludes exempt components",
    );
  });

  test("employer notice pay-in-lieu is a payable", () => {
    const r = computeSettlement(
      baseInput({
        exitType: "termination",
        resignationDate: "2026-09-01",
        lastWorkingDay: "2026-09-30",
        employerPaysNoticeInLieu: true,
      }),
    );
    assert.ok(r.lines.some((l) => l.code === "NOTICE_PAY"));
    assert.equal(r.noticeSettlement.kind, "payout");
  });

  test("manual adjustments carry their reason through", () => {
    const r = computeSettlement(
      baseInput({
        adjustments: [
          { label: "Relocation clawback", amountPaise: R(50000), recovery: true, reason: "Bond period not served" },
        ],
      }),
    );
    const adj = r.lines.find((l) => l.label === "Relocation clawback");
    assert.ok(adj);
    assert.equal(adj.kind, "recovery");
    assert.match(adj.basis, /Bond period not served/);
  });
});

describe("Gratuity for fixed-term employment", () => {
  const base = {
    dateOfJoining: "2024-04-01",
    lastDrawnWagePaise: 20_000_00,
    exitType: "resignation" as const,
  };

  test("a regular employee under five years gets nothing", () => {
    const g = computeGratuity({ ...base, lastWorkingDay: "2026-09-30" });
    assert.equal(g.eligible, false);
    assert.match(g.reason, /5-year qualifying period/);
  });

  test("the same service on a fixed term qualifies", () => {
    /* Two and a half years served out. Without this the person leaves
       with nothing, which is the case the provision exists to answer. */
    const g = computeGratuity({ ...base, lastWorkingDay: "2026-09-30", fixedTerm: true });
    assert.equal(g.eligible, true);
    assert.ok(g.grossPaise > 0);
  });

  test("under a year on a fixed term still gets nothing", () => {
    const g = computeGratuity({ ...base, lastWorkingDay: "2025-01-31", fixedTerm: true });
    assert.equal(g.eligible, false);
    assert.match(g.reason, /Fixed-term service/);
    assert.match(g.reason, /1-year/);
  });

  test("pro rata counts the term as served, not rounded up", () => {
    /* 2.5 years: a regular employee's part year would round to 3. */
    const fixed = computeGratuity({ ...base, lastWorkingDay: "2026-09-30", fixedTerm: true });
    const rounded = Math.round((20_000_00 * 15 * 3) / 26);
    assert.ok(
      fixed.grossPaise < rounded,
      `pro rata ${fixed.grossPaise} should be under the rounded-up ${rounded}`,
    );
    assert.ok(fixed.countedYears < 3 && fixed.countedYears > 2);
  });

  test("a completed fixed term of exactly one year qualifies", () => {
    const g = computeGratuity({ ...base, lastWorkingDay: "2025-04-01", fixedTerm: true });
    assert.equal(g.eligible, true);
  });

  test("death in service still waives the qualifying period either way", () => {
    const g = computeGratuity({
      ...base,
      lastWorkingDay: "2024-06-30",
      exitType: "death_in_service",
      fixedTerm: true,
    });
    assert.equal(g.eligible, true);
  });
});

describe("Completed years are counted by anniversary", () => {
  test("exactly five calendar years qualifies, though the decimal reads 4.99", () => {
    const g = computeGratuity({
      dateOfJoining: "2020-04-01",
      lastWorkingDay: "2025-04-01",
      lastDrawnWagePaise: 20_000_00,
      exitType: "resignation",
    });
    assert.ok(serviceYears("2020-04-01", "2025-04-01") < 5, "the decimal is short of five");
    assert.equal(completedYears("2020-04-01", "2025-04-01"), 5);
    assert.equal(g.eligible, true, "a day before the anniversary is not five years, this is");
  });

  test("a day before the anniversary is still four years", () => {
    assert.equal(completedYears("2020-04-01", "2025-03-31"), 4);
    const g = computeGratuity({
      dateOfJoining: "2020-04-01",
      lastWorkingDay: "2025-03-31",
      lastDrawnWagePaise: 20_000_00,
      exitType: "resignation",
    });
    assert.equal(g.eligible, false);
  });

  test("a leap day joiner is not penalised", () => {
    assert.equal(completedYears("2024-02-29", "2029-03-01"), 5);
  });

  test("service that has not started counts as nothing", () => {
    assert.equal(completedYears("2026-01-01", "2025-01-01"), 0);
  });
});
