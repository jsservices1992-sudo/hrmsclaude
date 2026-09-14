import {
  normaliseMobile,
  normalisePan,
  normaliseUan,
  normaliseIfsc,
  normaliseBankAccount,
  MOBILE_RE,
  PAN_RE,
  UAN_RE,
  IFSC_RE,
  BANK_ACCOUNT_RE,
  IDENTIFIER_MESSAGES as MSG,
} from "./identifiers";

/**
 * Bulk employee import from a spreadsheet.
 *
 * Two decisions shape this.
 *
 * The file names things by the codes a person actually has in front of
 * them — a branch code, a department code, a grade name — never by
 * internal ids. Nobody has a UUID in their spreadsheet, and a column of
 * them is a column nobody can check.
 *
 * And the whole file is validated before anything is written. The
 * attendance import deliberately skips a bad row and carries on,
 * because a missing day is recoverable. Half an organisation is not:
 * the fix for eleven of thirty employees created is to work out which
 * eleven, and that is worse than being told to correct the file. So
 * every row is checked, every problem is reported with its line number,
 * and nothing is imported unless all of it can be.
 */

export const GENDERS = ["female", "male", "other"] as const;
export const EMPLOYMENT_TYPES = [
  "permanent",
  "probation",
  "contract",
  "intern",
  "consultant",
] as const;

/** The columns, in the order the template writes them. */
export const EMPLOYEE_COLUMNS = [
  "empCode",
  "firstName",
  "lastName",
  "email",
  "mobile",
  "gender",
  "dateOfBirth",
  "dateOfJoining",
  "employmentType",
  "designation",
  "branchCode",
  "departmentCode",
  "gradeName",
  "managerEmpCode",
  "pan",
  "uan",
  "bankAccount",
  "ifsc",
] as const;

export type EmployeeRow = {
  line: number;
  empCode: string;
  firstName: string;
  lastName: string;
  email: string | null;
  mobile: string | null;
  gender: (typeof GENDERS)[number];
  dateOfBirth: string | null;
  dateOfJoining: string;
  employmentType: (typeof EMPLOYMENT_TYPES)[number];
  designation: string | null;
  branchCode: string;
  departmentCode: string | null;
  gradeName: string | null;
  managerEmpCode: string | null;
  pan: string | null;
  uan: string | null;
  bankAccount: string | null;
  ifsc: string | null;
};

export type RowProblem = {
  line: number;
  column: string;
  message: string;
  /** Where to go and fix it, when the fix is elsewhere in the product. */
  fix?: { label: string; href: string };
};

/** Where each kind of reference is created. */
export const REFERENCE_FIXES = {
  branch: { label: "Add branches", href: "/console/settings" },
  department: { label: "Add departments", href: "/console/settings/master-data?tab=org" },
  grade: { label: "Add grades", href: "/console/settings/master-data?tab=org" },
} as const;

export type EmployeeParseResult = {
  rows: EmployeeRow[];
  problems: RowProblem[];
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Splits a CSV line, honouring double quotes around commas. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur.trim());
  return out;
}

