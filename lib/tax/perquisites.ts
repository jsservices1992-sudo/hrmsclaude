import type { Paise } from "../payroll/money";

/**
 * Perquisite valuation — PRD §3.9, FR-TAX-6.
 *
 * Rule 3 of the Income-tax Rules values perquisites on prescribed bases,
 * not on what the benefit cost the employer. The rates below are
 * configuration for the same reason the slabs are.
 *
 * Covers: motor car, rent-free/concessional accommodation, concessional
 * loans, employer retirals above the aggregate cap, ESOPs, domestic
 * servants, gas/electricity/water, a child's educational facility, club
 * or gym membership, gifts and vouchers, and medical reimbursement. Left
 * out on purpose because they need facts this build does not otherwise
 * hold: leave travel concession beyond the two-in-a-block exemption
 * (handled as an exempt allowance, not here), and lunch/tea/non-alcoholic
 * refreshment at the workplace (exempt regardless of value, so there is
 * nothing to value).
 */

export type PerquisiteRates = {
  /** Rule 3(2): monthly value where the employer owns the car. */
  carSmallEnginePaise: Paise;
  carLargeEnginePaise: Paise;
  /** Engine capacity in cc above which the larger value applies. */
  largeEngineCc: number;
  /** Additional monthly value where a driver is provided. */
  driverPaise: Paise;
  /**
   * Rule 3(1): accommodation as a percentage of salary, by population of
   * the city, in basis points.
   */
  accommodationAbove40LakhBps: number;
  accommodationAbove15LakhBps: number;
  accommodationOtherBps: number;
  /** Rule 3(7)(i): SBI lending rate for concessional loans, bps. */
  sbiLendingRateBps: number;
  /** Loans up to this amount in aggregate are not a perquisite. */
  loanExemptionThresholdPaise: Paise;
  /** Employer PF, NPS and superannuation above this is taxable — s.17(2)(vii). */
  retiralAggregateCapPaise: Paise;
  /** Rule 3(5): education is nil-value below this, per child per month. */
  educationExemptMonthlyPaise: Paise;
  /** CBDT circular: gifts in kind, aggregate for the year. Above this the WHOLE value is taxable, not just the excess. */
  giftExemptAggregatePaise: Paise;
};

export const PERQUISITE_RATES_2026: PerquisiteRates = {
  carSmallEnginePaise: 180000, // ₹1,800
  carLargeEnginePaise: 240000, // ₹2,400
  largeEngineCc: 1600,
  driverPaise: 90000, // ₹900
  accommodationAbove40LakhBps: 1000,
  accommodationAbove15LakhBps: 750,
  accommodationOtherBps: 500,
  sbiLendingRateBps: 900,
  loanExemptionThresholdPaise: 2000000, // ₹20,000
  retiralAggregateCapPaise: 75000000, // ₹7,50,000
  educationExemptMonthlyPaise: 100000, // ₹1,000 per child per month
  giftExemptAggregatePaise: 500000, // ₹5,000
};

export type PerquisiteLine = {
  code: string;
  label: string;
  valuePaise: Paise;
  basis: string;
};

/* ------------------------------------------------------------------
   Motor car — Rule 3(2)
   ------------------------------------------------------------------ */

export type CarPerquisite = {
  ownedByEmployer: boolean;
  engineCc: number;
  driverProvided: boolean;
  /** Wholly personal use is valued at actual cost, not the flat rate. */
  useIsWhollyPersonal: boolean;
  actualCostPaise: Paise;
  amountRecoveredPaise: Paise;
  months: number;
};

export function valueCar(
  car: CarPerquisite,
  rates: PerquisiteRates,
): PerquisiteLine {
  if (!car.ownedByEmployer) {
    return {
      code: "CAR",
      label: "Motor car",
      valuePaise: 0,
      basis: "Employee-owned car; no perquisite arises on the vehicle itself",
    };
  }

  // Wholly personal use is not a concession — the whole running cost is
  // the perquisite, and the flat monthly rate does not apply.
  if (car.useIsWhollyPersonal) {
    return {
      code: "CAR",
      label: "Motor car",
      valuePaise: Math.max(0, car.actualCostPaise - car.amountRecoveredPaise),
      basis: "Wholly personal use, valued at actual cost less recovery",
    };
  }

  const large = car.engineCc > rates.largeEngineCc;
  const monthly =
    (large ? rates.carLargeEnginePaise : rates.carSmallEnginePaise) +
    (car.driverProvided ? rates.driverPaise : 0);
  const value = Math.max(
    0,
    monthly * car.months - car.amountRecoveredPaise,
  );

  return {
    code: "CAR",
    label: "Motor car",
    valuePaise: value,
    basis: `${large ? "Above" : "Up to"} ${rates.largeEngineCc}cc${
      car.driverProvided ? " with driver" : ""
    }, ₹${(monthly / 100).toFixed(0)} a month for ${car.months} month(s)`,
  };
}

