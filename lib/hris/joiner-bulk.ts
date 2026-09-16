import {
  normaliseMobile,
  MOBILE_RE,
  IDENTIFIER_MESSAGES as MSG,
} from "./identifiers";
import { parseFlexibleDate } from "../format/date";
import { EMPLOYMENT_TYPES, splitCsvLine, type RowProblem } from "./employee-bulk";

/**
 * Bulk onboarding — creating several joiner shells from a spreadsheet.
 *
 * A joiner is not an employee: this only writes the record onboarding
 * starts from — name, contact, the branch and role they are joining
 * into, when. Documents, the background check, the offer and statutory
 * enrolment still happen one person at a time, on their own onboarding
 * page, exactly as they do for someone added by hand. This exists for
 * the one thing typing does not scale to — twenty campus offers landing
 * the same week — not to skip any of the rest of the process.
 *
 * Unlike the employee import, a branch, department or grade the file
 * names but this company does not have is refused, not offered for
 * creation. An employee code is this company's own and typing it wrong
 * created a code, which is at least visible; a joiner has no code of
 * its own yet, and inventing a branch from a spreadsheet the day it is
 * uploaded is a worse mistake to make silently than asking first.
 */

export const JOINER_COLUMNS = [
  "firstName",
  "lastName",
  "personalEmail",
  "mobile",
  "designation",
  "branchCode",
  "departmentCode",
  "gradeName",
  "employmentType",
  "proposedDoj",
  "offeredCtc",
] as const;

export type JoinerRow = {
  line: number;
  firstName: string;
  lastName: string;
  personalEmail: string;
  mobile: string | null;
  designation: string | null;
  branchCode: string;
  departmentCode: string | null;
  gradeName: string | null;
  employmentType: (typeof EMPLOYMENT_TYPES)[number];
  proposedDoj: string;
  offeredCtc: number;
};