export function parseEmployeeCsv(text: string): EmployeeParseResult {
  const rows: EmployeeRow[] = [];
  const problems: RowProblem[] = [];

  const lines = text.split(/\r\n|\r|\n/);
  const firstNonBlank = lines.findIndex((l) => l.trim() !== "");
  if (firstNonBlank < 0) {
    return { rows, problems: [{ line: 1, column: "", message: "The file is empty." }] };
  }

  /* The header is matched by name so a re-uploaded export still works,
     and so the columns can be in any order — a spreadsheet that has
     been through someone's hands rarely keeps the original order. */
  const header = splitCsvLine(lines[firstNonBlank]).map((h) =>
    h.toLowerCase().replace(/[\s_]/g, ""),
  );
  const looksLikeHeader = header.includes("empcode");
  if (!looksLikeHeader) {
    return {
      rows,
      problems: [
        {
          line: firstNonBlank + 1,
          column: "",
          message: `The first row must name the columns. Expected at least: ${EMPLOYEE_COLUMNS.slice(0, 3).join(", ")}…`,
        },
      ],
    };
  }

  const at = (name: string) =>
    header.indexOf(name.toLowerCase().replace(/[\s_]/g, ""));

  const missing = (["empCode", "firstName", "lastName", "dateOfJoining", "branchCode"] as const).filter(
    (c) => at(c) < 0,
  );
  if (missing.length > 0) {
    return {
      rows,
      problems: [
        {
          line: firstNonBlank + 1,
          column: missing.join(", "),
          message: `These required columns are missing: ${missing.join(", ")}.`,
        },
      ],
    };
  }

  const seen = new Map<string, number>();

  for (let i = firstNonBlank + 1; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    /* The template carries a commented example and a reference block,
       so the file imports cleanly whether or not they are deleted. */
    if (lines[i].trimStart().startsWith("#")) continue;
    const line = i + 1;
    const cols = splitCsvLine(lines[i]);
    const get = (name: string) => {
      const idx = at(name);
      const v = idx >= 0 ? (cols[idx] ?? "").trim() : "";
      return v === "" ? null : v;
    };
    const problem = (column: string, message: string) =>
      problems.push({ line, column, message });

    const empCode = get("empCode")?.toUpperCase() ?? null;
    const firstName = get("firstName");
    const lastName = get("lastName");
    const dateOfJoining = get("dateOfJoining");
    const branchCode = get("branchCode")?.toUpperCase() ?? null;

    if (!empCode) problem("empCode", "An employee code is required.");
    if (!firstName) problem("firstName", "A first name is required.");
    if (!lastName) problem("lastName", "A last name is required.");
    if (!branchCode) problem("branchCode", "A branch code is required.");

    if (empCode) {
      const earlier = seen.get(empCode);
      if (earlier !== undefined) {
        problem("empCode", `"${empCode}" is already used on line ${earlier}.`);
      } else {
        seen.set(empCode, line);
      }
    }

    if (!dateOfJoining || !DATE_RE.test(dateOfJoining)) {
      problem("dateOfJoining", `"${dateOfJoining ?? ""}" is not a date. Use YYYY-MM-DD.`);
    }

    const dateOfBirth = get("dateOfBirth");
    if (dateOfBirth && !DATE_RE.test(dateOfBirth)) {
      problem("dateOfBirth", `"${dateOfBirth}" is not a date. Use YYYY-MM-DD.`);
    }
    if (dateOfBirth && dateOfJoining && DATE_RE.test(dateOfJoining) && dateOfBirth >= dateOfJoining) {
      problem("dateOfBirth", "Date of birth is on or after the joining date.");
    }

    const genderRaw = get("gender")?.toLowerCase() ?? "other";
    const gender = (GENDERS as readonly string[]).includes(genderRaw)
      ? (genderRaw as EmployeeRow["gender"])
      : null;
    if (!gender) problem("gender", `"${genderRaw}" is not one of: ${GENDERS.join(", ")}.`);

    const typeRaw = (get("employmentType") ?? "permanent").toLowerCase().replace(/\s+/g, "_");
    const employmentType = (EMPLOYMENT_TYPES as readonly string[]).includes(typeRaw)
      ? (typeRaw as EmployeeRow["employmentType"])
      : null;
    if (!employmentType) {
      problem("employmentType", `"${typeRaw}" is not one of: ${EMPLOYMENT_TYPES.join(", ")}.`);
    }

    const email = get("email");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      problem("email", `"${email}" is not an email address.`);
    }

    /* Normalised the same way the console forms normalise them, so a
       number is held to one standard whichever door it came through. */
    const mobile = normaliseMobile(get("mobile"));
    if (mobile && !MOBILE_RE.test(mobile)) problem("mobile", `"${mobile}" — ${MSG.mobile}`);

    const pan = normalisePan(get("pan"));
    if (pan && !PAN_RE.test(pan)) problem("pan", `"${pan}" — ${MSG.pan}`);

    const uan = normaliseUan(get("uan"));
    if (uan && !UAN_RE.test(uan)) problem("uan", `"${uan}" — ${MSG.uan}`);

    const ifsc = normaliseIfsc(get("ifsc"));
    if (ifsc && !IFSC_RE.test(ifsc)) problem("ifsc", `"${ifsc}" — ${MSG.ifsc}`);

    const bankAccount = normaliseBankAccount(get("bankAccount"));
    if (bankAccount && !BANK_ACCOUNT_RE.test(bankAccount)) {
      problem("bankAccount", MSG.bankAccount);
    }
    if (bankAccount && !ifsc) problem("ifsc", MSG.ifscMissing);

    if (!empCode || !firstName || !lastName || !gender || !employmentType || !branchCode) continue;
    if (!dateOfJoining || !DATE_RE.test(dateOfJoining)) continue;

    rows.push({
      line,
      empCode,
      firstName,
      lastName,
      email,
      mobile,
      gender,
      dateOfBirth,
      dateOfJoining,
      employmentType,
      designation: get("designation"),
      branchCode,
      departmentCode: get("departmentCode")?.toUpperCase() ?? null,
      gradeName: get("gradeName"),
      managerEmpCode: get("managerEmpCode")?.toUpperCase() ?? null,
      pan,
      uan,
      bankAccount,
      ifsc,
    });
  }

  if (rows.length === 0 && problems.length === 0) {
    problems.push({ line: 1, column: "", message: "The file has a header but no rows." });
  }

  return { rows, problems };
}

export type MissingReferences = {
  branches: string[];
  departments: string[];
  grades: string[];
};

