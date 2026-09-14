import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { authenticateApiRequest, unauthorized } from "@/lib/api/auth";

/**
 * GET /api/v1/payroll-runs — PRD §3.18.
 *
 * Status and period are metadata, not pay figures, so every key sees
 * them. Totals are figures — gated on `compensationScope` exactly as the
 * console gates them for a person.
 */
export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return unauthorized(auth.error);
  const { companyId, compensationScope } = auth.principal;

  const runs = await db
    .select()
    .from(s.payrollRuns)
    .where(eq(s.payrollRuns.companyId, companyId))
    .orderBy(desc(s.payrollRuns.periodYear), desc(s.payrollRuns.periodMonth), desc(s.payrollRuns.version))
    .limit(200);

  const data = await Promise.all(
    runs.map(async (run) => {
      let totals: { grossPaise: number; netPaise: number; employeeCount: number } | null = null;
      if (compensationScope === "company") {
        const summaries = await db
          .select()
          .from(s.payrollEmployeeSummaries)
          .where(eq(s.payrollEmployeeSummaries.runId, run.id));
        totals = {
          grossPaise: summaries.reduce((sum, r) => sum + r.grossPaise, 0),
          netPaise: summaries.reduce((sum, r) => sum + r.netPaise, 0),
          employeeCount: summaries.length,
        };
      }
      return {
        id: run.id,
        periodYear: run.periodYear,
        periodMonth: run.periodMonth,
        version: run.version,
        status: run.status,
        calculatedAt: run.calculatedAt,
        approvedAt: run.approvedAt,
        totals,
      };
    }),
  );

  return Response.json({ data });
}
