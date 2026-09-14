import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { authenticateApiRequest, unauthorized } from "@/lib/api/auth";

/** GET /api/v1/leave-requests?since=YYYY-MM-DD — PRD §3.18. Not compensation data, so it needs no elevated key scope. */
export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return unauthorized(auth.error);
  const { companyId } = auth.principal;

  const url = new URL(request.url);
  const since = url.searchParams.get("since");
  if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    return Response.json({ error: "`since` must be YYYY-MM-DD." }, { status: 400 });
  }

  const rows = await db
    .select({ req: s.leaveRequests, emp: s.employees })
    .from(s.leaveRequests)
    .innerJoin(s.employees, eq(s.leaveRequests.employeeId, s.employees.id))
    .where(
      and(
        eq(s.employees.companyId, companyId),
        since ? gte(s.leaveRequests.fromDate, since) : undefined,
      ),
    )
    .orderBy(desc(s.leaveRequests.createdAt))
    .limit(500);

  return Response.json({
    data: rows.map(({ req, emp }) => ({
      id: req.id,
      employeeId: emp.id,
      empCode: emp.empCode,
      leaveTypeId: req.leaveTypeId,
      fromDate: req.fromDate,
      toDate: req.toDate,
      days: req.days,
      lopDays: req.lopDays,
      status: req.status,
    })),
  });
}
