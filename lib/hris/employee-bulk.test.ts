import test from "node:test";
import assert from "node:assert/strict";
import {
  parseEmployeeCsv,
  unresolvedReferences,
  missingReferences,
  splitCsvLine,
  EMPLOYEE_COLUMNS,
} from "./employee-bulk";

const HEADER = EMPLOYEE_COLUMNS.join(",");
const row = (over: Record<string, string> = {}) => {
  const base: Record<string, string> = {
    empCode: "BLR001", firstName: "Asha", lastName: "Rao", email: "asha@acme.in",
    mobile: "9876543210", gender: "female", dateOfBirth: "1995-04-02",
    dateOfJoining: "2026-01-15", employmentType: "permanent", designation: "Engineer",
    branchCode: "BLR", departmentCode: "ENG", gradeName: "L3", managerEmpCode: "", skillCategory: "",
    pan: "ABCPD1234E", uan: "100200300400", bankAccount: "50181003001", ifsc: "HDFC0001234",
    payMode: "", payAmount: "", salaryStructure: "",
  };
  return EMPLOYEE_COLUMNS.map((c) => over[c] ?? base[c]).join(",");
};
const csv = (...rows: string[]) => [HEADER, ...rows].join("\n");

const known = {
  branchCodes: ["BLR", "MUM"],
  departmentCodes: ["ENG", "FIN"],
  gradeNames: ["L3", "L4"],
  empCodes: ["BLR900"],
};

test("a clean file parses with nothing to report", () => {
  const r = parseEmployeeCsv(csv(row()));
  assert.deepEqual(r.problems, []);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].empCode, "BLR001");
  assert.equal(r.rows[0].gender, "female");
});

test("columns are matched by name, so order and spacing do not matter", () => {
  const text = "Last Name,emp_code,First Name,date_of_joining,BranchCode,PayMode,PayAmount\nRao,blr002,Asha,2026-01-15,blr,,";
  const r = parseEmployeeCsv(text);
  assert.deepEqual(r.problems, []);
  assert.equal(r.rows[0].empCode, "BLR002");
  assert.equal(r.rows[0].branchCode, "BLR");
});

test("a file with no header is refused rather than read as data", () => {
  const r = parseEmployeeCsv("BLR001,Asha,Rao,2026-01-15,BLR");
  assert.equal(r.rows.length, 0);
  assert.match(r.problems[0].message, /first row must name the columns/);
});

test("missing required columns are named, all at once", () => {
  const r = parseEmployeeCsv("empCode,firstName\nBLR001,Asha");
  assert.match(r.problems[0].message, /lastName/);
  assert.match(r.problems[0].message, /dateOfJoining/);
  assert.match(r.problems[0].message, /branchCode/);
});

test("every problem carries its line and column", () => {
  const r = parseEmployeeCsv(csv(row({ pan: "NOPE", mobile: "12345" })));
  const cols = r.problems.map((p) => p.column).sort();
  assert.deepEqual(cols, ["mobile", "pan"]);
  assert.ok(r.problems.every((p) => p.line === 2));
});

test("a duplicate code inside the file points at the first one", () => {
  const r = parseEmployeeCsv(csv(row(), row({ firstName: "Bala" })));
  const dup = r.problems.find((p) => p.column === "empCode");
  assert.match(dup!.message, /already used on line 2/);
});

test("optional fields may be blank, required ones may not", () => {
  const r = parseEmployeeCsv(
    csv(row({ email: "", mobile: "", pan: "", uan: "", bankAccount: "", ifsc: "", departmentCode: "", gradeName: "" })),
  );
  assert.deepEqual(r.problems, []);
  assert.equal(r.rows[0].email, null);
  assert.equal(r.rows[0].pan, null);
});

test("an account number without an IFSC cannot be paid into", () => {
  const r = parseEmployeeCsv(csv(row({ ifsc: "" })));
  assert.match(r.problems.find((p) => p.column === "ifsc")!.message, /cannot be paid into/);
});

test("mobile numbers are normalised the way people type them", () => {
  for (const typed of ["+91 98765 43210", "98765-43210", "9876543210"]) {
    const r = parseEmployeeCsv(csv(row({ mobile: typed })));
    assert.deepEqual(r.problems, [], typed);
    assert.equal(r.rows[0].mobile, "9876543210");
  }
});

