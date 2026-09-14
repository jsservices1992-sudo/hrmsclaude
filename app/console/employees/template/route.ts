import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { EMPLOYEE_COLUMNS, GENDERS, EMPLOYMENT_TYPES } from "@/lib/hris/employee-bulk";
import { toCsv } from "@/lib/statutory/summaries";
import { getSessionUser, canAccessConsole, canAccessCompany } from "@/lib/auth/session";

/**
 * A starting file for the bulk employee import.
 *
 * Not a bare header row. The codes the import resolves against —
 * branches, departments, grades — are this company's own, and a person
 * filling in a spreadsheet has no way to know them. So the file carries
 * one worked example using codes that actually exist here, and a
 * reference block listing every valid value underneath.
 *
 * The example row is commented out with a leading #, so the file
 * imports cleanly if someone fills in their own rows and forgets to
 * delete it.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !canAccessConsole(user)) {
    return new Response("Not authorised.", { status: 403 });
  }

  const url = new URL(request.url);
  const companyId = url.searchParams.get("company") ?? "";
  if (!canAccessCompany(user, companyId)) {
    return new Response("Not authorised.", { status: 403 });
  }

  const [branches, departments, grades] = await Promise.all([
    db
      .select({ code: s.branches.code, name: s.branches.name })
      .from(s.branches)
      .where(and(eq(s.branches.companyId, companyId), eq(s.branches.active, true)))
      .orderBy(asc(s.branches.code)),
    db
      .select({ code: s.departments.code, name: s.departments.name })
      .from(s.departments)
      .where(eq(s.departments.companyId, companyId))
      .orderBy(asc(s.departments.code)),
    db
      .select({ name: s.grades.name })
      .from(s.grades)
      .where(eq(s.grades.companyId, companyId))
      .orderBy(asc(s.grades.level)),
  ]);

  const firstBranch = branches[0]?.code ?? "BLR";
  const firstDept = departments[0]?.code ?? "";
  const firstGrade = grades[0]?.name ?? "";

  const example = [
    "EMP001", "Asha", "Rao", "asha@example.com", "9876543210", "female",
    "1995-04-02", "2026-04-01", "permanent", "Software Engineer",
    firstBranch, firstDept, firstGrade, "", "ABCPD1234E", "", "", "",
  ];

  const lines = [
    toCsv([...EMPLOYEE_COLUMNS], []).trim(),
    `# example — delete this line or leave it, lines starting with # are ignored`,
    `#${example.join(",")}`,
    "",
    "# ---- valid values for this company ----",
    `# branchCode:      ${branches.length ? branches.map((b) => `${b.code} (${b.name})`).join(" | ") : "none yet — add a branch first"}`,
    `# departmentCode:  ${departments.length ? departments.map((d) => `${d.code} (${d.name})`).join(" | ") : "none yet — optional"}`,
    `# gradeName:       ${grades.length ? grades.map((g) => g.name).join(" | ") : "none yet — optional"}`,
    `# gender:          ${GENDERS.join(" | ")}`,
    `# employmentType:  ${EMPLOYMENT_TYPES.join(" | ")}`,
    "# dates:           YYYY-MM-DD",
    "# required:        empCode, firstName, lastName, dateOfJoining, branchCode",
    "# managerEmpCode:  an existing employee, or another row in this file",
  ];

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="employee-import-template.csv"',
      "cache-control": "no-store",
    },
  });
}
