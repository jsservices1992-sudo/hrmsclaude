import type { Paise } from "./money";
import type { ExitType } from "../exit/notice";

/** Payment of Gratuity Act parameters, held as configuration. */
export type GratuityParams = {
  /** Qualifying continuous service, in years. */
  qualifyingYears: number;
  /** Days of wages per completed year. */
  daysPerYear: number;
  /** Divisor representing working days in a month. */
  monthDivisor: number;
  ceilingPaise: Paise;
  /** Exemption limit for tax purposes. */
  exemptionCeilingPaise: Paise;
};

export const GRATUITY_DEFAULTS: GratuityParams = {
  qualifyingYears: 5,
  daysPerYear: 15,
  monthDivisor: 26,
  ceilingPaise: 2_000_000_00, // ₹20,00,000
  exemptionCeilingPaise: 2_000_000_00,
};

export type GratuityResult = {
  eligible: boolean;
  completedYears: number;
  /** Years used in the formula, after the six-month rounding rule. */
  countedYears: number;
  lastDrawnWagePaise: Paise;
  grossPaise: Paise;
  cappedPaise: Paise;
  exemptPaise: Paise;
  taxablePaise: Paise;
  reason: string;
};

/**
 * Service in years, as a decimal. Uses whole days so a leap year does not
 * quietly change eligibility at the boundary.
 */
export function serviceYears(dateOfJoining: string, lastWorkingDay: string): number {
  const a = Date.parse(dateOfJoining + "T00:00:00Z");
  const b = Date.parse(lastWorkingDay + "T00:00:00Z");
  if (b < a) return 0;
  return (b - a) / (365.25 * 86_400_000);
}

/**
 * Gratuity = last drawn wages × 15/26 × completed years.
 * Six months or more of a part year rounds up — the rule that decides
 * whether someone at 4 years 7 months qualifies at all.
 */
export function computeGratuity(input: {
  dateOfJoining: string;
  lastWorkingDay: string;
  /** Basic + DA, monthly. */
  lastDrawnWagePaise: Paise;
  exitType: ExitType;
  params?: GratuityParams;
  /** Forfeiture requires an explicit, reasoned decision — never a default. */
  forfeited?: boolean;
  forfeitureReason?: string;
}): GratuityResult {
  const p = input.params ?? GRATUITY_DEFAULTS;
  const raw = serviceYears(input.dateOfJoining, input.lastWorkingDay);

  const whole = Math.floor(raw);
  const partYear = raw - whole;
  const countedYears = partYear >= 0.5 ? whole + 1 : whole;

  const empty = {
    completedYears: Number(raw.toFixed(2)),
    countedYears,
    lastDrawnWagePaise: input.lastDrawnWagePaise,
    grossPaise: 0,
    cappedPaise: 0,
    exemptPaise: 0,
    taxablePaise: 0,
  };

  if (input.forfeited) {
    return {
      eligible: false,
      ...empty,
      reason: input.forfeitureReason
        ? `Forfeited — ${input.forfeitureReason}`
        : "Forfeited",
    };
  }

  // The five-year qualifying period does not apply on death or disablement.
  const waivesQualifying = input.exitType === "death_in_service";

  if (!waivesQualifying && raw < p.qualifyingYears) {
    return {
      eligible: false,
      ...empty,
      reason: `Service of ${raw.toFixed(2)} years is below the ${p.qualifyingYears}-year qualifying period`,
    };
  }

  const gross = Math.round(
    (input.lastDrawnWagePaise * p.daysPerYear * countedYears) / p.monthDivisor,
  );
  const capped = Math.min(gross, p.ceilingPaise);
  const exempt = Math.min(capped, p.exemptionCeilingPaise);

  return {
    eligible: true,
    completedYears: Number(raw.toFixed(2)),
    countedYears,
    lastDrawnWagePaise: input.lastDrawnWagePaise,
    grossPaise: gross,
    cappedPaise: capped,
    exemptPaise: exempt,
    taxablePaise: Math.max(0, capped - exempt),
    reason: waivesQualifying
      ? "Qualifying period waived on death in service"
      : `${countedYears} counted years at ${p.daysPerYear}/${p.monthDivisor} of last drawn wages`,
  };
}

/* ==================================================================
   Leave encashment
   ================================================================== */

export type LeaveEncashmentResult = {
  days: number;
  perDayPaise: Paise;
  grossPaise: Paise;
  exemptPaise: Paise;
  taxablePaise: Paise;
  reason: string;
};

/**
 * On separation, leave encashment carries an exemption under section
 * 10(10AA). Omitting it overstates tax — the most common settlement defect.
 */
export function computeLeaveEncashment(input: {
  balanceDays: number;
  /** Basic + DA per day, per the company's encashment basis. */
  perDayPaise: Paise;
  exitType: ExitType;
  /** Statutory exemption ceiling for non-government employees. */
  exemptionCeilingPaise?: Paise;
  /** Only a retirement or resignation attracts the exemption. */
  isSeparation?: boolean;
}): LeaveEncashmentResult {
  const days = Math.max(0, input.balanceDays);
  const gross = Math.round(days * input.perDayPaise);

  const separation = input.isSeparation ?? true;
  const ceiling = input.exemptionCeilingPaise ?? 2_500_000_00; // ₹25,00,000

  const exempt = separation ? Math.min(gross, ceiling) : 0;

  return {
    days,
    perDayPaise: input.perDayPaise,
    grossPaise: gross,
    exemptPaise: exempt,
    taxablePaise: Math.max(0, gross - exempt),
    reason: separation
      ? "Exempt on separation under section 10(10AA), to the statutory ceiling"
      : "Encashment in service is fully taxable",
  };
}
