import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { BULK_STATUSES } from "@/lib/attendance/bulk";
import { toCsv } from "@/lib/statutory/summaries";
import { daysInMonth } from "@/lib/payroll/proration";
import {
  getSessionUser,
  canAccessConsole,
  canAccessCompany,
} from "@/lib/auth/session";

/**
 * A starting file for the bulk attendance import, filled with this
 * company's real employee codes and every day of the period.
 *
 * A blank header row leaves the person to source thirty-odd employee
 * codes by hand, which is where the import actually goes wrong — an
 * unknown code is the one error the parser cannot do anything sensible
 * with. It used to carry one row per person, dated the first of the
 * month, which is not a register: somebody then typed the other thirty
 * days themselves, and the file the product promised to have "already
 * filled in" was ninety-seven per cent empty.
 *
 * Every active employee now gets every day of the month, marked present,
 * with the company's weekly offs and its holidays already written in. It
 * is edited, not authored: change the handful of days somebody was away
 * and upload it back.
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
    .select({
      empCode: s.employees.empCode,
      branchId: s.employees.branchId,
      dateOfJoining: s.employees.dateOfJoining,
      dateOfExit: s.employees.dateOfExit,
    })
    .from(s.employees)
    .where(and(eq(s.employees.companyId, companyId), eq(s.employees.status, "active")))
    .orderBy(asc(s.employees.empCode));

  const total = daysInMonth(year, month);
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateOf = (d: number) => `${year}-${pad(month)}-${pad(d)}`;

  /* The same source the derivation uses, so the template cannot say a
     day is a weekly off that the recompute then calls a working day.
     Stored as a comma-separated list of JavaScript weekday numbers. */
  const [shiftRow] = await db
    .select({ weeklyOffDays: s.shifts.weeklyOffDays })
    .from(s.shifts)
    .where(and(eq(s.shifts.companyId, companyId), eq(s.shifts.isDefault, true)))
    .limit(1);
  const weeklyOffs = (shiftRow?.weeklyOffDays ?? "0")
    .split(",")
    .map((x: string) => Number(x.trim()))
    .filter((x: number) => !Number.isNaN(x));

  const holidays = await db
    .select({ date: s.holidays.date, branchId: s.holidays.branchId })
    .from(s.holidays)
    .where(
      and(
        eq(s.holidays.companyId, companyId),
        gte(s.holidays.date, dateOf(1)),
        lte(s.holidays.date, dateOf(total)),
        eq(s.holidays.restricted, false),
      ),
    );

  const rows: string[][] = [];
  for (const e of employees) {
    for (let d = 1; d <= total; d++) {
      const date = dateOf(d);
      /* Days before they joined or after they left are left out entirely
         rather than marked absent — a file that says somebody was absent
         before their first day is a file somebody has to correct. */
      if (date < e.dateOfJoining) continue;
      if (e.dateOfExit && date > e.dateOfExit) continue;

      const holiday = holidays.some(
        (h) => h.date === date && (h.branchId === null || h.branchId === e.branchId),
      );
      const weekday = new Date(date + "T00:00:00Z").getUTCDay();
      const status = holiday
        ? "holiday"
        : weeklyOffs.includes(weekday)
          ? "weekly_off"
          : "present";
      rows.push([e.empCode, date, status]);
    }
  }

  const csv = toCsv(["empCode", "date", "status"], rows);

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
