import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { authenticateApiRequest, unauthorized } from "@/lib/api/auth";

/**
 * GET /api/v1/employees — PRD §3.18.
 *
 * Read-only, one company per key. Pay-adjacent fields (bank account, PAN,
 * UAN) are the same fields the console masks for a role with no
 * compensation scope, and follow the same rule here: a key without it
 * gets the roster, not the numbers.
 */
export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return unauthorized(auth.error);
  const { companyId, compensationScope } = auth.principal;

  const rows = await db
    .select()
    .from(s.employees)
    .where(eq(s.employees.companyId, companyId))
    .orderBy(desc(s.employees.dateOfJoining))
    .limit(500);

  return Response.json({
    data: rows.map((e) => ({
      id: e.id,
      empCode: e.empCode,
      name: `${e.firstName} ${e.lastName}`,
      email: e.email,
      designation: e.designation,
      departmentId: e.departmentId,
      status: e.status,
      dateOfJoining: e.dateOfJoining,
      dateOfExit: e.dateOfExit,
      pan: compensationScope === "company" ? e.pan : null,
      bankAccount: compensationScope === "company" ? e.bankAccount : null,
    })),
  });
}