/**
 * Codes in the file that this company does not have yet.
 *
 * A company arriving from another system has its structure inside the
 * employee sheet and nowhere else — insisting every branch and
 * department be typed into settings first means transcribing the
 * spreadsheet by hand before being allowed to upload it. So these are
 * offered for creation instead.
 *
 * Offered, not created silently: `GGN` and `Gurgaon` in the same column
 * are one branch and one typo, and only the person with the file knows
 * which. The caller shows this list and creates them on a second,
 * deliberate submit.
 */
export function missingReferences(
  rows: EmployeeRow[],
  known: { branchCodes: string[]; departmentCodes: string[]; gradeNames: string[] },
): MissingReferences {
  const branches = new Set(known.branchCodes.map((c) => c.toUpperCase()));
  const departments = new Set(known.departmentCodes.map((c) => c.toUpperCase()));
  const grades = new Set(known.gradeNames.map((g) => g.toLowerCase()));

  /* Keyed by the matched form, valued by the spelling in the file, so
     the same code written twice creates one record. */
  const newBranches = new Map<string, string>();
  const newDepartments = new Map<string, string>();
  const newGrades = new Map<string, string>();

  for (const r of rows) {
    if (r.branchCode && !branches.has(r.branchCode)) newBranches.set(r.branchCode, r.branchCode);
    if (r.departmentCode && !departments.has(r.departmentCode)) {
      newDepartments.set(r.departmentCode, r.departmentCode);
    }
    /* The first spelling wins, so "L9" and "l9" further down the file
       are one grade rather than two that differ only in case. */
    if (r.gradeName && !grades.has(r.gradeName.toLowerCase())) {
      const key = r.gradeName.toLowerCase();
      if (!newGrades.has(key)) newGrades.set(key, r.gradeName);
    }
  }

  return {
    branches: [...newBranches.values()],
    departments: [...newDepartments.values()],
    grades: [...newGrades.values()],
  };
}

/**
 * Problems a person has to go and fix themselves.
 *
 * With `createMissing`, unknown branch, department and grade codes are
 * not problems — they are about to be created. What stays a problem
 * either way is a manager who is nowhere to be found: that names a real
 * person, and inventing one would be worse than the error.
 */
export function unresolvedReferences(
  rows: EmployeeRow[],
  known: {
    branchCodes: string[];
    departmentCodes: string[];
    gradeNames: string[];
    empCodes: string[];
  },
  opts: { createMissing?: boolean } = {},
): RowProblem[] {
  const problems: RowProblem[] = [];
  const branches = new Set(known.branchCodes.map((c) => c.toUpperCase()));
  const departments = new Set(known.departmentCodes.map((c) => c.toUpperCase()));
  const grades = new Set(known.gradeNames.map((g) => g.toLowerCase()));
  const existing = new Set(known.empCodes.map((c) => c.toUpperCase()));
  const inFile = new Set(rows.map((r) => r.empCode));

  for (const r of rows) {
    if (!opts.createMissing && !branches.has(r.branchCode)) {
      problems.push({
        line: r.line,
        column: "branchCode",
        message: known.branchCodes.length
          ? `"${r.branchCode}" is not a branch of this company. It has: ${known.branchCodes.join(", ")}.`
          : `"${r.branchCode}" is not a branch — this company has none yet.`,
        fix: REFERENCE_FIXES.branch,
      });
    }
    if (!opts.createMissing && r.departmentCode && !departments.has(r.departmentCode)) {
      problems.push({
        line: r.line,
        column: "departmentCode",
        message: known.departmentCodes.length
          ? `"${r.departmentCode}" is not a department of this company. It has: ${known.departmentCodes.join(", ")}.`
          : `"${r.departmentCode}" is not a department — this company has none yet. Leave the column blank to skip it.`,
        fix: REFERENCE_FIXES.department,
      });
    }
    if (!opts.createMissing && r.gradeName && !grades.has(r.gradeName.toLowerCase())) {
      problems.push({
        line: r.line,
        column: "gradeName",
        message: known.gradeNames.length
          ? `"${r.gradeName}" is not a grade of this company. It has: ${known.gradeNames.join(", ")}.`
          : `"${r.gradeName}" is not a grade — this company has none yet. Leave the column blank to skip it.`,
        fix: REFERENCE_FIXES.grade,
      });
    }
    /* A manager may be someone already on the books or someone further
       down the same file — a whole team imported at once is the normal
       case, and insisting the manager exist first would mean two passes. */
    if (
      r.managerEmpCode &&
      !existing.has(r.managerEmpCode) &&
      !inFile.has(r.managerEmpCode)
    ) {
      problems.push({
        line: r.line,
        column: "managerEmpCode",
        message: `"${r.managerEmpCode}" is neither an existing employee nor in this file.`,
      });
    }
    if (r.managerEmpCode === r.empCode) {
      problems.push({
        line: r.line,
        column: "managerEmpCode",
        message: "Someone cannot report to themselves.",
      });
    }
  }
  return problems;
}
