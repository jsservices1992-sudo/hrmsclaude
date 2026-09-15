/**
 * Runs a real payroll for a hundred people and checks the answers.
 *
 * Not a unit test: it builds a company in the actual database, with
 * masters, salaries, attendance and exits, then calls the same
 * `previewRun` the console calls and reconciles what comes back. The
 * engine has never been exercised at this size, and every fault found
 * this session has been one that unit tests and a clean build could not
 * see.
 *
 * The company is prefixed ZZ AUDIT and deleted at the end, whatever
 * happens.
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as s from "./schema";
import { previewRun } from "../lib/payroll/load";
import { starterComponents, STARTER_STRUCTURE_NAME } from "../lib/payroll/starter-structure";

const URL_ = process.env.DATABASE_URL!;
const client = postgres(URL_, { max: 1, prepare: false, ssl: { rejectUnauthorized: false } });
const db = drizzle(client, { schema: s });

const YEAR = 2026;
const MONTH = 9; // September 2026 — 30 days
const companyId = randomUUID();
const now = new Date().toISOString();

type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
const check = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });

async function build() {
  await db.insert(s.companies).values({
    id: companyId, name: "ZZ AUDIT", legalName: "ZZ AUDIT", registeredStateCode: "KA",
    isDefault: false, active: true, prorationBasis: "calendar_days", standardDays: 26,
    roundingMode: "nearest", roundComponents: false, roundGross: false, roundNet: true,
    epfOnActualBasic: false, payDayConvention: "last_working_day", payDayOfMonth: 28,
    attendanceCutoffDay: 0, postCutoffTreatment: "lag_to_next",
    retroLopTreatment: "adjust_next_period", financialYearStartMonth: 4, createdAt: now,
  });

  const branches = [
    { id: randomUUID(), code: "BLR", name: "Bengaluru", stateCode: "KA" },
    { id: randomUUID(), code: "MUM", name: "Mumbai", stateCode: "MH" },
  ];
  await db.insert(s.branches).values(branches.map((b) => ({ ...b, companyId, esicImplementedArea: true, active: true })));

  const depts = ["ENG", "SALES", "HR", "OPS"].map((code) => ({ id: randomUUID(), companyId, code, name: code }));
  await db.insert(s.departments).values(depts);

  const grades = ["L1", "L2", "L3"].map((name, i) => ({ id: randomUUID(), companyId, name, level: i + 1 }));
  await db.insert(s.grades).values(grades);

  const components = starterComponents();
  await db.insert(s.payComponents).values(components.map((c) => ({ ...c, companyId })));
  const structureId = randomUUID();
  await db.insert(s.salaryStructures).values({
    id: structureId, companyId, name: STARTER_STRUCTURE_NAME, description: null,
    minBasicPercentOfGross: 40, gradeId: null, isDefault: true, active: true,
    effectiveFrom: "2020-04-01",
  });
  await db.insert(s.salaryStructureLines).values(components.map((c) => ({
    id: randomUUID(), structureId, componentId: c.id,
    calcMethodOverride: null, percentValueOverride: null, fixedPaiseOverride: null, sequence: c.sequence,
  })));

  /* A hundred people, deliberately awkward: two branches, four
     departments, salaries from ₹12k to ₹4L, a mid-month joiner, a
     mid-month leaver, somebody on heavy LOP, somebody with no salary
     at all, and somebody who joins after the period ends. */
  const employees: { id: string; empCode: string; gross: number; note: string }[] = [];
  const rows: (typeof s.employees.$inferInsert)[] = [];
  const salaries: (typeof s.employeeSalaries.$inferInsert)[] = [];

  for (let i = 1; i <= 100; i++) {
    const id = randomUUID();
    const empCode = `A${String(i).padStart(3, "0")}`;
    const gross = [12_000_00, 30_000_00, 45_000_00, 85_000_00, 400_000_00][i % 5];
    let dateOfJoining = "2022-04-01";
    let dateOfExit: string | null = null;
    let status: "active" | "resigned" | "exited" = "active";
    let note = "full month";

    if (i === 1) { dateOfJoining = "2026-09-16"; note = "joined mid-month"; }
    if (i === 2) { dateOfExit = "2026-09-10"; status = "resigned"; note = "left mid-month"; }
    if (i === 3) { note = "10 days LOP"; }
    if (i === 4) { note = "NO SALARY ROW"; }
    if (i === 5) { dateOfJoining = "2026-10-05"; note = "joins after the period"; }
    if (i === 6) { status = "exited"; dateOfExit = "2026-06-30"; note = "left months ago"; }

    rows.push({
      id, companyId, branchId: branches[i % 2].id, empCode,
      firstName: "Test", lastName: `Person${i}`,
      gender: i % 3 === 0 ? "female" : "male",
      dateOfJoining, dateOfExit, employmentType: "permanent",
      departmentId: depts[i % 4].id, gradeId: grades[i % 3].id,
      status, pfOptedIn: true, hadPriorPfMembership: i % 2 === 0,
      vpfPercent: 0, taxRegime: "new", createdBy: "audit",
    });
    if (i !== 4) {
      salaries.push({
        id: randomUUID(), employeeId: id, monthlyGrossPaise: gross, annualCtcPaise: null,
        structureId, effectiveFrom: "2022-04-01", effectiveTo: null,
        reason: "audit", revisionType: "initial", createdBy: "audit", createdAt: now,
      });
    }
    employees.push({ id, empCode, gross, note });
  }

  await db.insert(s.employees).values(rows);
  await db.insert(s.employeeSalaries).values(salaries);

  // Ten days of loss of pay for A003.
  await db.insert(s.attendanceInputs).values({
    id: randomUUID(), employeeId: employees[2].id, periodYear: YEAR, periodMonth: MONTH, lopDays: 10,
  });

  return employees;
}

