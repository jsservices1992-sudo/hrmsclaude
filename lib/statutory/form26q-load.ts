import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import {
  buildForm26q,
  QUARTER_MONTHS,
  type DeductionRow,
  type Form26qView,
  type Q,
} from "./form26q";

/**
 * Every non-salary deduction in one quarter, from the runs that have
 * actually been finalised. A draft is not a deduction and must not
 * appear in a return.
 */
export async function loadForm26q(args: {
  companyId: string;
  financialYear: number;
  quarter: Q;
}): Promise<Form26qView> {
  const months = QUARTER_MONTHS[args.quarter];
  const year =
    args.quarter === "Q4" ? args.financialYear + 1 : args.financialYear;

  const lines = await db
    .select({
      employeeId: s.payrollLines.employeeId,
      code: s.payrollLines.code,
      kind: s.payrollLines.kind,
      amountPaise: s.payrollLines.amountPaise,
      month: s.payrollRuns.periodMonth,
      empCode: s.employees.empCode,
      firstName: s.employees.firstName,
      lastName: s.employees.lastName,
      pan: s.employees.pan,
      paymentBasis: s.employees.paymentBasis,
    })
    .from(s.payrollLines)
    .innerJoin(s.payrollRuns, eq(s.payrollLines.runId, s.payrollRuns.id))
    .innerJoin(s.employees, eq(s.payrollLines.employeeId, s.employees.id))
    .where(
      and(
        eq(s.payrollRuns.companyId, args.companyId),
        eq(s.payrollRuns.periodYear, year),
        inArray(s.payrollRuns.periodMonth, months),
        inArray(s.payrollRuns.status, ["finalised", "disbursed", "closed"]),
        eq(s.employees.paymentBasis, "professional_fee"),
      ),
    );

  /* One row per payee per month: the fee and the tax deducted from it. */
  const byKey = new Map<string, DeductionRow>();
  for (const l of lines) {
    const isFee = l.code === "FEE" && l.kind === "earning";
    /* The section line is present even when nothing was deducted — a fee
       under the threshold is still a reportable payment, with nil tax.
       Reading the section off the line rather than only off a deduction
       is what keeps those payees in the return. */
    const isSection = l.code.startsWith("TDS_");
    const isTds = isSection && l.kind === "deduction";
    if (!isFee && !isSection) continue;

    const section = isSection ? l.code.slice(4) : "";
    const key = `${l.employeeId}|${l.month}`;
    const row = byKey.get(key) ?? {
      employeeId: l.employeeId,
      empCode: l.empCode,
      name: `${l.firstName} ${l.lastName}`,
      pan: l.pan,
      section: "",
      month: l.month,
      grossPaise: 0,
      tdsPaise: 0,
    };
    if (isFee) row.grossPaise += l.amountPaise;
    if (isTds) row.tdsPaise += l.amountPaise;
    if (isSection) row.section = section;
    byKey.set(key, row);
  }

  return buildForm26q({
    financialYear: args.financialYear,
    quarter: args.quarter,
    rows: [...byKey.values()],
  });
}
