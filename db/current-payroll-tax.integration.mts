import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadWorksheetsFor } from "../lib/tax/load";
import { previewRun } from "../lib/payroll/load";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (url.hostname !== "127.0.0.1" || url.port !== "55439" || process.env.COMPLIANCE_TEST_FIXTURES !== "yes") {
  throw new Error("Current payroll tax integration requires the isolated compliance fixtures");
}
try {
  const fixture = JSON.parse(await readFile("/tmp/hrms-compliance-fixture.json", "utf8"));
  const period = { year: 2026, month: 9 };
  const override = (amountPaise: number) => new Map([[fixture.employeeId, {
    amountPaise, basicPaise: 1000000, hraPaise: 400000, employerPfPaise: 120000, employerNpsPaise: 0,
  }]]);
  const low = (await loadWorksheetsFor([fixture.employeeId], 2026, undefined, period, override(1000000))).get(fixture.employeeId)!;
  const high = (await loadWorksheetsFor([fixture.employeeId], 2026, undefined, period, override(3000000))).get(fixture.employeeId)!;
  assert.ok(low && high);
  assert.equal(high.annualGrossPaise - low.annualGrossPaise, 2000000, "One-off current earnings must not be annualised");
  const run = await previewRun({ companyId: fixture.companyId, ...period });
  assert.ok(run && run.results.length > 0);
  for (const result of run.results) {
    if (result.payeeClass === "professional") continue;
    const amount = (codes: string[]) => result.lines.filter(l => codes.includes(l.code)).reduce((sum, l) => sum + l.amountPaise, 0);
    const current = new Map([[result.employeeId, { amountPaise: result.grossPaise, basicPaise: amount(["BASIC", "DA", "VDA"]),
      hraPaise: amount(["HRA"]), employerPfPaise: amount(["EPF_ER", "EPS_ER"]), employerNpsPaise: amount(["NPS_ER"]) }]]);
    const worksheet = (await loadWorksheetsFor([result.employeeId], 2026, undefined, period, current)).get(result.employeeId)!;
    assert.ok(worksheet);
    if (worksheet.employee.tdsApplicability !== "no") assert.equal(amount(["TDS"]), worksheet.projection.monthlyTdsPaise);
    assert.equal(result.netPaise, result.grossPaise - result.deductionsPaise);
  }
  console.log("Current payroll tax integration passed: current earnings not annualised; payroll TDS agrees with actual current-period worksheet; net reconciles.");
} finally { await globalThis.__lekhaSql?.end(); }
