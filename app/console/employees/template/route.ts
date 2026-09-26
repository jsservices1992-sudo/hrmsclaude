import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import {
  EMPLOYEE_COLUMNS,
  GENDERS,
  EMPLOYMENT_TYPES,
  SKILL_CATEGORIES,
  PAY_MODES,
} from "@/lib/hris/employee-bulk";
import { toCsv } from "@/lib/statutory/summaries";

/** What each pay basis means, in the words the template can use. */
const BASIS_LABEL: Record<string, string> = {
  nth_only: "net in hand — no CTC on the payslip",
  gross: "gross salary",
  ctc: "cost to company, with employer contributions",
};
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
 *
 * The reference block lists what exists rather than what is allowed:
 * a code that is not on the list is offered for creation on upload, so
 * a company arriving from another system can put its own structure in
 * this one sheet instead of typing it into settings first.
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

  const [branches, departments, grades, structures] = await Promise.all([
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
    db
      .select({ name: s.salaryStructures.name, basis: s.salaryStructures.payBasis, isDefault: s.salaryStructures.isDefault })
      .from(s.salaryStructures)
      .where(and(eq(s.salaryStructures.companyId, companyId), eq(s.salaryStructures.active, true)))
      .orderBy(asc(s.salaryStructures.name)),
  ]);

  const firstBranch = branches[0]?.code ?? "BLR";
  const firstDept = departments[0]?.code ?? "";
  const firstGrade = grades[0]?.name ?? "";

  const example = [
    "EMP001", "Asha", "Rao", "asha@example.com", "9876543210", "female",
    "02/04/1995", "01/04/2026", "permanent", "Software Engineer",
    firstBranch, firstDept, firstGrade, "", "", "ABCPD1234E", "", "", "",
    "gross", "45000", structures.find((x) => x.isDefault)?.name ?? "",
    "no", "company", "", "", "0", "",
  ];

  const lines = [
    toCsv([...EMPLOYEE_COLUMNS], []).trim(),
    `# example — delete this line or leave it, lines starting with # are ignored`,
    `#${example.join(",")}`,
    "",
    "# ---- valid values for this company ----",
    `# branchCode:      ${branches.length ? branches.map((b) => `${b.code} (${b.name})`).join(" | ") : "none yet"}`,
    `# departmentCode:  ${departments.length ? departments.map((d) => `${d.code} (${d.name})`).join(" | ") : "none yet — optional"}`,
    `# gradeName:       ${grades.length ? grades.map((g) => g.name).join(" | ") : "none yet — optional"}`,
    "#                  Use your own codes if these are not yours — anything not",
    "#                  listed above is offered for creation when you upload.",
    `# gender:          ${GENDERS.join(" | ")}`,
    `# employmentType:  ${EMPLOYMENT_TYPES.join(" | ")} — contract means a fixed-term employee (FTE); fixed-term and fte are accepted too`,
    `# skillCategory:   ${SKILL_CATEGORIES.join(" | ")} — optional, only used to match a notified minimum wage`,
    "# dates:           DD/MM/YYYY (31/01/2026) — write dates this way",
    "# required:        empCode, firstName, lastName, dateOfJoining, branchCode, payMode, payAmount",
    "# managerEmpCode:  an existing employee, or another row in this file",
    "#",
    "# --- pay: gives this person a salary in the same upload, instead of a second file ---",
    `# payMode:          ${PAY_MODES.join(" | ")}`,
    "# payMode gross:         payAmount is the monthly gross, as it will appear on the payslip",
    "# payMode annual_gross:  payAmount is the annual gross, divided across twelve months",
    "# payMode ctc:           payAmount is the annual cost to company — PF, ESIC and gratuity are worked out on top of it",
    "# payMode take_home:     payAmount is the monthly net in hand — the gross is worked back from it, and re-solved every",
    "#                        run against that period's rates, so the amount reaching the bank never drifts",
    "# both columns must be filled in together, or both left blank to add this person with no salary yet",
    "#",
    "# --- EPF employee master — all optional ---",
    "# existingEpfMember:   yes | no — already an EPF member (a UAN also counts). A member stays in PF when pay rises past the ceiling",
    "# pfContributionBasis: company | ceiling | higher — statutory ceiling, or the higher actual wage; blank follows the company",
    "# epsApplicable:       yes | no — blank applies the statutory test (EPS stops at 58)",
    "# edliApplicable:      yes | no — blank is yes",
    "# employerNpsPercent:  0 to 14 — employer NPS as % of basic + DA; 0 or blank means none",
    "# pran:                12 digits — required when employerNpsPercent is above 0",
    "#",
    "# --- salaryStructure: which set of components this person is on ---",
    `# salaryStructure:  ${structures.length ? structures.map((x) => `${x.name} (${BASIS_LABEL[x.basis] ?? x.basis})`).join(" | ") : "none yet — leave blank"}`,
    "#                   Per person, not per department: one department can hold",
    "#                   two people on the statutory structure and six on a",
    "#                   net-in-hand one. Blank follows the department's",
    "#                   assignment, or the company default.",
    "#",
    "# re-uploading:    safe — an empCode already on the books is skipped, never",
    "#                  overwritten, so fill this in once and upload as you go.",
  ];

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="employee-import-template.csv"',
      "cache-control": "no-store",
    },
  });
}
