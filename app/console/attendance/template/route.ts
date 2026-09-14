import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { BULK_STATUSES } from "@/lib/attendance/bulk";
import { toCsv } from "@/lib/statutory/summaries";
import {
  getSessionUser,
  canAccessConsole,
  canAccessCompany,
} from "@/lib/auth/session";

/**
 * A starting file for the bulk attendance import, filled with this
 * company's real employee codes for the period asked for.
 *
 * A blank header row leaves the person to source thirty-odd employee
 * codes by hand, which is where the import actually goes wrong — an
 * unknown code is the one error the parser cannot do anything sensible
 * with. Every active employee is listed once, dated the first of the
 * month and marked present, so the file is edited rather than authored.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !canAccessConsole(user)) {
    return new Response("Not authorised.", { status: 403 });
  }

  const url = new URL(request.url);
  const companyId = url.searchParams.get("company") ?? "";
  const year = Number(url.searchParams.get("year"));
  const month = Number(url.searchParams.get("month"));

  if (!canAccessCompany(user, companyId)) {
    return new Response("Not authorised.", { status: 403 });
  }
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return new Response("A year and month are required.", { status: 400 });
  }

  const employees = await db
    .select({ empCode: s.employees.empCode })
    .from(s.employees)
    .where(and(eq(s.employees.companyId, companyId), eq(s.employees.status, "active")))
    .orderBy(asc(s.employees.empCode));

  const firstOfMonth = `${year}-${String(month).padStart(2, "0")}-01`;

  const csv = toCsv(
    ["empCode", "date", "status"],
    employees.map((e) => [e.empCode, firstOfMonth, "present"]),
  );

  const period = `${year}-${String(month).padStart(2, "0")}`;
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="attendance-template-${period}.csv"`,
      "cache-control": "no-store",
      // Not part of the file, but useful to anyone hitting this directly.
      "x-valid-status-values": BULK_STATUSES.join(", "),
    },
  });
}
