import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { db } from "./index";
import * as s from "./schema";
import * as c from "./compliance-schema";
import { prepareBonus, prepareOvertime, prepareWorkerLeave, operationData } from "../lib/statutory/operations";

// Never seed payroll fixtures into a configured tenant or a normal local DB.
const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (url.hostname !== "127.0.0.1" || url.port !== "55439" || process.env.COMPLIANCE_TEST_FIXTURES !== "yes") {
  throw new Error("This integration test requires the isolated local test cluster on 127.0.0.1:55439 and COMPLIANCE_TEST_FIXTURES=yes");
}
const now = new Date().toISOString(), companyId = randomUUID(), employeeId = randomUUID(), branchId = randomUUID();
await db.insert(s.companies).values({ id: companyId, name: "Workflow Test Company", legalName: "Workflow Test Company", registeredStateCode: "UP", declaredHeadcount: 20, tan: "ABCD12345E", epfCoverage: "not_covered", esicCoverage: "not_covered", createdAt: now });
await db.insert(s.branches).values({ id: branchId, companyId, name: "Test branch", stateCode: "UP" });
await db.insert(s.employees).values({ id: employeeId, companyId, branchId, empCode: "WF001", firstName: "Workflow", lastName: "Employee", dateOfJoining: "2020-01-01", dateOfBirth: "1990-01-01", pan: "ABCPD1234F", uan: "123456789012", epsMember: false, epsJoiningWagePaise: 1500000, epsRevisionWagePaise: 2000000, skillCategory: "unskilled" });
await db.insert(s.employeeSalaries).values({ id: randomUUID(), employeeId, monthlyGrossPaise: 2000000, payMode: "gross", effectiveFrom: "2020-01-01", createdAt: now });
await db.insert(s.minimumWages).values({ id: randomUUID(), companyId, stateCode: "UP", zone: null, skillCategory: "unskilled", monthlyPaise: 1392100, effectiveFrom: "2020-01-01", verified: true, source: "TEST FIXTURE ONLY - not a notified UP wage" });
await db.insert(s.payComponents).values([{ id: randomUUID(), companyId, code: "BASIC", name: "Basic", kind: "earning", esicTreatment: "included" }, { id: randomUUID(), companyId, code: "HRA", name: "HRA", kind: "earning", esicTreatment: "excluded_50" }]);
const records: typeof s.attendanceRecords.$inferInsert[] = [];
for (const d = new Date("2025-01-01T00:00:00Z"); d.toISOString().slice(0, 10) <= "2026-09-30"; d.setUTCDate(d.getUTCDate() + 1)) {
  const date = d.toISOString().slice(0, 10), off = d.getUTCDay() === 0;
  records.push({ id: randomUUID(), employeeId, date, dayType: off ? "weekly_off" : "working", status: off ? "weekly_off" : "present", workedMinutes: off ? 0 : date >= "2026-09-01" ? 540 : 480 });
}
await db.insert(s.attendanceRecords).values(records);
await db.insert(c.complianceRegisters).values({ id: randomUUID(), companyId, employeeId, kind: "worker_coverage", sourceKey: `coverage:${employeeId}:2020-01-01`, periodYear: 2020, periodMonth: 1,
  status: "posted", snapshotJson: JSON.stringify({ effectiveFrom: "2020-01-01", leaveCovered: true, overtimeCovered: true, adolescentOrUnderground: false, classification: "TEST covered worker" }),
  evidence: "TEST reviewed coverage", preparedBy: "preparer@test.invalid", reviewedBy: "reviewer@test.invalid", preparedAt: now, postedAt: now });
