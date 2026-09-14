import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  computeEpf,
  computeEsic,
  computeProfessionalTax,
  computeLwf,
  contributionPeriodOf,
  type EpfParams,
  type EsicParams,
  type PtSlab,
} from "./statutory";
import { apportion, roundToRupee, formatINR } from "./money";
import {
  computeProration,
  paidDaysForPeriod,
  daysInMonth,
  periodDivisor,
} from "./proration";

const R = (rupees: number) => Math.round(rupees * 100);

const EPF: EpfParams = {
  wageCeilingPaise: R(15000),
  employeeBps: 1200,
  employerBps: 1200,
  epsBps: 833,
  epsCeilingPaise: R(15000),
};

const ESIC: EsicParams = {
  wageThresholdPaise: R(21000),
  employeeBps: 75,
  employerBps: 325,
};

/* ==================== EPF ==================== */

describe("EPF", () => {
  test("contributes on actual wages when below the ceiling", () => {
    const r = computeEpf({
      pfWagePaise: R(12000),
      params: EPF,
      onActualBasic: false,
      hadPriorMembership: true,
      optedIn: true,
    });
    assert.equal(r.applicable, true);
    assert.equal(r.employeePaise, R(1440)); // 12% of 12,000
    assert.equal(r.employerEpsPaise, Math.round((R(12000) * 833) / 10000));
    // Employer PF is the remainder after EPS, not a flat percentage.
    assert.equal(r.employerPfPaise, R(1440) - r.employerEpsPaise);
  });

  test("restricts contribution to the ceiling by default", () => {
    const r = computeEpf({
      pfWagePaise: R(40000),
      params: EPF,
      onActualBasic: false,
      hadPriorMembership: true,
      optedIn: true,
    });
    assert.equal(r.pfWageConsidered, R(15000));
    assert.equal(r.employeePaise, R(1800)); // 12% of 15,000
  });

  test("contributes on actual basic when the company opts to", () => {
    const r = computeEpf({
      pfWagePaise: R(40000),
      params: EPF,
      onActualBasic: true,
      hadPriorMembership: true,
      optedIn: true,
    });
    assert.equal(r.pfWageConsidered, R(40000));
    assert.equal(r.employeePaise, R(4800));
  });

  test("excluded employee: above ceiling at joining, no prior membership", () => {
    const r = computeEpf({
      pfWagePaise: R(30000),
      params: EPF,
      onActualBasic: false,
      hadPriorMembership: false,
      optedIn: false,
    });
    assert.equal(r.applicable, false);
    assert.equal(r.employeePaise, 0);
    assert.match(r.reason, /Excluded employee/);
  });

  test("prior membership keeps PF compulsory above the ceiling", () => {
    const r = computeEpf({
      pfWagePaise: R(30000),
      params: EPF,
      onActualBasic: false,
      hadPriorMembership: true,
      optedIn: false,
    });
    assert.equal(r.applicable, true);
  });

  test("international worker: ceiling does not apply and EPS is nil", () => {
    const r = computeEpf({
      pfWagePaise: R(50000),
      params: EPF,
      onActualBasic: false,
      hadPriorMembership: true,
      optedIn: true,
      isInternationalWorker: true,
    });
    assert.equal(r.pfWageConsidered, R(50000));
    assert.equal(r.employerEpsPaise, 0);
    assert.equal(r.employerPfPaise, R(6000));
  });

  test("VPF is computed on the full PF wage", () => {
    const r = computeEpf({
      pfWagePaise: R(20000),
      params: EPF,
      onActualBasic: false,
      hadPriorMembership: true,
      optedIn: true,
      vpfPercent: 10,
    });
    assert.equal(r.vpfPaise, R(2000));
  });
});

/* ==================== ESIC ==================== */

