import type { Paise } from "./money";
import type { ExitType } from "../exit/notice";

/** Payment of Gratuity Act parameters, held as configuration. */
export type GratuityParams = {
  /** Qualifying continuous service, in years. */
  qualifyingYears: number;
  /** The shorter period fixed-term employment qualifies after. */
  fixedTermQualifyingYears: number;
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
  fixedTermQualifyingYears: 1,
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
 * Whole years of service, counted by anniversary.
 *
 * The decimal above divides by 365.25 so that leap years do not shift a
 * boundary, which is right for proportions and wrong for the question
 * "has this person completed five years" — an exact five calendar years
 * comes to 4.9993 and would be refused a day short of the anniversary
 * it actually fell on. Eligibility asks about anniversaries, so it is
 * counted in anniversaries.
 */
export function completedYears(dateOfJoining: string, lastWorkingDay: string): number {
  const from = new Date(dateOfJoining + "T00:00:00Z");
  const to = new Date(lastWorkingDay + "T00:00:00Z");
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return 0;

  let years = to.getUTCFullYear() - from.getUTCFullYear();
  const anniversary = Date.UTC(
    from.getUTCFullYear() + years,
    from.getUTCMonth(),
    from.getUTCDate(),
  );
  if (to.getTime() < anniversary) years -= 1;
  return Math.max(0, years);
}

/**
 * Gratuity = last drawn wages × 15/26 × completed years.
 * Six months or more of a part year rounds up — the rule that decides
 * whether someone at 4 years 7 months qualifies at all.
 */
/** Days served past the given completed-year anniversary, both ends counted. */
function daysBeyondAnniversary(dateOfJoining: string, lastWorkingDay: string, years: number): number {
  const from = new Date(dateOfJoining + "T00:00:00Z");
  const anniversary = Date.UTC(from.getUTCFullYear() + years, from.getUTCMonth(), from.getUTCDate());
  const to = Date.parse(lastWorkingDay + "T00:00:00Z");
  return Math.floor((to - anniversary) / 86_400_000) + 1;
}

export function computeGratuity(input: {
  dateOfJoining: string;
  lastWorkingDay: string;
  /** Basic + DA, monthly. */
  lastDrawnWagePaise: Paise;
  exitType: ExitType;
  params?: GratuityParams;
  /**
   * A fixed-term employee, who qualifies on a different footing.
   *
   * The labour codes give fixed-term employment gratuity pro rata after a
   * year, rather than nothing until five. Someone on a two-year term who
   * served it out would otherwise leave with nothing, which is the case
   * the provision exists to answer.
   */
  fixedTerm?: boolean;
  /**
   * Count 4 years and 240 days as five years' service. A company choice
   * made after legal review — some High Courts read s.2A this way, the
   * statute does not say it — so it is off unless turned on, and never
   * applies to fixed-term service, which has its own one-year rule.
   */
  fourYears240Days?: boolean;
  /** Forfeiture requires an explicit, reasoned decision — never a default. */
  forfeited?: boolean;
  forfeitureReason?: string;
}): GratuityResult {
  const p = input.params ?? GRATUITY_DEFAULTS;
  const raw = serviceYears(input.dateOfJoining, input.lastWorkingDay);

  const whole = Math.floor(raw);
  const partYear = raw - whole;
  /*
   * Pro rata means proportionate, so a fixed-term term is counted as it
   * was actually served. Rounding a part year up is the rule for regular
   * service and would overpay here — and rounding it down would be the
   * same error in the other direction.
   */
  const countedYears = input.fixedTerm
    ? Number(raw.toFixed(4))
    : partYear >= 0.5
      ? whole + 1
      : whole;

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
  /* Payment of Gratuity Act s.4(1) proviso, carried into the Code on
     Social Security s.53(1): five years' continuous service is not
     required where employment ends on death or disablement due to
     accident or disease. */
  const waivesQualifying =
    input.exitType === "death_in_service" || input.exitType === "disablement";
  const qualifying = input.fixedTerm
    ? p.fixedTermQualifyingYears
    : p.qualifyingYears;

  const completed = completedYears(input.dateOfJoining, input.lastWorkingDay);
  const via240 =
    !input.fixedTerm &&
    input.fourYears240Days === true &&
    completed === qualifying - 1 &&
    daysBeyondAnniversary(input.dateOfJoining, input.lastWorkingDay, completed) >= 240;

  if (!waivesQualifying && !via240 && completed < qualifying) {
    return {
      eligible: false,
      ...empty,
      reason: input.fixedTerm
        ? `Fixed-term service of ${raw.toFixed(2)} years is below the ${qualifying}-year qualifying period`
        : `Service of ${raw.toFixed(2)} years is below the ${qualifying}-year qualifying period`,
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
    reason: via240
      ? `${countedYears} counted years — 4 years and 240 days treated as five under the company's legal-review setting`
      : input.fixedTerm
      ? `Fixed-term employment: ${countedYears} years pro rata at ${p.daysPerYear}/${p.monthDivisor} of last drawn wages (one-year qualifying period)`
      : waivesQualifying
      ? input.exitType === "disablement"
        ? "Qualifying period waived on disablement"
        : "Qualifying period waived on death in service"
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
