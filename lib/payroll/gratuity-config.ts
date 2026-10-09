import { GRATUITY_DEFAULTS, type GratuityParams } from "./gratuity";

export const GRATUITY_PARAM_KEYS = ["gratuity.qualifying_years", "gratuity.fixed_term_qualifying_years",
  "gratuity.days_per_year", "gratuity.month_divisor", "gratuity.ceiling_paise"] as const;

/** Values come from the effective-dated statutory parameter loader. */
export function gratuityParamsFrom(p: Record<string, number>): GratuityParams {
  const result = {
    qualifyingYears: p["gratuity.qualifying_years"] ?? GRATUITY_DEFAULTS.qualifyingYears,
    fixedTermQualifyingYears: p["gratuity.fixed_term_qualifying_years"] ?? GRATUITY_DEFAULTS.fixedTermQualifyingYears,
    daysPerYear: p["gratuity.days_per_year"] ?? GRATUITY_DEFAULTS.daysPerYear,
    monthDivisor: p["gratuity.month_divisor"] ?? GRATUITY_DEFAULTS.monthDivisor,
    ceilingPaise: p["gratuity.ceiling_paise"] ?? GRATUITY_DEFAULTS.ceilingPaise,
    exemptionCeilingPaise: GRATUITY_DEFAULTS.exemptionCeilingPaise,
  };
  if (Object.values(result).some(v => !Number.isSafeInteger(v) || v <= 0)) {
    throw new Error("Gratuity parameters must be positive whole numbers; review the effective statutory configuration.");
  }
  return result;
}