describe("ESIC", () => {
  test("contribution periods are April–September and October–March", () => {
    assert.equal(contributionPeriodOf(4), "apr_sep");
    assert.equal(contributionPeriodOf(9), "apr_sep");
    assert.equal(contributionPeriodOf(10), "oct_mar");
    assert.equal(contributionPeriodOf(3), "oct_mar");
  });

  test("covers an employee within the wage threshold", () => {
    const r = computeEsic({
      grossPaise: R(18000),
      month: 4,
      params: ESIC,
      implementedArea: true,
      coveredAtPeriodStart: false,
    });
    assert.equal(r.applicable, true);
    assert.equal(r.employeePaise, Math.ceil((R(18000) * 75) / 10000));
    assert.equal(r.employerPaise, Math.ceil((R(18000) * 325) / 10000));
  });

  test("THE RULE: coverage persists to period end after a mid-period raise", () => {
    // Covered in April at 20,000; raised to 25,000 in November.
    const r = computeEsic({
      grossPaise: R(25000),
      month: 11,
      params: ESIC,
      implementedArea: true,
      coveredAtPeriodStart: true,
    });
    assert.equal(r.applicable, true, "must remain covered mid-period");
    // Contribution is on ACTUAL wages, not capped at the threshold.
    assert.equal(r.employeePaise, Math.ceil((R(25000) * 75) / 10000));
    assert.match(r.reason, /coverage continues/i);
    // But they drop out at the next period boundary.
    assert.equal(r.coveredForNextPeriod, false);
  });

  test("drops coverage at the next period start once above threshold", () => {
    const r = computeEsic({
      grossPaise: R(25000),
      month: 4,
      params: ESIC,
      implementedArea: true,
      coveredAtPeriodStart: true,
    });
    assert.equal(r.applicable, false, "period boundary re-tests the threshold");
  });

  test("not applicable outside an implemented area", () => {
    const r = computeEsic({
      grossPaise: R(15000),
      month: 6,
      params: ESIC,
      implementedArea: false,
      coveredAtPeriodStart: true,
    });
    assert.equal(r.applicable, false);
    assert.match(r.reason, /implemented area/);
  });

  test("an employee above threshold at period start is never covered", () => {
    const r = computeEsic({
      grossPaise: R(30000),
      month: 7,
      params: ESIC,
      implementedArea: true,
      coveredAtPeriodStart: false,
    });
    assert.equal(r.applicable, false);
  });
});

/* ==================== Professional tax ==================== */

// Karnataka: nil to 25,000, then ₹200/month.
const KA: PtSlab[] = [
  { minPaise: 0, maxPaise: R(24999.99), amountPaise: 0 },
  { minPaise: R(25000), maxPaise: null, amountPaise: R(200) },
];

// Maharashtra: ₹300 in February instead of ₹200.
const MH: PtSlab[] = [
  { minPaise: 0, maxPaise: R(7500), amountPaise: 0, gender: "male" },
  { minPaise: R(7500.01), maxPaise: R(10000), amountPaise: R(175), gender: "male" },
  {
    minPaise: R(10000.01),
    maxPaise: null,
    amountPaise: R(200),
    overrideMonth: 2,
    overrideAmountPaise: R(300),
    gender: "male",
  },
  { minPaise: 0, maxPaise: R(25000), amountPaise: 0, gender: "female" },
  {
    minPaise: R(25000.01),
    maxPaise: null,
    amountPaise: R(200),
    overrideMonth: 2,
    overrideAmountPaise: R(300),
    gender: "female",
  },
];

describe("Professional tax", () => {
  test("returns nil where the state does not levy PT", () => {
    const r = computeProfessionalTax({
      stateCode: "UP",
      ptBasePaise: R(90000),
      month: 6,
      gender: "male",
      slabs: [],
      applicable: false,
    });
    assert.equal(r.amountPaise, 0);
    assert.match(r.reason, /does not levy/);
  });

  test("applies the correct Karnataka slab", () => {
    const below = computeProfessionalTax({
      stateCode: "KA",
      ptBasePaise: R(20000),
      month: 6,
      gender: "male",
      slabs: KA,
      applicable: true,
    });
    assert.equal(below.amountPaise, 0);

    const above = computeProfessionalTax({
      stateCode: "KA",
      ptBasePaise: R(60000),
      month: 6,
      gender: "male",
      slabs: KA,
      applicable: true,
    });
    assert.equal(above.amountPaise, R(200));
  });

  test("applies the Maharashtra February override", () => {
    const june = computeProfessionalTax({
      stateCode: "MH",
      ptBasePaise: R(50000),
      month: 6,
      gender: "male",
      slabs: MH,
      applicable: true,
    });
    assert.equal(june.amountPaise, R(200));

    const feb = computeProfessionalTax({
      stateCode: "MH",
      ptBasePaise: R(50000),
      month: 2,
      gender: "male",
      slabs: MH,
      applicable: true,
    });
    assert.equal(feb.amountPaise, R(300));
  });

  test("respects gender-differentiated thresholds", () => {
    const woman = computeProfessionalTax({
      stateCode: "MH",
      ptBasePaise: R(20000),
      month: 6,
      gender: "female",
      slabs: MH,
      applicable: true,
    });
    assert.equal(woman.amountPaise, 0, "below the ₹25,000 threshold for women");

    const man = computeProfessionalTax({
      stateCode: "MH",
      ptBasePaise: R(20000),
      month: 6,
      gender: "male",
      slabs: MH,
      applicable: true,
    });
    assert.equal(man.amountPaise, R(200));
  });

  test("enforces the annual cap", () => {
    const r = computeProfessionalTax({
      stateCode: "KA",
      ptBasePaise: R(60000),
      month: 3,
      gender: "male",
      slabs: KA,
      ytdDeductedPaise: R(2400), // ₹2,400 already taken; cap is ₹2,500
      applicable: true,
    });
    assert.equal(r.amountPaise, R(100), "only the remaining ₹100 is deducted");
    assert.match(r.reason, /cap reached/);
  });

  test("deducts nothing once the cap is exhausted", () => {
    const r = computeProfessionalTax({
      stateCode: "KA",
      ptBasePaise: R(60000),
      month: 3,
      gender: "male",
      slabs: KA,
      ytdDeductedPaise: R(2500),
      applicable: true,
    });
    assert.equal(r.amountPaise, 0);
  });
});

