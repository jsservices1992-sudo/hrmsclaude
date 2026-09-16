import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJoinerCsv, unresolvedJoinerReferences, JOINER_COLUMNS } from "./joiner-bulk";

const HEADER = JOINER_COLUMNS.join(",");

test("parses a well-formed row", () => {
  const csv = [
    HEADER,
    "Asha,Rao,asha@example.com,9876543210,Engineer,BLR,ENG,L2,permanent,2026-04-01,1200000",
  ].join("\n");
  const { rows, problems } = parseJoinerCsv(csv);
  assert.deepEqual(problems, []);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    line: 2,
    firstName: "Asha",
    lastName: "Rao",
    personalEmail: "asha@example.com",
    mobile: "9876543210",
    designation: "Engineer",
    branchCode: "BLR",
    departmentCode: "ENG",
    gradeName: "L2",
    employmentType: "permanent",
    proposedDoj: "2026-04-01",
    offeredCtc: 1200000,
  });
});

test("a commented example row is ignored, so the template imports cleanly untouched", () => {
  // A file that is only the header plus a commented example has no real
  // rows in it — the same "header but no rows" message an all-blank
  // upload gets, not an error about the comment itself.
  const csv = [HEADER, "# Asha,Rao,asha@example.com,,,BLR,,,,2026-04-01,"].join("\n");
  const { rows, problems } = parseJoinerCsv(csv);
  assert.deepEqual(rows, []);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /header but no rows/);
});

test("the required columns are firstName, lastName, personalEmail, branchCode and proposedDoj", () => {
  for (const [row, column] of [
    [",Rao,asha@example.com,,,BLR,,,,2026-04-01,", "firstName"],
    ["Asha,,asha@example.com,,,BLR,,,,2026-04-01,", "lastName"],
    ["Asha,Rao,,,,BLR,,,,2026-04-01,", "personalEmail"],
    ["Asha,Rao,asha@example.com,,,,,,,2026-04-01,", "branchCode"],
    ["Asha,Rao,asha@example.com,,,BLR,,,,,", "proposedDoj"],
  ] as const) {
    const { rows, problems } = parseJoinerCsv([HEADER, row].join("\n"));
    assert.equal(rows.length, 0, row);
    assert.ok(problems.some((p) => p.column === column), `${row} should flag ${column}`);
  }
});

test("mobile is checked against the same rule the console forms use", () => {
  const csv = [HEADER, "Asha,Rao,asha@example.com,12345,,BLR,,,,2026-04-01,"].join("\n");
  const { problems } = parseJoinerCsv(csv);
  assert.ok(problems.some((p) => p.column === "mobile"));
});

test("mobile with the printed spacing normalises the same as everywhere else it is typed", () => {
  const csv = [HEADER, "Asha,Rao,asha@example.com,+91 98765-43210,,BLR,,,,2026-04-01,"].join("\n");
  const { rows } = parseJoinerCsv(csv);
  assert.equal(rows[0]?.mobile, "9876543210");
});

test("employmentType defaults to permanent when left blank", () => {
  const csv = [HEADER, "Asha,Rao,asha@example.com,,,BLR,,,,2026-04-01,"].join("\n");
  const { rows } = parseJoinerCsv(csv);
  assert.equal(rows[0]?.employmentType, "permanent");
});

test("an unrecognised employment type is refused, not silently defaulted", () => {
  const csv = [HEADER, "Asha,Rao,asha@example.com,,,BLR,,,freelancer,2026-04-01,"].join("\n");
  const { rows, problems } = parseJoinerCsv(csv);
  assert.equal(rows.length, 0);
  assert.ok(problems.some((p) => p.column === "employmentType"));
});

test("offeredCtc is optional, and a comma-formatted figure is still read", () => {
  const csv = [HEADER, "Asha,Rao,asha@example.com,,,BLR,,,,2026-04-01,\"12,00,000\""].join("\n");
  const { rows } = parseJoinerCsv(csv);
  assert.equal(rows[0]?.offeredCtc, 1200000);
});

