import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { JOINER_COLUMNS } from "@/lib/hris/joiner-bulk";
import { EMPLOYMENT_TYPES } from "@/lib/hris/employee-bulk";
import { toCsv } from "@/lib/statutory/summaries";
import { getSessionUser, canAccessConsole, canAccessCompany } from "@/lib/auth/session";

/**
 * A starting file for bulk onboarding.
 *
 * Mirrors the employee import template: one worked example using codes
 * that actually exist here, commented out so the file imports cleanly
 * whether or not it is deleted, and a reference block of every valid
 * value underneath. Unlike that template, a code not on this list is
 * refused on upload rather than offered for creation — see
 * lib/hris/joiner-bulk.ts.
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
  const today = new Date().toISOString().slice(0, 10);

  const example = [
    "Asha", "Rao", "asha@example.com", "9876543210", "Software Engineer",
    firstBranch, firstDept, firstGrade, "permanent", today, "1200000",
  ];

  const lines = [
    toCsv([...JOINER_COLUMNS], []).trim(),
    `# example — delete this line or leave it, lines starting with # are ignored`,
    `#${example.join(",")}`,
    "",
    "# ---- valid values for this company ----",
    `# branchCode:      ${branches.length ? branches.map((b) => `${b.code} (${b.name})`).join(" | ") : "none yet — add one before importing"}`,
    `# departmentCode:  ${departments.length ? departments.map((d) => `${d.code} (${d.name})`).join(" | ") : "none yet — optional"}`,
    `# gradeName:       ${grades.length ? grades.map((g) => g.name).join(" | ") : "none yet — optional"}`,
    "#                  Unlike the employee template, a code not on this list is",
    "#                  refused on upload, not created for you — check spelling first.",
    `# employmentType:  ${EMPLOYMENT_TYPES.join(" | ")} — defaults to permanent if left blank`,
    "# dates:           YYYY-MM-DD",
    "# offeredCtc:      annual CTC in rupees — leave blank if the offer is not decided yet",
    "# required:        firstName, lastName, personalEmail, branchCode, proposedDoj",
    "# re-uploading:    safe — a personal email already invited is skipped, never",
    "#                  duplicated, so fill this in once and upload as you go.",
    "# after upload:    each joiner still needs documents, an offer and background",
    "#                  verification — nothing about the rest of onboarding is skipped.",
  ];

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="onboarding-import-template.csv"',
      "cache-control": "no-store",
    },
  });
}