test("a birth date on or after the joining date is caught", () => {
  const r = parseEmployeeCsv(csv(row({ dateOfBirth: "2026-06-01" })));
  assert.match(r.problems.find((p) => p.column === "dateOfBirth")!.message, /on or after the joining/);
});

test("quoted commas survive, which is how designations arrive", () => {
  assert.deepEqual(splitCsvLine('a,"b,c",d'), ["a", "b,c", "d"]);
  assert.deepEqual(splitCsvLine('a,"say ""hi""",c'), ["a", 'say "hi"', "c"]);
  const r = parseEmployeeCsv(csv(row({ designation: '"Engineer, Platform"' })));
  assert.equal(r.rows[0].designation, "Engineer, Platform");
});

test("an invalid row is excluded from rows, not half-imported", () => {
  const r = parseEmployeeCsv(csv(row(), row({ empCode: "BLR002", dateOfJoining: "not-a-date" })));
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].empCode, "BLR001");
});

test("a date of joining written day-first, the way it actually arrives, is accepted", () => {
  const r = parseEmployeeCsv(csv(row({ dateOfJoining: "15-01-2026" })));
  assert.deepEqual(r.problems, []);
  assert.equal(r.rows[0].dateOfJoining, "2026-01-15");
});

test("a date of birth written YYYY/MM/DD, the way one export writes it, is accepted", () => {
  const r = parseEmployeeCsv(csv(row({ dateOfBirth: "1995/04/02" })));
  assert.deepEqual(r.problems, []);
  assert.equal(r.rows[0].dateOfBirth, "1995-04-02");
});

test("a genuinely unparseable date is refused with a message naming both accepted forms", () => {
  const r = parseEmployeeCsv(csv(row({ dateOfJoining: "31/02/2026" })));
  assert.match(r.problems[0].message, /DD\/MM\/YYYY/);
  assert.match(r.problems[0].message, /YYYY-MM-DD/);
});

test("unknown branch, department and grade codes are reported by default", () => {
  const { rows } = parseEmployeeCsv(csv(row({ branchCode: "XXX", departmentCode: "ZZZ", gradeName: "L9" })));
  const problems = unresolvedReferences(rows, known);
  assert.deepEqual(problems.map((p) => p.column).sort(), ["branchCode", "departmentCode", "gradeName"]);
});

test("with createMissing they stop being problems, since they are about to exist", () => {
  const { rows } = parseEmployeeCsv(csv(row({ branchCode: "XXX", departmentCode: "ZZZ", gradeName: "L9" })));
  assert.deepEqual(unresolvedReferences(rows, known, { createMissing: true }), []);
});

test("a missing manager stays a problem even with createMissing", () => {
  const { rows } = parseEmployeeCsv(csv(row({ managerEmpCode: "GHOST" })));
  const problems = unresolvedReferences(rows, known, { createMissing: true });
  assert.equal(problems.length, 1);
  assert.equal(problems[0].column, "managerEmpCode");
});

test("missingReferences names what the file has and the company does not", () => {
  const { rows } = parseEmployeeCsv(
    csv(row({ branchCode: "GGN", departmentCode: "HR", gradeName: "L9" })),
  );
  assert.deepEqual(missingReferences(rows, known), {
    branches: ["GGN"],
    departments: ["HR"],
    grades: ["L9"],
  });
});

test("the same new code on eighty rows is one record to create, not eighty", () => {
  const { rows } = parseEmployeeCsv(
    csv(
      row({ empCode: "A1", branchCode: "GGN", gradeName: "L9" }),
      row({ empCode: "A2", branchCode: "GGN", gradeName: "l9" }),
      row({ empCode: "A3", branchCode: "BLR" }),
    ),
  );
  const missing = missingReferences(rows, known);
  assert.deepEqual(missing.branches, ["GGN"]);
  assert.deepEqual(missing.grades, ["L9"], "case does not make a second grade");
});

test("a code the company already has is not offered for creation", () => {
  const { rows } = parseEmployeeCsv(csv(row({ branchCode: "BLR", departmentCode: "ENG" })));
  assert.deepEqual(missingReferences(rows, known), {
    branches: [],
    departments: [],
    grades: [],
  });
});

test("a manager may be in the same file, so a team imports in one pass", () => {
  const { rows } = parseEmployeeCsv(
    csv(row({ empCode: "BLR001", managerEmpCode: "BLR002" }), row({ empCode: "BLR002" })),
  );
  assert.deepEqual(unresolvedReferences(rows, known), []);
});