/* ------------------------------------------------------------------
   Rent-free accommodation — Rule 3(1)
   ------------------------------------------------------------------ */

export type AccommodationPerquisite = {
  provided: boolean;
  /** Salary for the purpose of Rule 3 — excludes most perquisites. */
  salaryPaise: Paise;
  cityPopulation: number;
  /** Leased from a third party: the lower of the rent or the percentage. */
  leasedByEmployer: boolean;
  actualRentPaise: Paise;
  rentRecoveredFromEmployeePaise: Paise;
  furnishingValuePaise: Paise;
};

export function valueAccommodation(
  a: AccommodationPerquisite,
  rates: PerquisiteRates,
): PerquisiteLine {
  if (!a.provided) {
    return { code: "ACCOM", label: "Accommodation", valuePaise: 0, basis: "Not provided" };
  }

  const bps =
    a.cityPopulation > 4_000_000
      ? rates.accommodationAbove40LakhBps
      : a.cityPopulation > 1_500_000
        ? rates.accommodationAbove15LakhBps
        : rates.accommodationOtherBps;

  const percentageValue = Math.round((a.salaryPaise * bps) / 10000);

  // For leased accommodation the value is the lower of the actual rent and
  // the prescribed percentage.
  const gross = a.leasedByEmployer
    ? Math.min(percentageValue, a.actualRentPaise)
    : percentageValue;

  const value = Math.max(
    0,
    gross + a.furnishingValuePaise - a.rentRecoveredFromEmployeePaise,
  );

  return {
    code: "ACCOM",
    label: "Accommodation",
    valuePaise: value,
    basis: a.leasedByEmployer
      ? `Lower of actual rent and ${bps / 100}% of salary, less recovery`
      : `${bps / 100}% of salary for a population above ${
          a.cityPopulation > 4_000_000 ? "40 lakh" : a.cityPopulation > 1_500_000 ? "15 lakh" : "the lower bands"
        }, less recovery`,
  };
}

/* ------------------------------------------------------------------
   Concessional loans — Rule 3(7)(i)
   ------------------------------------------------------------------ */

export type LoanPerquisite = {
  /** Maximum outstanding on the last day of each month, summed. */
  monthlyOutstandingPaise: Paise[];
  interestChargedBps: number;
  /** Medical treatment loans for specified diseases are excluded. */
  isExemptPurpose: boolean;
};

export function valueLoan(
  loan: LoanPerquisite,
  rates: PerquisiteRates,
): PerquisiteLine {
  if (loan.isExemptPurpose) {
    return {
      code: "LOAN",
      label: "Concessional loan",
      valuePaise: 0,
      basis: "Loan for an exempt purpose",
    };
  }

  const peak = Math.max(0, ...loan.monthlyOutstandingPaise);
  if (peak <= rates.loanExemptionThresholdPaise) {
    return {
      code: "LOAN",
      label: "Concessional loan",
      valuePaise: 0,
      basis: `Peak outstanding of ₹${(peak / 100).toFixed(0)} is within the ₹${(rates.loanExemptionThresholdPaise / 100).toFixed(0)} exemption`,
    };
  }

  const shortfallBps = Math.max(
    0,
    rates.sbiLendingRateBps - loan.interestChargedBps,
  );

  // Interest is computed month by month on the outstanding balance, then
  // annualised — a single average would misstate a reducing loan.
  const value = loan.monthlyOutstandingPaise.reduce(
    (a, bal) => a + Math.round((bal * shortfallBps) / 10000 / 12),
    0,
  );

  return {
    code: "LOAN",
    label: "Concessional loan",
    valuePaise: value,
    basis:
      shortfallBps === 0
        ? "Interest charged is at or above the SBI rate; no perquisite"
        : `${(shortfallBps / 100).toFixed(2)}% below the SBI rate of ${(rates.sbiLendingRateBps / 100).toFixed(2)}%, on the monthly balances`,
  };
}

