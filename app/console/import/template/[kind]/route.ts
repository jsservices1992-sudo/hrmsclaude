import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { PAY_MODES } from "@/lib/payroll/pay-mode";
import { SALARY_COLUMNS } from "@/lib/hris/salary-bulk";
import { LEAVE_BALANCE_COLUMNS } from "@/lib/hris/leave-bulk";
import { getSessionUser, canAccessConsole, canAccessCompany } from "@/lib/auth/session";

/**
 * Templates pre-filled with this company's own employee codes.
 *
 * The codes are the part a person cannot supply from memory, and an
 * unknown one is the error the importer cannot do anything sensible
 * with. So the file arrives listing everyone who still needs the thing
 * being imported — a salary file lists only people who have none yet,
 * because a row for anyone else is skipped on the way in.
 */

/**
 * Suggested when a company has no leave types at all, so the file is
 * usable from a cold start rather than a bare header. They are names to
 * overwrite, not a policy: the import offers whatever this column ends
 * up saying for creation.
 */
const STARTER_LEAVE_TYPES = ["Earned Leave", "Casual Leave", "Sick Leave"];

export async function GET(
  request: Request,
  ctx: { params: Promise<{ kind: string }> },
) {
  const user = await getSessionUser();
  if (!user || !canAccessConsole(user)) {
    return new Response("Not authorised.", { status: 403 });
  }

  const { kind } = await ctx.params;
  const companyId = new URL(request.url).searchParams.get("company") ?? "";
  if (!canAccessCompany(user, companyId)) {
    return new Response("Not authorised.", { status: 403 });
  }

  const employees = await db
    .select({
      id: s.employees.id,
      empCode: s.employees.empCode,
      firstName: s.employees.firstName,
      lastName: s.employees.lastName,
    })
    .from(s.employees)
    .where(and(eq(s.employees.companyId, companyId), eq(s.employees.status, "active")))
    .orderBy(asc(s.employees.empCode));

  const today = new Date().toISOString().slice(0, 10);

  if (kind === "salary") {
    const salaried = await db
      .select({ employeeId: s.employeeSalaries.employeeId })
      .from(s.employeeSalaries);
    const has = new Set(salaried.map((r) => r.employeeId));
    const needing = employees.filter((e) => !has.has(e.id));

    const lines = [
      SALARY_COLUMNS.join(","),
      ...needing.map((e) => `${e.empCode},,,${today},Migrated from previous system`),
      "",
      "# ---- how to fill this in ----",
      `# amount:         the figure, e.g. 45000 or 1200000`,
      `# payMode:        what that figure is — ${PAY_MODES.join(" | ")}`,
      "#                 gross = monthly gross, annual_gross = a year of it,",
      "#                 ctc = annual cost to company, take_home = monthly in hand",
      "# effectiveFrom:  when this salary started. YYYY-MM-DD",
      needing.length === 0
        ? "# every active employee already has a salary — nothing to import"
        : `# ${needing.length} employee(s) listed have no salary yet`,
      "# re-uploading:   safe — anyone who already has a salary is skipped, never",
      "#                 overwritten. Change an existing salary from their record,",
      "#                 where it is versioned and keeps the old figure.",
    ];
    return csv(lines.join("\n"), "salary-import-template.csv");
  }

  if (kind === "leave") {
    const types = await db
      .select({ name: s.leaveTypes.name, code: s.leaveTypes.code })
      .from(s.leaveTypes)
      .where(eq(s.leaveTypes.companyId, companyId))
      .orderBy(asc(s.leaveTypes.name));
    const accruing = types.filter((t) => t.code !== "LOP");
    /* With no types configured, the sheet would otherwise be a header
       and nothing else — and the import can now create what this column
       names, so suggesting a set is more use than an empty file. */
    const names = accruing.length ? accruing.map((t) => t.name) : STARTER_LEAVE_TYPES;

    const rows: string[] = [];
    for (const e of employees) {
      for (const n of names) rows.push(`${e.empCode},${n},,${today}`);
    }

    const lines = [
      LEAVE_BALANCE_COLUMNS.join(","),
      ...rows,
      "",
      "# ---- how to fill this in ----",
      "# balanceDays:  days carried over, e.g. 12 or 18.5. Negative is allowed",
      "#               where someone has taken leave in advance.",
      "# asOf:         the date the balance was true. YYYY-MM-DD",
      `# leave types:  ${names.join(" | ")}`,
      ...(accruing.length
        ? ["#               Anything else you type here is offered for creation on upload."]
        : [
            "#               This company has none yet, so these are suggestions —",
            "#               rename them to whatever your old system called them and",
            "#               they are created when you upload.",
          ]),
      "# Delete any row you have no balance for; a blank balance is skipped.",
    ];
    return csv(lines.join("\n"), "leave-balance-template.csv");
  }

  return new Response("Unknown template.", { status: 404 });
}

function csv(body: string, filename: string) {
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
