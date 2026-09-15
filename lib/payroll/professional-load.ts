import "server-only";
import { and, eq, inArray, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { TDS_NATURES, NO_PAN_RATE_KEY } from "../tax/tds-nonsalary";
import type { TdsRateConfig } from "./professional";
import type { Paise } from "./money";

/**
 * TDS rates and thresholds as at a date.
 *
 * Effective-dated like every other statutory figure, and read from the
 * same table the company can correct — a rate that changes mid-year
 * must not silently re-rate what was already deducted.
 */
export async function loadTdsRateConfig(asOf: string): Promise<TdsRateConfig> {
  const rows = await db.select().from(s.statutoryParams);
  const effective = rows.filter(
    (r) => r.effectiveFrom <= asOf && (r.effectiveTo === null || r.effectiveTo >= asOf),
  );
  const p = Object.fromEntries(effective.map((r) => [r.key, r.value]));

  const rateBpsByNature: Record<string, number> = {};
  const annualThresholdByNature: Record<string, Paise> = {};
  const singleThresholdByNature: Record<string, Paise> = {};

  for (const n of TDS_NATURES) {
    /* Deliberately not defaulted. A missing rate surfaces as a warning on
       the payslip and nothing deducted, which somebody notices; a
       plausible-looking default is a wrong deduction nobody notices. */
    if (p[n.rateKey] !== undefined) rateBpsByNature[n.nature] = p[n.rateKey];
    annualThresholdByNature[n.nature] = p[n.annualThresholdKey] ?? 0;
    if (n.singleThresholdKey) {
      singleThresholdByNature[n.nature] = p[n.singleThresholdKey] ?? 0;
    }
  }

  return {
    rateBpsByNature,
    annualThresholdByNature,
    singleThresholdByNature,
    noPanRateBps: p[NO_PAN_RATE_KEY] ?? 2000,
  };
}

export type FyToDate = { paidPaise: Paise; tdsPaise: Paise };

/**
 * What has already been paid to each professional this financial year,
 * and deducted from them.
 *
 * Both drive the next deduction: the threshold is a year figure, and
 * once it is crossed the tax is computed on the year and credited with
 * what has gone before. Only runs that have actually been finalised
 * count — a draft is not a payment, and counting one would deduct twice
 * when the draft is recalculated.
 */
export async function loadFyToDate(args: {
  companyId: string;
  employeeIds: string[];
  /** The year the financial year starts in — 2026 means FY 2026-27. */
  financialYear: number;
  /** Exclude the run being recomputed, so it does not count itself. */
  excludeRunId?: string | null;
}): Promise<Map<string, FyToDate>> {
  const out = new Map<string, FyToDate>();
  if (args.employeeIds.length === 0) return out;

  const rows = await db
    .select({
      employeeId: s.payrollLines.employeeId,
      code: s.payrollLines.code,
      kind: s.payrollLines.kind,
      amountPaise: s.payrollLines.amountPaise,
      runId: s.payrollLines.runId,
      periodYear: s.payrollRuns.periodYear,
      periodMonth: s.payrollRuns.periodMonth,
    })
    .from(s.payrollLines)
    .innerJoin(s.payrollRuns, eq(s.payrollLines.runId, s.payrollRuns.id))
    .where(
      and(
        eq(s.payrollRuns.companyId, args.companyId),
        inArray(s.payrollLines.employeeId, args.employeeIds),
        inArray(s.payrollRuns.status, ["finalised", "disbursed", "closed"]),
        /* Narrowed to the two calendar years the financial year spans;
           the months inside them are picked out below, because April to
           March is not a range either bound can express. */
        gte(s.payrollRuns.periodYear, args.financialYear),
        lte(s.payrollRuns.periodYear, args.financialYear + 1),
      ),
    );

  for (const r of rows) {
    if (args.excludeRunId && r.runId === args.excludeRunId) continue;
    const inFy =
      r.periodYear === args.financialYear
        ? r.periodMonth >= 4
        : r.periodMonth <= 3;
    if (!inFy) continue;
    const entry = out.get(r.employeeId) ?? { paidPaise: 0, tdsPaise: 0 };
    if (r.code === "FEE" && r.kind === "earning") entry.paidPaise += r.amountPaise;
    if (r.code.startsWith("TDS_") && r.kind === "deduction") {
      entry.tdsPaise += r.amountPaise;
    }
    out.set(r.employeeId, entry);
  }

  return out;
}