/* ==================== LWF ==================== */

describe("Labour welfare fund", () => {
  const MH_LWF = {
    employeePaise: R(25),
    employerPaise: R(75),
    frequency: "half_yearly" as const,
    deductionMonths: [6, 12],
  };

  test("deducts only in a designated month", () => {
    const june = computeLwf({
      stateCode: "MH",
      month: 6,
      applicable: true,
      rate: MH_LWF,
    });
    assert.equal(june.employeePaise, R(25));
    assert.equal(june.employerPaise, R(75));

    const july = computeLwf({
      stateCode: "MH",
      month: 7,
      applicable: true,
      rate: MH_LWF,
    });
    assert.equal(july.employeePaise, 0);
    assert.match(july.reason, /not a half-yearly deduction month/i);
  });

  test("monthly states deduct every month", () => {
    const r = computeLwf({
      stateCode: "HR",
      month: 8,
      applicable: true,
      rate: {
        employeePaise: R(34),
        employerPaise: R(68),
        frequency: "monthly",
        deductionMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      },
    });
    assert.equal(r.employeePaise, R(34));
  });

  test("returns nil where the state does not levy LWF", () => {
    const r = computeLwf({
      stateCode: "UP",
      month: 6,
      applicable: false,
      rate: null,
    });
    assert.equal(r.employeePaise, 0);
  });
});

/* ==================== money & proration ==================== */

describe("Money", () => {
  test("apportion always sums exactly to the total", () => {
    const parts = apportion(100000, [50, 30, 20]);
    assert.equal(parts.reduce((a, b) => a + b, 0), 100000);
  });

  test("apportion handles indivisible remainders without losing paise", () => {
    const parts = apportion(100, [1, 1, 1]);
    assert.equal(parts.reduce((a, b) => a + b, 0), 100);
    assert.deepEqual(parts.sort(), [33, 33, 34]);
  });

  test("rounding modes", () => {
    assert.equal(roundToRupee(15050, "nearest"), 15100);
    assert.equal(roundToRupee(15050, "down"), 15000);
    assert.equal(roundToRupee(15010, "up"), 15100);
  });

  test("formats with Indian digit grouping", () => {
    assert.equal(formatINR(R(1234567.89)), "₹12,34,567.89");
    assert.equal(formatINR(R(999)), "₹999.00");
    assert.equal(formatINR(R(-500)), "−₹500.00");
  });
});

describe("Proration", () => {
  test("divisor differs by basis — February is the tell", () => {
    assert.equal(daysInMonth(2026, 2), 28);
    assert.equal(periodDivisor({ basis: "calendar_days", year: 2026, month: 2 }), 28);
    assert.equal(periodDivisor({ basis: "fixed_30", year: 2026, month: 2 }), 30);
    assert.equal(
      periodDivisor({ basis: "standard_days", year: 2026, month: 2, standardDays: 26 }),
      26,
    );
  });

  test("a full month is a factor of exactly 1", () => {
    const p = computeProration({
      basis: "calendar_days",
      year: 2026,
      month: 3,
      paidDays: 31,
    });
    assert.equal(p.factor, 1);
  });

  test("mid-month joiner is paid from the date of joining, inclusive", () => {
    const days = paidDaysForPeriod({
      year: 2026,
      month: 3,
      basis: "calendar_days",
      dateOfJoining: "2026-03-17",
    });
    assert.equal(days, 15); // 17th to 31st inclusive
  });

  test("leaver is paid through the last working day, inclusive", () => {
    const days = paidDaysForPeriod({
      year: 2026,
      month: 3,
      basis: "calendar_days",
      dateOfExit: "2026-03-10",
    });
    assert.equal(days, 10);
  });

  test("loss of pay reduces paid days", () => {
    const days = paidDaysForPeriod({
      year: 2026,
      month: 3,
      basis: "calendar_days",
      lopDays: 2.5,
    });
    assert.equal(days, 28.5);
  });

  test("joining after the period ends pays nothing", () => {
    const days = paidDaysForPeriod({
      year: 2026,
      month: 3,
      basis: "calendar_days",
      dateOfJoining: "2026-05-01",
    });
    assert.equal(days, 0);
  });

  test("exit before the period starts pays nothing", () => {
    const days = paidDaysForPeriod({
      year: 2026,
      month: 3,
      basis: "calendar_days",
      dateOfExit: "2026-01-31",
    });
    assert.equal(days, 0);
  });
});
