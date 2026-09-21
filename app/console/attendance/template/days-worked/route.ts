import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { deriveMonth } from "@/lib/attendance/service";
import { toCsv } from "@/lib/statutory/summaries";
import { getSessionUser, canAccessConsole, canAccessCompany } from "@/lib/auth/session";
import { formatDate } from "@/lib/format/date";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * One line per person: how many days they worked.
 *
 * Two dozen lines instead of seven hundred, and every one of them
 * already filled in with the working days this month holds for that
 * person — a full month needs no editing at all, and a month where
 * somebody was away needs one number changed.
 *
 * The working-days column is there to be read, not filled: it is what
 * the number would be if they worked every day, and it already excludes
 * weekly offs, holidays, and the days before somebody joined.
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

  const [company] = await db
    .select({ name: s.companies.name })
    .from(s.companies)
    .where(eq(s.companies.id, companyId))
    .limit(1);

  const months = await deriveMonth({ companyId, year, month });
  const active = await db
    .select({ id: s.employees.id })
    .from(s.employees)
    .where(and(eq(s.employees.companyId, companyId), eq(s.employees.status, "active")));
  const activeIds = new Set(active.map((e) => e.id));

  const isOff = (status: string) => status === "weekly_off" || status === "holiday";

  const rows = months
    .filter((m) => activeIds.has(m.employeeId))
    .map((m) => {
      const workingDays = m.days.filter(
        (d) =>
          !isOff(d.status) &&
          d.date >= m.dateOfJoining &&
          (!m.dateOfExit || d.date <= m.dateOfExit),
      ).length;
      return [m.empCode, m.name, String(workingDays), String(workingDays), "0"];
    });

  const period = `${MONTHS[month - 1]} ${year}`;
  const lines = [
    toCsv(["empCode", "name", "workingDaysThisMonth", "daysWorked", "halfDays"], rows).trim(),
    "",
    `# ${company?.name ?? "This company"} — ${period}`,
    "#",
    "# Change the daysWorked column where somebody was away. Everything else",
    "# can be left as it is: the name and workingDaysThisMonth columns are",
    "# only there to read, and halfDays can stay at 0.",
    "#",
    "# workingDaysThisMonth already leaves out weekly offs, holidays and any",
    "# days before somebody joined — so a person who worked the whole month",
    "# keeps the number that is already in daysWorked, and is paid for the",
    "# whole month including the offs and the holiday.",
    "#",
    "# Days not worked become loss of pay. Do not add the weekly offs or the",
    "# holiday into daysWorked: they are paid without being counted.",
    `# Generated ${formatDate(new Date().toISOString().slice(0, 10))}.`,
  ];

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="days-worked-${year}-${String(month).padStart(2, "0")}.csv"`,
      "cache-control": "no-store",
    },
  });
}
