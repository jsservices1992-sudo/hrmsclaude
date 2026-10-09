import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { db } from "./index";
import * as s from "./schema";
import { loadCompanyTax, loadWorksheet } from "../lib/tax/load";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (url.hostname !== "127.0.0.1" || url.port !== "55439" || process.env.COMPLIANCE_TEST_FIXTURES !== "yes") {
  throw new Error("Tax register integration requires the isolated compliance test cluster and fixtures");
}
let queries = 0;
const client = postgres(url.href, { max: 1, prepare: false, debug: () => { queries++; } });
globalThis.__lekhaSql = client;
try {
  const fixture = JSON.parse(await readFile("/tmp/hrms-compliance-fixture.json", "utf8"));
  const [employee] = await db.select().from(s.employees).where(eq(s.employees.id, fixture.employeeId));
  const employeeId = randomUUID();
  await db.insert(s.employees).values({ ...employee, id: employeeId, empCode: `BATCH-${employeeId.slice(0, 8)}`, uan: null, pan: null });
  const [salary] = await db.select().from(s.employeeSalaries).where(eq(s.employeeSalaries.employeeId, employee.id));
  await db.insert(s.employeeSalaries).values({ ...salary, id: randomUUID(), employeeId });

  queries = 0;
  const register = await loadCompanyTax(fixture.companyId, 2026);
  const batchQueries = queries;
  queries = 0;
  for (const row of register.rows) {
    const worksheet = await loadWorksheet(row.employeeId, 2026);
    assert.ok(worksheet);
    assert.equal(row.annualTaxPaise, worksheet.annual.tax.totalTaxPaise);
    assert.equal(row.taxableIncomePaise, worksheet.annual.taxableIncomePaise);
    assert.equal(row.monthlyTdsPaise, worksheet.projection.monthlyTdsPaise);
    assert.equal(row.tdsToDatePaise, worksheet.tdsToDatePaise);
  }
  assert.ok(register.rows.length >= 2);
  assert.ok(batchQueries < queries, "Company register must batch employee worksheet queries");
  console.log(`Tax register integration passed: individual arithmetic matches; ${batchQueries} batch queries vs ${queries} repeated worksheet queries.`);
} finally { await client.end(); }