test("a manager who exists nowhere is reported", () => {
  const { rows } = parseEmployeeCsv(csv(row({ managerEmpCode: "GHOST" })));
  const problems = unresolvedReferences(rows, known);
  assert.match(problems[0].message, /neither an existing employee nor in this file/);
});

test("nobody reports to themselves", () => {
  const { rows } = parseEmployeeCsv(csv(row({ empCode: "BLR001", managerEmpCode: "BLR001" })));
  const problems = unresolvedReferences(rows, known);
  assert.match(problems.find((p) => p.column === "managerEmpCode")!.message, /report to themselves/);
});

test("an empty file and a header-only file both say so", () => {
  assert.match(parseEmployeeCsv("").problems[0].message, /empty/);
  assert.match(parseEmployeeCsv(HEADER).problems[0].message, /no rows/);
});

test("the template's commented example and notes are ignored", () => {
  const text = [
    HEADER,
    "# example — delete this line or leave it",
    "#EMP001,Asha,Rao,,,female,,2026-04-01,permanent,,BLR,,,,,,,",
    "",
    "# ---- valid values ----",
    "# branchCode: BLR (Bengaluru)",
    row(),
  ].join("\n");
  const r = parseEmployeeCsv(text);
  assert.deepEqual(r.problems, []);
  assert.equal(r.rows.length, 1, "only the real row is imported");
  assert.equal(r.rows[0].empCode, "BLR001");
});

test("an unknown code says what the company does have", () => {
  const { rows } = parseEmployeeCsv(csv(row({ branchCode: "GGN", departmentCode: "HR" })));
  const problems = unresolvedReferences(rows, known);
  const branch = problems.find((p) => p.column === "branchCode")!;
  assert.match(branch.message, /BLR, MUM/, "names the codes that exist");
  assert.equal(branch.fix?.href, "/console/settings", "says where to add one");

  const dept = problems.find((p) => p.column === "departmentCode")!;
  assert.match(dept.message, /ENG, FIN/);
  assert.match(dept.message, /Leave the column blank|is not a department of this/);
});

test("a company with nothing configured says so, not 'it has: '", () => {
  const { rows } = parseEmployeeCsv(csv(row({ branchCode: "GGN", departmentCode: "HR", gradeName: "L9" })));
  const problems = unresolvedReferences(rows, {
    branchCodes: [], departmentCodes: [], gradeNames: [], empCodes: [],
  });
  assert.match(problems.find((p) => p.column === "branchCode")!.message, /has none yet/);
  assert.match(problems.find((p) => p.column === "departmentCode")!.message, /Leave the column blank/);
});

test("every unresolved reference carries a link to where it is created", () => {
  const { rows } = parseEmployeeCsv(csv(row({ branchCode: "GGN", departmentCode: "HR", gradeName: "L9" })));
  const problems = unresolvedReferences(rows, known);
  for (const p of problems) {
    assert.ok(p.fix?.href.startsWith("/console"), `${p.column} has no fix link`);
  }
});

/* -------------------------------- pay & skill -------------------------------- */

test("a row with no pay mode and no amount is accepted with no salary", () => {
  const r = parseEmployeeCsv(csv(row({ payMode: "", payAmount: "" })));
  assert.deepEqual(r.problems, []);
  assert.equal(r.rows[0].payMode, null);
  assert.equal(r.rows[0].payAmountPaise, null);
});

test("gross, CTC and take-home are all accepted pay modes", () => {
  for (const mode of ["gross", "annual_gross", "ctc", "take_home"]) {
    const r = parseEmployeeCsv(csv(row({ payMode: mode, payAmount: "50000" })));
    assert.deepEqual(r.problems, [], mode);
    assert.equal(r.rows[0].payMode, mode);
    assert.equal(r.rows[0].payAmountPaise, 50_00000);
  }
});

test("a comma-formatted amount is read the way a spreadsheet writes it", () => {
  const r = parseEmployeeCsv(csv(row({ payMode: "ctc", payAmount: '"12,00,000"' })));
  assert.deepEqual(r.problems, []);
  assert.equal(r.rows[0].payAmountPaise, 1_200_000_00);
});