export type JoinerParseResult = {
  rows: JoinerRow[];
  problems: RowProblem[];
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseJoinerCsv(text: string): JoinerParseResult {
  const rows: JoinerRow[] = [];
  const problems: RowProblem[] = [];

  const lines = text.split(/\r\n|\r|\n/);
  const firstNonBlank = lines.findIndex((l) => l.trim() !== "");
  if (firstNonBlank < 0) {
    return { rows, problems: [{ line: 1, column: "", message: "The file is empty." }] };
  }

  const header = splitCsvLine(lines[firstNonBlank]).map((h) =>
    h.toLowerCase().replace(/[\s_]/g, ""),
  );
  const looksLikeHeader = header.includes("personalemail");
  if (!looksLikeHeader) {
    return {
      rows,
      problems: [
        {
          line: firstNonBlank + 1,
          column: "",
          message: `The first row must name the columns. Expected at least: ${JOINER_COLUMNS.slice(0, 3).join(", ")}…`,
        },
      ],
    };
  }

  const at = (name: string) => header.indexOf(name.toLowerCase().replace(/[\s_]/g, ""));

  const missingCols = (
    ["firstName", "lastName", "personalEmail", "branchCode", "proposedDoj"] as const
  ).filter((c) => at(c) < 0);
  if (missingCols.length > 0) {
    return {
      rows,
      problems: [
        {
          line: firstNonBlank + 1,
          column: missingCols.join(", "),
          message: `These required columns are missing: ${missingCols.join(", ")}.`,
        },
      ],
    };
  }

  const seenEmails = new Map<string, number>();

  for (let i = firstNonBlank + 1; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    if (lines[i].trimStart().startsWith("#")) continue;
    const line = i + 1;
    const cols = splitCsvLine(lines[i]);
    const get = (name: string) => {
      const idx = at(name);
      const v = idx >= 0 ? (cols[idx] ?? "").trim() : "";
      return v === "" ? null : v;
    };
    const problem = (column: string, message: string) => problems.push({ line, column, message });

    const firstName = get("firstName");
    const lastName = get("lastName");
    const personalEmail = get("personalEmail")?.toLowerCase() ?? null;
    const branchCode = get("branchCode")?.toUpperCase() ?? null;
    const proposedDojRaw = get("proposedDoj");
    const proposedDoj = proposedDojRaw ? parseFlexibleDate(proposedDojRaw) : null;

    if (!firstName) problem("firstName", "A first name is required.");
    if (!lastName) problem("lastName", "A last name is required.");
    if (!branchCode) problem("branchCode", "A branch code is required.");

    if (!personalEmail) {
      problem("personalEmail", "A personal email is required — it is where their onboarding portal link goes.");
    } else if (!EMAIL_RE.test(personalEmail)) {
      problem("personalEmail", `"${personalEmail}" is not an email address.`);
    } else {
      const earlier = seenEmails.get(personalEmail);
      if (earlier !== undefined) {
        problem("personalEmail", `"${personalEmail}" is already used on line ${earlier}.`);
      } else {
        seenEmails.set(personalEmail, line);
      }
    }

    if (!proposedDoj) {
      problem(
        "proposedDoj",
        `"${proposedDojRaw ?? ""}" is not a date. Use DD/MM/YYYY or YYYY-MM-DD.`,
      );
    }

    const mobileRaw = get("mobile");
    const mobile = normaliseMobile(mobileRaw);
    if (mobile && !MOBILE_RE.test(mobile)) problem("mobile", `"${mobile}" — ${MSG.mobile}`);

    const typeRaw = (get("employmentType") ?? "permanent").toLowerCase().replace(/\s+/g, "_");
    const employmentType = (EMPLOYMENT_TYPES as readonly string[]).includes(typeRaw)
      ? (typeRaw as JoinerRow["employmentType"])
      : null;
    if (!employmentType) {
      problem("employmentType", `"${typeRaw}" is not one of: ${EMPLOYMENT_TYPES.join(", ")}.`);
    }

    const ctcRaw = get("offeredCtc");
    let offeredCtc = 0;
    if (ctcRaw !== null) {
      const n = Number(ctcRaw.replace(/,/g, ""));
      if (!Number.isFinite(n) || n < 0) {
        problem("offeredCtc", `"${ctcRaw}" is not a number. Leave it blank if the offer is not decided yet.`);
      } else {
        offeredCtc = n;
      }
    }

    if (
      !firstName ||
      !lastName ||
      !personalEmail ||
      !EMAIL_RE.test(personalEmail) ||
      !branchCode ||
      !proposedDoj ||
      !employmentType
    ) {
      continue;
    }

    rows.push({
      line,
      firstName,
      lastName,
      personalEmail,
      mobile,
      designation: get("designation"),
      branchCode,
      departmentCode: get("departmentCode")?.toUpperCase() ?? null,
      gradeName: get("gradeName"),
      employmentType,
      proposedDoj,
      offeredCtc,
    });
  }

  if (rows.length === 0 && problems.length === 0) {
    problems.push({ line: 1, column: "", message: "The file has a header but no rows." });
  }

  return { rows, problems };
}

/**
 * Codes the file names that this company does not have. Every one is a
 * refusal here — see the module note on why this does not offer to
 * create them the way the employee import does.
 */
export function unresolvedJoinerReferences(
  rows: JoinerRow[],
  known: { branchCodes: string[]; departmentCodes: string[]; gradeNames: string[] },
): RowProblem[] {
  const branches = new Set(known.branchCodes.map((c) => c.toUpperCase()));
  const departments = new Set(known.departmentCodes.map((c) => c.toUpperCase()));
  const grades = new Set(known.gradeNames.map((g) => g.toLowerCase()));

  const out: RowProblem[] = [];
  for (const r of rows) {
    if (!branches.has(r.branchCode)) {
      out.push({
        line: r.line,
        column: "branchCode",
        message: `"${r.branchCode}" is not a branch this company has.`,
        fix: { label: "Add a branch", href: "/console/settings" },
      });
    }
    if (r.departmentCode && !departments.has(r.departmentCode)) {
      out.push({
        line: r.line,
        column: "departmentCode",
        message: `"${r.departmentCode}" is not a department this company has.`,
        fix: { label: "Add departments", href: "/console/settings/master-data?tab=org" },
      });
    }
    if (r.gradeName && !grades.has(r.gradeName.toLowerCase())) {
      out.push({
        line: r.line,
        column: "gradeName",
        message: `"${r.gradeName}" is not a grade this company has.`,
        fix: { label: "Add grades", href: "/console/settings/master-data?tab=org" },
      });
    }
  }
  return out;
}
