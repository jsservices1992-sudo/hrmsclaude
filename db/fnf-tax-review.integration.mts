import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { db } from "./index";
import * as s from "./schema";
import { fnfTaxReviews } from "./compliance-schema";
import { loadFnfCase } from "../lib/exit/fnf-load";
import { loadWorksheet } from "../lib/tax/load";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (url.hostname !== "127.0.0.1" || url.port !== "55439" || process.env.COMPLIANCE_TEST_FIXTURES !== "yes") {
  throw new Error("F&F integration requires the isolated compliance cluster and explicit test fixtures");
}
try {
  const fixture = JSON.parse(await readFile("/tmp/hrms-compliance-fixture.json", "utf8"));
  const exitCaseId = randomUUID();
  const now = new Date().toISOString();
  await db.update(s.payComponents).set({ calcMethod: "percent_of_gross", percentValue: 50, gratuityBase: true, epfBase: true })
    .where(and(eq(s.payComponents.companyId, fixture.companyId), eq(s.payComponents.code, "BASIC")));
  await db.update(s.payComponents).set({ calcMethod: "percent_of_basic", percentValue: 40 })
    .where(and(eq(s.payComponents.companyId, fixture.companyId), eq(s.payComponents.code, "HRA")));
  await db.insert(s.exitCases).values({ id: exitCaseId, employeeId: fixture.employeeId,
    exitType: "resignation", resignationDate: "2026-07-01", lastWorkingDay: "2026-09-30", createdAt: now });
  const runId = randomUUID();
  const priorRuns = await db.select().from(s.payrollRuns).where(and(eq(s.payrollRuns.companyId, fixture.companyId),
    eq(s.payrollRuns.periodYear, 2026), eq(s.payrollRuns.periodMonth, 9)));
  const version = Math.max(0, ...priorRuns.map(r => r.version)) + 1;
  await db.insert(s.payrollRuns).values({ id: runId, companyId: fixture.companyId, periodYear: 2026,
    periodMonth: 9, version, status: "approved", prorationBasis: "calendar_days", createdAt: now });
  await db.insert(s.payrollEmployeeSummaries).values({ id: randomUUID(), runId, employeeId: fixture.employeeId,
    paidDays: 30, totalDays: 30, grossPaise: 2000000, deductionsPaise: 0, employerCostPaise: 0, netPaise: 2000000 });
  const unreviewed = await loadFnfCase(exitCaseId);
  assert.ok(unreviewed);
  assert.equal(unreviewed.reviewReady, false);
  assert.equal(unreviewed.gate.canRelease, false);
  assert.equal(unreviewed.tax.totalExemptPaise, 0);
  const id = randomUUID();
  await db.insert(fnfTaxReviews).values({ id, exitCaseId, companyId: fixture.companyId,
    inputDigest: unreviewed.reviewInputDigest, evidence: "TEST salary history and statutory worksheets, leave ledger and notice contract",
    recordedBy: "test-reviewer@test.invalid", recordedAt: now,
    factsJson: JSON.stringify({ gratuityBasis: "s19_6", legalBasis: "TEST ONLY: conservative other-gratuity basis and reviewed eligible DA terms",
      lastTaxSalaryPaise: 1000000, gratuityAveragePaise: 900000, leaveAveragePaise: 950000,
      priorGratuityExemptPaise: 0, priorLeaveExemptPaise: 0, earnedLeaveDays: unreviewed.settlement.leaveEncashment.days,
      leaveAvailedDays: 100, noticeDays: 30, exemptAllowancesYtdPaise: 0, professionalTaxYtdPaise: 0,
      chapterViaPaise: 0, newRegimeAllowedDeductionsPaise: 0, otherTaxableYtdPaise: 0 }) });
  const reviewed = await loadFnfCase(exitCaseId);
  assert.ok(reviewed);
  assert.equal(reviewed.reviewReady, true);
  assert.equal(reviewed.gate.canRelease, true);
  assert.equal(reviewed.reviewInputDigest, unreviewed.reviewInputDigest);
  assert.equal(reviewed.settlement.lines.reduce((sum, line) => sum + (line.exemptPaise ?? 0), 0), reviewed.tax.totalExemptPaise);
  assert.ok(reviewed.tax.basis.includes(id));
  assert.ok(reviewed.tax.totalExemptPaise > 0);
  const appendOnly = (error: unknown) => (error as { cause?: { code?: string } }).cause?.code === "23001";
  await assert.rejects(db.update(fnfTaxReviews).set({ evidence: "changed" }).where(eq(fnfTaxReviews.id, id)), appendOnly);
  await assert.rejects(db.delete(fnfTaxReviews).where(eq(fnfTaxReviews.id, id)), appendOnly);
  await db.insert(s.loans).values({ id: randomUUID(), employeeId: fixture.employeeId, principalPaise: 100000,
    outstandingPaise: 100000, instalmentPaise: 10000, scheme: "TEST", tenureMonths: 10, startedOn: "2026-01-01" });
  const stale = await loadFnfCase(exitCaseId);
  assert.equal(stale?.reviewReady, false);
  assert.equal(stale?.gate.canRelease, false);
  const [original] = await db.select().from(s.employees).where(eq(s.employees.id, fixture.employeeId));
  const highPfId = randomUUID();
  await db.update(s.companies).set({ epfCoverage: "covered" }).where(eq(s.companies.id, fixture.companyId));
  await db.insert(s.employees).values({ ...original, id: highPfId, empCode: highPfId.slice(0, 8),
    uan: null, pan: null, dateOfExit: null, pfContributionBasis: "higher", pfOptedIn: true, employerNpsBps: 0 });
  await db.insert(s.employeeSalaries).values({ id: randomUUID(), employeeId: highPfId, monthlyGrossPaise: 300000000,
    payMode: "gross", effectiveFrom: "2020-01-01", createdAt: now });
  const highPf = await loadWorksheet(highPfId, 2026, undefined, { year: 2026, month: 10 });
  assert.ok(highPf);
  assert.ok(highPf.perquisites.lines.some(line => line.code === "RETIRAL" && line.valuePaise > 0),
    "High actual-wage PF must trigger excess-retiral perquisite even without NPS");
  await writeFile("/tmp/hrms-fnf-tax-fixture.json", JSON.stringify({ ...fixture, exitCaseId }));
  console.log("F&F integration passed: missing review blocks, current review opens gate, exemptions match, append-only evidence, changed inputs invalidate review.");
} finally { await globalThis.__lekhaSql?.end(); }
