import { createHash } from "node:crypto";
import { z } from "zod";

const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const fnfTaxFactsSchema = z.object({
  gratuityBasis: z.enum(["s19_6", "s19_5"]),
  legalBasis: z.string().trim().min(20).max(4000),
  lastTaxSalaryPaise: money,
  gratuityAveragePaise: money,
  leaveAveragePaise: money,
  priorGratuityExemptPaise: money,
  priorLeaveExemptPaise: money,
  earnedLeaveDays: z.number().nonnegative().max(10000),
  leaveAvailedDays: z.number().nonnegative().max(10000),
  noticeDays: z.number().int().nonnegative().max(365),
  exemptAllowancesYtdPaise: money,
  professionalTaxYtdPaise: money,
  chapterViaPaise: money,
  newRegimeAllowedDeductionsPaise: money,
  otherTaxableYtdPaise: money,
}).strict();
export type FnfTaxFacts = z.infer<typeof fnfTaxFactsSchema>;

/** Hash source facts, never the review itself or a settlement's status. */
export function fnfReviewDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function parseFnfTaxFacts(json: string | null | undefined): FnfTaxFacts | null {
  try {
    const result = fnfTaxFactsSchema.safeParse(JSON.parse(json ?? "null"));
    return result.success ? result.data : null;
  } catch { return null; }
}

export function currentFnfReview(
  review: { factsJson: string; inputDigest: string } | null | undefined,
  inputDigest: string,
): FnfTaxFacts | null {
  return review?.inputDigest === inputDigest ? parseFnfTaxFacts(review.factsJson) : null;
}
