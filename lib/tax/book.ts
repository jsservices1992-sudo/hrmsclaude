import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { tdsAllocations } from "@/db/compliance-schema";
import { TAX_CONFIG_VERSION } from "./config";

type Tx = Parameters<Parameters<typeof import("@/db").db.transaction>[0]>[0];

/** One source per deduction; payroll and separation can share a month. */
export async function bookPayrollTds(tx: Tx, run: {
  id: string; periodYear: number; periodMonth: number;
}) {
  const lines = await tx.select().from(s.payrollLines)
    .where(eq(s.payrollLines.runId, run.id));
  const summaries = await tx.select().from(s.payrollEmployeeSummaries)
    .where(eq(s.payrollEmployeeSummaries.runId, run.id));
  for (const summary of summaries) {
    const tdsPaise = lines.filter(l => l.employeeId === summary.employeeId && l.code === "TDS")
      .reduce((sum, l) => sum + l.amountPaise, 0);
    await tx.insert(s.tdsLedger).values({
      id: randomUUID(), employeeId: summary.employeeId,
      financialYear: run.periodMonth >= 4 ? run.periodYear : run.periodYear - 1,
      month: run.periodMonth, tdsPaise, sourceKey: `payroll:${run.id}`,
      configVersion: TAX_CONFIG_VERSION, runId: run.id,
      computedAt: new Date().toISOString(),
    }).onConflictDoUpdate({
      target: [s.tdsLedger.employeeId, s.tdsLedger.sourceKey],
      set: { tdsPaise, computedAt: new Date().toISOString() },
    });
  }
}

export async function reversePayrollTds(tx: Tx, runId: string) {
  const allocated = await tx.select({ id: tdsAllocations.id }).from(tdsAllocations)
    .innerJoin(s.tdsLedger, eq(s.tdsLedger.id, tdsAllocations.ledgerId)).where(eq(s.tdsLedger.runId, runId)).limit(1);
  if (allocated.length) throw new Error("TDS has been allocated to a deposited challan. Use a reviewed correction workflow before reopening this payroll.");
  await tx.delete(s.tdsLedger).where(eq(s.tdsLedger.runId, runId));
}