test("an amount with no pay mode is refused, not guessed", () => {
  const r = parseEmployeeCsv(csv(row({ payMode: "", payAmount: "50000" })));
  assert.equal(r.rows.length, 0);
  assert.match(r.problems.find((p) => p.column === "payMode")!.message, /no pay mode/);
});

test("a pay mode with no amount is refused, not guessed", () => {
  const r = parseEmployeeCsv(csv(row({ payMode: "gross", payAmount: "" })));
  assert.equal(r.rows.length, 0);
  assert.match(r.problems.find((p) => p.column === "payAmount")!.message, /no amount is given/);
});

test("an unknown pay mode is reported by name", () => {
  const r = parseEmployeeCsv(csv(row({ payMode: "salary", payAmount: "50000" })));
  assert.match(r.problems.find((p) => p.column === "payMode")!.message, /gross, annual_gross, ctc, take_home/);
});

test("a zero or negative amount is refused", () => {
  for (const bad of ["0", "-500"]) {
    const r = parseEmployeeCsv(csv(row({ payMode: "gross", payAmount: bad })));
    assert.match(r.problems.find((p) => p.column === "payAmount")!.message, /positive amount/, bad);
  }
});

test("a file built from before the pay columns existed is refused by name", () => {
  const r = parseEmployeeCsv(
    "empCode,firstName,lastName,dateOfJoining,branchCode\nBLR001,Asha,Rao,2026-01-15,BLR",
  );
  assert.match(r.problems[0].message, /payMode/);
  assert.match(r.problems[0].message, /payAmount/);
  assert.match(r.problems[0].message, /older template/);
});

test("skill category is optional and validated against the same list minimum wage uses", () => {
  const clean = parseEmployeeCsv(csv(row({ skillCategory: "highly_skilled" })));
  assert.deepEqual(clean.problems, []);
  assert.equal(clean.rows[0].skillCategory, "highly_skilled");

  const blank = parseEmployeeCsv(csv(row({ skillCategory: "" })));
  assert.equal(blank.rows[0].skillCategory, null);

  const bad = parseEmployeeCsv(csv(row({ skillCategory: "expert" })));
  assert.match(bad.problems.find((p) => p.column === "skillCategory")!.message, /unskilled/);
});

test("a salary structure can be named per person in the file", () => {
  /* Per person, not per department: one department routinely holds two
     people on the statutory structure and six on a net-in-hand one. */
  const r = parseEmployeeCsv(
    csv(row({ salaryStructure: "Without PF" }), row({ empCode: "BLR002" })),
  );
  assert.deepEqual(r.problems, []);
  assert.equal(r.rows[0].salaryStructure, "Without PF");
  assert.equal(
    r.rows[1].salaryStructure,
    null,
    "blank follows the department's assignment, or the company default",
  );
});

test("an employee file carries the EPF master, and fixed-term is accepted by name", () => {
  const header = EMPLOYEE_COLUMNS.join(",");
  const base = ["E9", "Ravi", "K", "", "", "male", "", "01/04/2026", "Fixed-term (FTE)", "", "HQ", "", "", "", "", "", "", "", "", "gross", "30000", ""];
  const row = [...base, "yes", "higher", "no", "", "10", "110012345678"].join(",");
  const { rows, problems } = parseEmployeeCsv([header, row].join("\n"));
  assert.deepEqual(problems, []);
  assert.equal(rows[0].employmentType, "contract");
  assert.equal(rows[0].existingEpfMember, true);
  assert.equal(rows[0].pfContributionBasis, "higher");
  assert.equal(rows[0].epsApplicability, "no");
  assert.equal(rows[0].edliApplicability, "auto");
  assert.equal(rows[0].employerNpsBps, 1000);
});

test("an older file without the EPF columns still imports, on the automatic test", () => {
  const cols = EMPLOYEE_COLUMNS.slice(0, EMPLOYEE_COLUMNS.indexOf("existingEpfMember"));
  const row = ["E10", "Asha", "R", "", "", "female", "", "01/04/2026", "permanent", "", "HQ", "", "", "", "", "", "", "", "", "gross", "30000", ""].join(",");
  const { rows, problems } = parseEmployeeCsv([cols.join(","), row].join("\n"));
  assert.deepEqual(problems, []);
  assert.equal(rows[0].existingEpfMember, false);
  assert.equal(rows[0].pfContributionBasis, "company");
  assert.equal(rows[0].employerNpsBps, 0);
});