/* ------------------------------------------------------------------
   Employer retirals above the aggregate cap — section 17(2)(vii)
   ------------------------------------------------------------------ */

export function valueExcessRetirals(
  args: {
    employerPfPaise: Paise;
    employerNpsPaise: Paise;
    employerSuperannuationPaise: Paise;
  },
  rates: PerquisiteRates,
): PerquisiteLine {
  const total =
    args.employerPfPaise + args.employerNpsPaise + args.employerSuperannuationPaise;
  const excess = Math.max(0, total - rates.retiralAggregateCapPaise);

  return {
    code: "RETIRAL",
    label: "Employer retirals above the cap",
    valuePaise: excess,
    basis:
      excess === 0
        ? `Total of ₹${(total / 100).toFixed(0)} is within the ₹${(rates.retiralAggregateCapPaise / 100).toFixed(0)} aggregate cap`
        : `PF, NPS and superannuation total ₹${(total / 100).toFixed(0)}, exceeding the aggregate cap by ₹${(excess / 100).toFixed(0)}`,
  };
}

/* ------------------------------------------------------------------
   ESOP — section 17(2)(vi)
   ------------------------------------------------------------------ */

export function valueEsop(args: {
  sharesExercised: number;
  fairMarketValuePerSharePaise: Paise;
  exercisePricePerSharePaise: Paise;
  /** An eligible start-up may defer the TDS; the perquisite still arises. */
  isEligibleStartup: boolean;
}): PerquisiteLine {
  const spread = Math.max(
    0,
    args.fairMarketValuePerSharePaise - args.exercisePricePerSharePaise,
  );
  const value = spread * args.sharesExercised;

  return {
    code: "ESOP",
    label: "ESOP perquisite",
    valuePaise: value,
    basis: args.isEligibleStartup
      ? `${args.sharesExercised} shares at a spread of ₹${(spread / 100).toFixed(2)}; TDS may be deferred under section 192(1C), but the perquisite arises on exercise`
      : `${args.sharesExercised} shares at a spread of ₹${(spread / 100).toFixed(2)} on exercise`,
  };
}

/* ------------------------------------------------------------------
   Domestic servant — Rule 3(3)
   ------------------------------------------------------------------ */

export function valueDomesticServant(args: {
  provided: boolean;
  actualCostToEmployerPaise: Paise;
  amountRecoveredPaise: Paise;
}): PerquisiteLine {
  if (!args.provided) {
    return { code: "SERVANT", label: "Domestic servant", valuePaise: 0, basis: "Not provided" };
  }
  const value = Math.max(0, args.actualCostToEmployerPaise - args.amountRecoveredPaise);
  return {
    code: "SERVANT",
    label: "Domestic servant",
    valuePaise: value,
    basis: "Actual cost to the employer, less any amount recovered from the employee",
  };
}

/* ------------------------------------------------------------------
   Gas, electricity and water — Rule 3(7)(ii)
   ------------------------------------------------------------------ */

export function valueUtilities(args: {
  provided: boolean;
  suppliedFromEmployersOwnResources: boolean;
  manufacturingCostToEmployerPaise: Paise;
  billedByOutsideAgencyPaise: Paise;
  amountRecoveredPaise: Paise;
}): PerquisiteLine {
  if (!args.provided) {
    return { code: "UTILITIES", label: "Gas, electricity and water", valuePaise: 0, basis: "Not provided" };
  }
  const gross = args.suppliedFromEmployersOwnResources
    ? args.manufacturingCostToEmployerPaise
    : args.billedByOutsideAgencyPaise;
  const value = Math.max(0, gross - args.amountRecoveredPaise);
  return {
    code: "UTILITIES",
    label: "Gas, electricity and water",
    valuePaise: value,
    basis: args.suppliedFromEmployersOwnResources
      ? "Manufacturing cost to the employer, less recovery"
      : "Amount billed by the outside agency, less recovery",
  };
}

/* ------------------------------------------------------------------
   Educational facility for children — Rule 3(5)
   ------------------------------------------------------------------ */

