import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { authenticateApiRequest, unauthorized } from "@/lib/api/auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ employeeId: string }> },
) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return unauthorized(auth.error);
  const { companyId, compensationScope } = auth.principal;
  const { employeeId } = await params;

  const [e] = await db.select().from(s.employees).where(eq(s.employees.id, employeeId)).limit(1);
  // A key scoped to another company gets the same 404 as a truly missing
  // id — confirming the id exists in someone else's company is itself a
  // company-boundary leak.
  if (!e || e.companyId !== companyId) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  return Response.json({
    data: {
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
      uan: compensationScope === "company" ? e.uan : null,
      bankAccount: compensationScope === "company" ? e.bankAccount : null,
    },
  });
}