test("a negative or non-numeric offeredCtc is refused", () => {
  // The row still comes back — the action is what refuses to import
  // anything while `problems` is non-empty, the same as every other
  // format problem here.
  for (const bad of ["-5000", "not a number"]) {
    const csv = [HEADER, `Asha,Rao,asha@example.com,,,BLR,,,,2026-04-01,${bad}`].join("\n");
    const { problems } = parseJoinerCsv(csv);
    assert.ok(problems.some((p) => p.column === "offeredCtc"), bad);
  }
});

test("the same personal email twice in one file is flagged, so the whole file is refused rather than creating two joiners", () => {
  const csv = [
    HEADER,
    "Asha,Rao,asha@example.com,,,BLR,,,,2026-04-01,",
    "Asha,Rao2,ASHA@example.com,,,BLR,,,,2026-04-02,",
  ].join("\n");
  const { problems } = parseJoinerCsv(csv);
  assert.ok(problems.some((p) => p.column === "personalEmail" && /already used/.test(p.message)));
});

test("every problem carries the line it is on, so a large file points at exactly the row to fix", () => {
  const csv = [
    HEADER,
    "Asha,Rao,asha@example.com,,,BLR,,,,2026-04-01,",
    ",Kumar,bad,,,,,,,not-a-date,",
  ].join("\n");
  const { problems } = parseJoinerCsv(csv);
  assert.ok(problems.every((p) => p.line === 3));
});

test("proposedDoj written day-first, the way it actually arrives, is accepted", () => {
  const csv = [HEADER, "Asha,Rao,asha@example.com,,,BLR,,,,21/01/2026,"].join("\n");
  const { rows, problems } = parseJoinerCsv(csv);
  assert.deepEqual(problems, []);
  assert.equal(rows[0]?.proposedDoj, "2026-01-21");
});

test("proposedDoj written YYYY/MM/DD is also accepted", () => {
  const csv = [HEADER, "Asha,Rao,asha@example.com,,,BLR,,,,2026/01/21,"].join("\n");
  const { rows, problems } = parseJoinerCsv(csv);
  assert.deepEqual(problems, []);
  assert.equal(rows[0]?.proposedDoj, "2026-01-21");
});

test("a date that does not exist is refused, naming both accepted forms", () => {
  const csv = [HEADER, "Asha,Rao,asha@example.com,,,BLR,,,,31/02/2026,"].join("\n");
  const { problems } = parseJoinerCsv(csv);
  const p = problems.find((x) => x.column === "proposedDoj")!;
  assert.match(p.message, /DD\/MM\/YYYY/);
  assert.match(p.message, /YYYY-MM-DD/);
});

test("unresolved references refuse a code this company does not have, with where to add it", () => {
  const rows = parseJoinerCsv(
    [HEADER, "Asha,Rao,asha@example.com,,,GGN,ENG,L9,,2026-04-01,"].join("\n"),
  ).rows;
  const problems = unresolvedJoinerReferences(rows, {
    branchCodes: ["BLR"],
    departmentCodes: ["ENG"],
    gradeNames: ["L1"],
  });
  const byColumn = Object.fromEntries(problems.map((p) => [p.column, p]));
  assert.ok(byColumn.branchCode);
  assert.equal(byColumn.branchCode.fix?.href, "/console/settings");
  assert.ok(!byColumn.departmentCode, "ENG exists, so no problem for it");
  assert.ok(byColumn.gradeName);
});

test("a blank department or grade is never unresolved — both are optional", () => {
  const rows = parseJoinerCsv(
    [HEADER, "Asha,Rao,asha@example.com,,,BLR,,,,2026-04-01,"].join("\n"),
  ).rows;
  const problems = unresolvedJoinerReferences(rows, {
    branchCodes: ["BLR"],
    departmentCodes: [],
    gradeNames: [],
  });
  assert.deepEqual(problems, []);
});