export function valueEducationalFacility(args: {
  /** One entry per child, the school's monthly cost in a similar institution. */
  perChildMonthlyCostPaise: Paise[];
  months: number;
  amountRecoveredPaise: Paise;
}): PerquisiteLine {
  if (args.perChildMonthlyCostPaise.length === 0) {
    return { code: "EDUCATION", label: "Educational facility", valuePaise: 0, basis: "Not provided" };
  }
  // Below the per-child monthly threshold the value is nil, not merely the
  // excess above it — this is an exemption, not a deduction against cost.
  const taxableChildren = args.perChildMonthlyCostPaise.filter(
    (m) => m > PERQUISITE_RATES_2026.educationExemptMonthlyPaise,
  );
  const gross = taxableChildren.reduce((a, m) => a + m * args.months, 0);
  const value = Math.max(0, gross - args.amountRecoveredPaise);
  return {
    code: "EDUCATION",
    label: "Educational facility",
    valuePaise: value,
    basis:
      taxableChildren.length === 0
        ? "Every child's cost is at or below ₹1,000 a month — nil value, not merely the excess"
        : `${taxableChildren.length} of ${args.perChildMonthlyCostPaise.length} child(ren) over ₹1,000/month — full monthly cost is taxable for each, less recovery`,
  };
}

/* ------------------------------------------------------------------
   Club or gym membership — Rule 3(7)(iii)
   ------------------------------------------------------------------ */

export function valueClubOrGymMembership(args: {
  annualFeePaidByEmployerPaise: Paise;
  usedWhollyAndExclusivelyForBusiness: boolean;
  amountRecoveredPaise: Paise;
}): PerquisiteLine {
  if (args.usedWhollyAndExclusivelyForBusiness) {
    return {
      code: "CLUB",
      label: "Club or gym membership",
      valuePaise: 0,
      basis: "Used wholly and exclusively for the employer's business",
    };
  }
  const value = Math.max(0, args.annualFeePaidByEmployerPaise - args.amountRecoveredPaise);
  return {
    code: "CLUB",
    label: "Club or gym membership",
    valuePaise: value,
    basis: "Annual fee paid by the employer, less any amount recovered",
  };
}

/* ------------------------------------------------------------------
   Gifts and vouchers — CBDT Circular under Rule 3(7)(iv)
   ------------------------------------------------------------------ */

export function valueGifts(args: { aggregateValuePaise: Paise }): PerquisiteLine {
  if (args.aggregateValuePaise <= PERQUISITE_RATES_2026.giftExemptAggregatePaise) {
    return {
      code: "GIFTS",
      label: "Gifts and vouchers",
      valuePaise: 0,
      basis: `Aggregate for the year is at or below the ₹${(PERQUISITE_RATES_2026.giftExemptAggregatePaise / 100).toFixed(0)} exemption`,
    };
  }
  return {
    code: "GIFTS",
    label: "Gifts and vouchers",
    valuePaise: args.aggregateValuePaise,
    basis: "Once the aggregate crosses ₹5,000 in the year, the WHOLE value is taxable, not just the excess",
  };
}

/* ------------------------------------------------------------------
   Medical reimbursement — no standalone exemption since AY 2019-20
   ------------------------------------------------------------------ */

export function valueMedicalReimbursement(args: {
  reimbursedPaise: Paise;
  /** Treatment at the employer's own hospital, or one maintained by the Government, is not a perquisite at all. */
  atEmployersOrGovernmentHospital: boolean;
}): PerquisiteLine {
  if (args.atEmployersOrGovernmentHospital) {
    return {
      code: "MEDICAL",
      label: "Medical reimbursement",
      valuePaise: 0,
      basis: "Treatment at the employer's own or a Government hospital is not a perquisite",
    };
  }
  return {
    code: "MEDICAL",
    label: "Medical reimbursement",
    valuePaise: args.reimbursedPaise,
    basis:
      "Fully taxable — the ₹15,000 medical reimbursement exemption was withdrawn from AY 2019-20 when the standard deduction was introduced",
  };
}

/* ------------------------------------------------------------------
   Assembly
   ------------------------------------------------------------------ */

export type PerquisiteSummary = {
  lines: PerquisiteLine[];
  totalPaise: Paise;
};

export function summarisePerquisites(
  lines: PerquisiteLine[],
): PerquisiteSummary {
  const kept = lines.filter((l) => l.valuePaise > 0);
  return {
    lines: kept,
    totalPaise: kept.reduce((a, l) => a + l.valuePaise, 0),
  };
}