await db.insert(s.leaveBalances).values({ id: randomUUID(), employeeId, leaveType: "EL", balanceDays: 48, encashable: true, asOf: "2025-12-31" });
for (let i = 0; i < 12; i++) {
  const month = (i + 3) % 12 + 1, year = month >= 4 ? 2025 : 2026, runId = randomUUID();
  const totalDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  await db.insert(s.payrollRuns).values({ id: runId, companyId, periodYear: year, periodMonth: month, version: 1, status: "approved", prorationBasis: "calendar_days", createdAt: now });
  await db.insert(s.payrollEmployeeSummaries).values({ id: randomUUID(), runId, employeeId, paidDays: totalDays, totalDays, grossPaise: 2000000, deductionsPaise: 0, employerCostPaise: 0, netPaise: 2000000 });
  await db.insert(s.payrollLines).values([{ id: randomUUID(), runId, employeeId, code: "BASIC", label: "Basic", kind: "earning", amountPaise: 1500000, esicTreatment: "included", basis: "Test fixture" }, { id: randomUUID(), runId, employeeId, code: "HRA", label: "HRA", kind: "earning", amountPaise: 500000, esicTreatment: "excluded_50", basis: "Test fixture" }]);
}
const ot = await prepareOvertime(companyId, employeeId, 2026, 9, 26);
assert.equal(ot.totalMinutes, 26 * 60); assert.equal(ot.amountPaise, 500000);
const bonus = await prepareBonus(companyId, 2025, 0);
assert.equal(bonus.awards[0].minimumPaise, 1392100);
assert.equal(bonus.surplus.payablePaise, 1392100);
assert.equal(bonus.dueOn, "2026-11-30");
const leave = await prepareWorkerLeave(companyId, employeeId, 2025, { qualifyingDeemedDays: 0, openingDays: 30, usedDays: 0, refusedDays: 5, policyEarnedDays: 18, policyCarryCap: 30, encashOnDemandDays: 0, dailyWagePaise: 100000 });
assert.equal(leave.carryDays, 35); assert.equal(leave.encashDays, 13);
const ledgerId = randomUUID();
await db.insert(s.tdsLedger).values({ id: ledgerId, employeeId, financialYear: 2026, month: 9, tdsPaise: 100000, sourceKey: `test:${randomUUID()}`, configVersion: "TEST", computedAt: now });
const sessions: string[] = [];
for (const name of ["Preparer", "Reviewer"]) {
  const id = randomUUID(), session = randomBytes(32).toString("hex"); sessions.push(session);
  await db.insert(s.users).values({ id, name, email: `${name.toLowerCase()}-${companyId}@test.invalid`, role: "admin", companyId, compensationScope: "company", passwordHash: "not-a-login-credential", active: true, createdAt: now });
  await db.insert(s.sessions).values({ id: session, userId: id, expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: now });
}
const data = await operationData(companyId, 2026, 9);
assert.equal(data.eps[0].transitionRequired, true);
assert.equal(data.eps[0].review, undefined);
await assert.rejects(() => db.insert(s.payrollAdjustments).values([
  { id: randomUUID(), employeeId, periodYear: 2026, periodMonth: 9, kind: "earning", code: "TEST", label: "TEST", amountPaise: 100, createdBy: "test", createdAt: now, sourceKey: "TEST_DUPLICATE" },
  { id: randomUUID(), employeeId, periodYear: 2026, periodMonth: 9, kind: "earning", code: "TEST", label: "TEST", amountPaise: 100, createdBy: "test", createdAt: now, sourceKey: "TEST_DUPLICATE" },
]));
assert.equal((await db.select().from(s.payrollAdjustments).where(and(eq(s.payrollAdjustments.employeeId, employeeId), eq(s.payrollAdjustments.sourceKey, "TEST_DUPLICATE")))).length, 0);
await writeFile("/tmp/hrms-compliance-fixture.json", JSON.stringify({ companyId, employeeId, ledgerId, sessions }));
await globalThis.__lekhaSql?.end();
console.log("Compliance integration passed: overtime, annual bonus, worker leave, EPS transition and duplicate-post uniqueness. Browser fixtures are confined to the isolated test database.");
