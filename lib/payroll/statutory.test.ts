import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  computeEpf,
  computeEsic,
  computeProfessionalTax,
  computeLwf,
  contributionPeriodOf,
  effectiveAsOf,
  checkSlabCoverage,
  lwfEmployerTopUp,
  type EpfParams,
  type LwfInput,
  type LwfRate,
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

  test("a record with no gender is charged, not silently exempted", () => {
    /* "Other" is the create form's default, and it matches neither of a
       gendered slab set. It used to fall through to nil PT, which is the
       employer's liability to make good, not a saving. */
    const other = computeProfessionalTax({
      stateCode: "MH",
      ptBasePaise: R(50000),
      month: 6,
      gender: "other",
      slabs: MH,
      applicable: true,
    });
    assert.equal(other.amountPaise, R(200));
    assert.match(other.reason, /names none/);
  });

  test("a record with no gender takes the higher of the gendered slabs", () => {
    /* At ₹20,000 Maharashtra exempts women and charges everyone else. The
       conservative reading is the one that deducts. */
    const other = computeProfessionalTax({
      stateCode: "MH",
      ptBasePaise: R(20000),
      month: 6,
      gender: "other",
      slabs: MH,
      applicable: true,
    });
    const woman = computeProfessionalTax({
      stateCode: "MH",
      ptBasePaise: R(20000),
      month: 6,
      gender: "female",
      slabs: MH,
      applicable: true,
    });
    assert.equal(woman.amountPaise, 0, "the concession still reaches the women it is for");
    assert.ok(other.amountPaise > 0, "and is not handed to a record that does not claim it");
  });

  test("a genderless slab set is unaffected by the employee's gender", () => {
    for (const gender of ["male", "female", "other"] as const) {
      const r = computeProfessionalTax({
        stateCode: "KA",
        ptBasePaise: R(60000),
        month: 6,
        gender,
        slabs: KA,
        applicable: true,
      });
      assert.equal(r.amountPaise, R(200), `${gender} was charged differently`);
      assert.equal(r.reason, "Slab rate applied");
    }
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

describe("Which statutory rows are in force", () => {
  /* A ceiling raised from 25 August 2026, superseding the old one. */
  const ceilings = [
    { key: "epf.wage_ceiling", value: 1_500_000, effectiveFrom: "2020-04-01", effectiveTo: "2026-08-24" },
    { key: "epf.wage_ceiling", value: 2_500_000, effectiveFrom: "2026-08-25", effectiveTo: null },
  ];

  const inForce = (asOf: string) => effectiveAsOf(ceilings, asOf)[0]?.value;

  test("a month before the change still runs at the old ceiling", () => {
    assert.equal(inForce("2026-07-31"), 1_500_000);
  });

  test("the day the change takes effect is the first day of the new one", () => {
    assert.equal(inForce("2026-08-24"), 1_500_000, "the day before");
    assert.equal(inForce("2026-08-25"), 2_500_000, "the day itself");
  });

  test("after the change the new ceiling stands", () => {
    assert.equal(inForce("2026-09-30"), 2_500_000);
  });

  test("exactly one row is ever in force", () => {
    for (const asOf of ["2020-04-01", "2026-08-24", "2026-08-25", "2030-01-01"]) {
      assert.equal(effectiveAsOf(ceilings, asOf).length, 1, asOf);
    }
  });

  test("a date before anything was in force matches nothing", () => {
    assert.deepEqual(effectiveAsOf(ceilings, "2019-12-31"), []);
  });

  test("an open-ended row has no end", () => {
    const open = [{ effectiveFrom: "2020-04-01", effectiveTo: null }];
    assert.equal(effectiveAsOf(open, "2099-01-01").length, 1);
  });
});

describe("Labour welfare fund charged as a share of wages", () => {
  /* Haryana: 0.2% of wages subject to a limit of ₹35, employer twice. */
  const hr = {
    employeePaise: 3500,
    employerPaise: 7000,
    employeePercentBps: 20,
    employerMultiple: 2,
    frequency: "monthly" as const,
    deductionMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  };
  const at = (monthlyWagePaise: number) =>
    computeLwf({ stateCode: "HR", month: 8, applicable: true, rate: hr, monthlyWagePaise });

  test("wages above the cap pay the cap", () => {
    const r = at(20_375_34);
    assert.equal(r.employeePaise, 3500);
    assert.equal(r.employerPaise, 7000);
    assert.match(r.reason, /at the 0.20% cap/);
  });

  test("wages below the cap pay the percentage, not the cap", () => {
    /* ₹15,013.42 × 0.2% = ₹30.03. Charging ₹35 takes too much, every
       month, from the lowest paid — and nobody would ever query it. */
    const r = at(15_013_42);
    assert.equal(r.employeePaise, 3003);
    assert.match(r.reason, /under the cap/);
  });

  test("the employer owes twice what the employee actually paid", () => {
    const r = at(15_013_42);
    assert.equal(r.employerPaise, 6006, "twice the charge, not twice the cap");
  });

  test("the cap binds at the wage that reaches it, and not below", () => {
    assert.equal(at(17_500_00).employeePaise, 3500, "0.2% of 17,500 is exactly the cap");
    assert.equal(at(17_000_00).employeePaise, 3400, "0.2% of 17,000, under the cap");
  });

  test("a flat state is unchanged by any of this", () => {
    const flat = { ...hr, employeePercentBps: null, employerMultiple: null };
    const r = computeLwf({
      stateCode: "MH", month: 6, applicable: true, rate: flat, monthlyWagePaise: 15_000_00,
    });
    assert.equal(r.employeePaise, 3500, "the stored amount, charged flat");
    assert.equal(r.employerPaise, 7000);
  });

  test("a month the fund is not collected in charges nothing", () => {
    const r = computeLwf({
      stateCode: "HR", month: 8, applicable: true,
      rate: { ...hr, deductionMonths: [12] }, monthlyWagePaise: 20_000_00,
    });
    assert.equal(r.employeePaise, 0);
  });
});

describe("Whether a state's PT slabs cover every wage once", () => {
  const slab = (min: number, max: number | null, amount: number, gender?: "all" | "female" | "male") =>
    ({ minPaise: min, maxPaise: max, amountPaise: amount, gender }) as PtSlab;

  test("a complete ladder has nothing wrong with it", () => {
    const ok = [slab(0, R(24999), 0), slab(R(25000), null, R(200))];
    assert.deepEqual(checkSlabCoverage(ok), []);
  });

  test("a hole between two bands is reported", () => {
    /* Nobody between 10,000 and 12,000 is charged anything, and the run
       would not say so — it would simply deduct nothing. */
    const holed = [slab(0, R(10000), 0), slab(R(12000), null, R(200))];
    const found = checkSlabCoverage(holed);
    assert.equal(found.length, 1);
    assert.equal(found[0].kind, "gap");
    assert.match(found[0].message, /falls in none/);
  });

  test("two bands claiming the same wage are reported", () => {
    const doubled = [slab(0, R(20000), R(100)), slab(R(15000), null, R(200))];
    const found = checkSlabCoverage(doubled);
    assert.equal(found[0].kind, "overlap");
    assert.match(found[0].message, /falls in two bands/);
  });

  test("a ladder that does not start at nothing is reported", () => {
    const found = checkSlabCoverage([slab(R(5000), null, R(200))]);
    assert.equal(found[0].kind, "gap");
    assert.match(found[0].message, /below/);
  });

  test("a ladder that stops short of unbounded is reported", () => {
    const found = checkSlabCoverage([slab(0, R(50000), R(200))]);
    assert.equal(found[0].kind, "gap");
    assert.match(found[0].message, /above/);
  });

  test("bands that meet exactly at the rupee are not a gap", () => {
    const tight = [slab(0, R(10000), 0), slab(R(10000) + 1, null, R(200))];
    assert.deepEqual(checkSlabCoverage(tight), []);
  });

  test("gendered ladders are judged separately, not merged", () => {
    /* Each set is complete on its own; merging them would read as a
       pile of overlaps. */
    const gendered = [
      slab(0, R(7500), 0, "male"),
      slab(R(7500) + 1, null, R(200), "male"),
      slab(0, R(25000), 0, "female"),
      slab(R(25000) + 1, null, R(200), "female"),
    ];
    assert.deepEqual(checkSlabCoverage(gendered), []);
  });

  test("an incomplete gendered ladder is caught within its own set", () => {
    const gendered = [
      slab(0, R(7500), 0, "male"),
      slab(R(9000), null, R(200), "male"),
      slab(0, null, 0, "female"),
    ];
    const found = checkSlabCoverage(gendered);
    assert.equal(found.length, 1);
    assert.match(found[0].message, /male/);
  });

  test("no slab at all is its own problem", () => {
    assert.equal(checkSlabCoverage([])[0].kind, "empty");
  });
});

/* ==================================================================
   LWF — the rules a flat state→rate table cannot hold
   ================================================================== */

const R2 = (rupees: number) => Math.round(rupees * 100);

const halfYearly = (employee: number, employer: number, extra: Partial<LwfRate> = {}): LwfRate => ({
  employeePaise: R2(employee),
  employerPaise: R2(employer),
  frequency: "half_yearly",
  deductionMonths: [6, 12],
  ...extra,
});

const MP_RATE = halfYearly(10, 50, {
  employerMinimumPaise: R2(2500),
  exclusion: { categories: ["managerial", "supervisory"], aboveWagePaise: R2(10_000) },
});

const lwf = (rate: LwfRate | null, over: Partial<LwfInput> = {}) =>
  computeLwf({ stateCode: "MP", month: 6, applicable: true, rate, ...over });

test("a headcount floor makes the fund not apply at all", () => {
  const delhi = halfYearly(0.75, 2.25, { minEstablishmentHeadcount: 5 });
  const small = lwf(delhi, { stateCode: "DL", establishmentHeadcount: 4 });
  assert.equal(small.applicable, false);
  assert.equal(small.employeePaise, 0);
  assert.equal(small.employerPaise, 0);

  const big = lwf(delhi, { stateCode: "DL", establishmentHeadcount: 5 });
  assert.equal(big.employeePaise, R2(0.75));
  assert.equal(big.employerPaise, R2(2.25));
});

test("exclusion needs the job and the wage together, not either one", () => {
  // A supervisor under the wage still contributes.
  assert.equal(
    lwf(MP_RATE, { category: "supervisory", monthlyWagePaise: R2(8_000) }).employeePaise,
    R2(10),
  );
  // So does a well-paid person who is neither managerial nor supervisory.
  assert.equal(
    lwf(MP_RATE, { category: "other", monthlyWagePaise: R2(40_000) }).employeePaise,
    R2(10),
  );
  // Both together excludes.
  const out = lwf(MP_RATE, { category: "managerial", monthlyWagePaise: R2(40_000) });
  assert.equal(out.excluded, true);
  assert.equal(out.employeePaise, 0);
  assert.equal(out.employerPaise, 0);
});

test("an unrecorded job contributes and is reported rather than guessed", () => {
  const out = lwf(MP_RATE, { category: null, monthlyWagePaise: R2(40_000) });
  assert.equal(out.excluded, undefined);
  assert.equal(out.employeePaise, R2(10), "contributes while the question is open");
  assert.equal(out.categoryUnknown, true, "and says the question is open");

  // Below the wage there is nothing to decide, so nothing to report.
  assert.equal(
    lwf(MP_RATE, { category: null, monthlyWagePaise: R2(9_000) }).categoryUnknown,
    false,
  );
});

test("the employer minimum is per establishment, not per employee", () => {
  // Ten people at ₹50 is ₹500 against the ₹2,500 Madhya Pradesh owes.
  const short = lwfEmployerTopUp({
    rate: MP_RATE,
    month: 6,
    perHeadTotalPaise: R2(500),
    contributingCount: 10,
  });
  assert.equal(short.topUpPaise, R2(2000));
  assert.match(short.reason!, /not deducted from anybody/);

  // Sixty people clear it on their own.
  assert.equal(
    lwfEmployerTopUp({ rate: MP_RATE, month: 6, perHeadTotalPaise: R2(3000), contributingCount: 60 })
      .topUpPaise,
    0,
  );

  // And it is not owed in a month the fund is not collected.
  assert.equal(
    lwfEmployerTopUp({ rate: MP_RATE, month: 7, perHeadTotalPaise: 0, contributingCount: 0 })
      .topUpPaise,
    0,
  );

  // Chhattisgarh shares Madhya Pradesh's shape but sets no minimum.
  const cg = halfYearly(15, 45);
  assert.equal(
    lwfEmployerTopUp({ rate: cg, month: 6, perHeadTotalPaise: R2(45), contributingCount: 1 })
      .topUpPaise,
    0,
  );
});

test("a state that does not levy takes nothing", () => {
  const out = lwf(null, { stateCode: "MN", applicable: false });
  assert.equal(out.applicable, false);
  assert.equal(out.employeePaise, 0);
  assert.equal(out.employerPaise, 0);
});