async function cleanup() {
  const emps = await db.select({ id: s.employees.id }).from(s.employees).where(eq(s.employees.companyId, companyId));
  const ids = emps.map((e) => e.id);
  for (const id of ids) {
    await client`delete from attendance_inputs where employee_id = ${id}`;
    await client`delete from employee_salaries where employee_id = ${id}`;
  }
  await client`delete from employees where company_id = ${companyId}`;
  await client`delete from salary_structure_lines where structure_id in (select id from salary_structures where company_id = ${companyId})`;
  await client`delete from salary_structures where company_id = ${companyId}`;
  await client`delete from pay_components where company_id = ${companyId}`;
  await client`delete from grades where company_id = ${companyId}`;
  await client`delete from departments where company_id = ${companyId}`;
  await client`delete from branches where company_id = ${companyId}`;
  await client`delete from companies where id = ${companyId}`;
}

try {
  const employees = await build();
  const t0 = Date.now();
  const preview = await previewRun({ companyId, year: YEAR, month: MONTH });
  const ms = Date.now() - t0;
  if (!preview) throw new Error("previewRun returned null");

  const results = preview.results;
  const byCode = new Map(results.map((r) => [r.empCode, r]));
  const rs = (p: number) => (p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 });

  console.log(`\n  previewRun: ${results.length} results in ${ms}ms\n`);

  /* ---- golden cases ---- */
  const seeded = new Map(employees.map((e) => [e.empCode, e.gross]));
  const full = byCode.get("A010");
  const fullExpected = seeded.get("A010")!;
  check("full month pays the whole salary", full?.grossPaise === fullExpected,
    `A010 gross ${rs(full?.grossPaise ?? 0)} (expected ${rs(fullExpected)}), paidDays ${full?.paidDays}/${full?.totalDays}`);
  if (full && full.grossPaise !== fullExpected) {
    console.log("\n  A010 lines:");
    for (const l of full.lines) {
      console.log(`    ${l.kind.padEnd(22)} ${l.code.padEnd(10)} ${rs(l.amountPaise)}  ${l.basis ?? ""}`);
    }
    console.log("");
  }

  const lop = byCode.get("A003"); // ₹45,000, 10 LOP days in a 30-day month
  const expectedLop = Math.round((seeded.get("A003")! * 20) / 30);
  check("ten LOP days in a 30-day month pays 20/30", lop?.grossPaise === expectedLop,
    `A003 gross ${rs(lop?.grossPaise ?? 0)} (expected ${rs(expectedLop)}), paidDays ${lop?.paidDays}`);

  const joiner = byCode.get("A001"); // joined 16 Sep → 15 days of 30
  const expectedJoiner = Math.round((seeded.get("A001")! * 15) / 30);
  check("a mid-month joiner is paid from their joining day", joiner?.grossPaise === expectedJoiner,
    `A001 gross ${rs(joiner?.grossPaise ?? 0)} (expected ${rs(expectedJoiner)}), paidDays ${joiner?.paidDays}`);

  const leaver = byCode.get("A002"); // left 10 Sep → 10 days
  const expectedLeaver = Math.round((seeded.get("A002")! * 10) / 30);
  check("a mid-month leaver is paid to their last day", leaver?.grossPaise === expectedLeaver,
    `A002 gross ${rs(leaver?.grossPaise ?? 0)} (expected ${rs(expectedLeaver)}), paidDays ${leaver?.paidDays}`);

  /* ---- who is in the run ---- */
  check("somebody with no salary is not silently dropped",
    preview.excluded.some((e) => e.empCode === "A004"),
    `excluded: ${preview.excluded.map((e) => e.empCode).join(", ") || "none"}`);
  check("a future joiner is not paid", !byCode.has("A005"), "A005 joins 2026-10-05");
  check("somebody who left months ago is not paid", !byCode.has("A006"), "A006 exited 2026-06-30");

  /* ---- reconciliation ---- */
  const sum = (f: (r: (typeof results)[number]) => number) => results.reduce((a, r) => a + f(r), 0);
  const gross = sum((r) => r.grossPaise);
  const ded = sum((r) => r.deductionsPaise);
  const net = sum((r) => r.netPaise);
  check("gross minus deductions equals net, to the rupee", gross - ded === net,
    `gross ${rs(gross)} − deductions ${rs(ded)} = ${rs(gross - ded)}; engine net ${rs(net)}`);
  check("run totals match the sum of the lines",
    preview.totals.grossPaise === gross && preview.totals.netPaise === net,
    `totals gross ${rs(preview.totals.grossPaise)} net ${rs(preview.totals.netPaise)}`);
  check("nobody is paid a negative net", results.every((r) => r.netPaise >= 0),
    `${results.filter((r) => r.netPaise < 0).map((r) => r.empCode).join(", ") || "none negative"}`);
  check("every component sums to the stated gross",
    results.every((r) => r.lines.filter((l) => l.kind === "earning").reduce((a, l) => a + l.amountPaise, 0) === r.grossPaise),
    "checked on every employee");

  /* ---- statutory sanity ---- */
  const esicCovered = results.filter((r) => r.lines.some((l) => l.code === "ESIC_EE"));
  check("ESIC applies only below the wage threshold",
    esicCovered.every((r) => r.grossPaise <= 21_000_00),
    `${esicCovered.length} covered; max gross among them ${rs(Math.max(0, ...esicCovered.map((r) => r.grossPaise)))}`);

  check("a hundred employees price in under ten seconds", ms < 10_000, `${ms}ms`);

  console.log("  " + "-".repeat(76));
  for (const c of checks) {
    console.log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.name}\n        ${c.detail}`);
  }
  const failed = checks.filter((c) => !c.pass).length;
  console.log("  " + "-".repeat(76));
  console.log(`  ${checks.length - failed}/${checks.length} passed, ${failed} failed\n`);
} finally {
  await cleanup();
  const left = await client`select name from companies order by name`;
  console.log("  companies remaining:", left.map((c) => String(c.name)).join(", "));
  await client.end();
}
