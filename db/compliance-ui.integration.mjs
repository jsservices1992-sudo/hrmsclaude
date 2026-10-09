import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const base = process.env.COMPLIANCE_TEST_URL;
if (base !== "http://localhost:3017") throw new Error("Browser integration requires the isolated local test server on port 3017");
const fixture = JSON.parse(await readFile("/tmp/hrms-compliance-fixture.json", "utf8"));
const browser = await chromium.launch({ headless: true });
const contexts = await Promise.all(fixture.sessions.map(async value => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: "lekha_session", value, url: base }]);
  return context;
}));
const pages = await Promise.all(contexts.map(c => c.newPage()));
const errors = [];
for (const p of pages) p.on("pageerror", e => errors.push(e.message));
const url = (tab, year = 2026, month = 9) => `${base}/console/statutory/operations?company=${fixture.companyId}&year=${year}&month=${month}&tab=${tab}`;
const form = (page, operation) => page.locator("form").filter({ has: page.locator(`input[name="operation"][value="${operation}"]`) });
async function save(page, operation, fields) {
  const f = form(page, operation);
  for (const [name, value] of Object.entries(fields)) {
    const input = f.locator(`[name="${name}"]`);
    if (await input.evaluate(e => e.type === "checkbox")) await input.setChecked(value);
    else if (await input.evaluate(e => e.tagName === "SELECT")) await input.selectOption(value);
    else await input.fill(value);
  }
  await f.locator('button[type="submit"]').click();
  await f.getByText("Saved on the audit record.").waitFor({ timeout: 20000 });
}
try {
  const page = pages[0];
  await page.goto(url("deposits"));
  await page.getByRole("heading", { name: "Compliance operations" }).waitFor();
  await save(page, "deposit", { scheme: "tds", amount: "1000", depositedOn: "2026-10-08", reference: "TEST-CIN-" + Date.now(), bsr: "1234567", serial: "00001", evidence: "TEST bank receipt and deposit evidence" });
  await page.reload();
  const allocation = form(page, "allocate");
  const depositId = await allocation.locator('select[name="depositId"] option').last().getAttribute("value");
  await save(page, "allocate", { depositId, ledgerId: fixture.ledgerId, amount: "1000", evidence: "TEST employee deduction to deposited challan" });
  // A repeated allocation must not exceed either side of the ledger.
  await allocation.locator('[name="depositId"]').selectOption(depositId);
  await allocation.locator('[name="ledgerId"]').selectOption(fixture.ledgerId);
  await allocation.locator('[name="evidence"]').fill("TEST duplicate allocation must be rejected");
  await allocation.locator('[name="amount"]').fill("1");
  await allocation.getByRole("button").click();
  await allocation.getByText("Allocation exceeds unallocated deposit or deduction").waitFor();
  await page.goto(url("overtime"));
  await save(page, "overtime", { employeeId: fixture.employeeId, divisor: "26", payoutYear: "2026", payoutMonth: "9", evidence: "TEST reviewed daily attendance and ordinary wage" });
  await page.reload();
  const detail = page.locator("details").filter({ hasText: "WF001" }).filter({ hasText: "2026/9" }).first();
  await detail.locator("summary").click();
  await detail.locator('input[name="evidence"]').fill("TEST independent reviewer checked overtime calculation");
  await detail.getByRole("button", { name: "Approve and post" }).click();
  await detail.getByText("A second reviewer must post this register").waitFor();
  const reviewer = pages[1];
  await reviewer.goto(url("overtime"));
  const reviewed = reviewer.locator("details").filter({ hasText: "WF001" }).filter({ hasText: "2026/9" }).first();
  await reviewed.locator("summary").click();
  await reviewed.locator('input[name="evidence"]').fill("TEST independent reviewer checked overtime calculation");
  await reviewed.getByRole("button", { name: "Approve and post" }).click();
  await reviewed.locator("summary").filter({ hasText: "posted" }).waitFor();
  await reviewer.reload();
  assert.equal(await reviewer.getByRole("button", { name: "Approve and post" }).count(), 0);
  async function review(tab, year, month, recordText) {
    await reviewer.goto(url(tab, year, month));
    const record = reviewer.locator("details").filter({ hasText: recordText }).filter({ hasText: "draft" }).first();
    await record.locator("summary").click();
    await record.locator('input[name="evidence"]').fill("TEST independent reviewer checked source evidence and award");
    await record.getByRole("button", { name: "Approve and post" }).click();
    await reviewer.locator("details").filter({ hasText: recordText }).locator("summary").filter({ hasText: "posted" }).first().waitFor();
  }
  await page.goto(url("eps"));
  await save(page, "eps_review", { employeeId: fixture.employeeId, portalReference: "TEST-EPFO-HISTORY", evidence: "TEST historical EPS enrolment and joining wage evidence" });
  await review("eps", 2026, 9, "WF001");
  await page.goto(url("bonus", 2025, 3));
  const bonusForm = form(page, "bonus");
  await bonusForm.getByRole("button", { name: "Add opening balance" }).click();
  await bonusForm.getByLabel("Origin year").fill("2024");
  await bonusForm.getByLabel("Amount (Rs)", { exact: true }).fill("100");
  assert.match(await bonusForm.locator('[name="openingCarryJson"]').inputValue(), /10000/);
  await bonusForm.getByRole("button", { name: "Remove", exact: true }).click();
  await save(page, "bonus", { allocable: "0", bonusApplicabilityReviewed: true, payoutYear: "2026", payoutMonth: "9", evidence: "TEST certified accounts, applicability and opening carry reviewed" });
  await review("bonus", 2025, 3, "bonus");
  await page.goto(url("leave", 2025, 12));
  await save(page, "worker_leave", { employeeId: fixture.employeeId, qualifyingDeemedDays: "0", openingDays: "30", usedDays: "0", refusedDays: "5", policyEarnedDays: "18", policyCarryCap: "30", encashOnDemandDays: "0", dailyWage: "1000", encashTreatment: "included", payoutYear: "2026", payoutMonth: "9", evidence: "TEST year-end opening balance, refused leave and statutory daily wage" });
  await review("leave", 2025, 12, "WF001");
  // All workflows render on desktop and mobile without page-level overflow.
  for (const tab of ["deposits", "eps", "bonus", "overtime", "leave", "notifications"]) {
    await page.goto(url(tab));
    await page.getByRole("heading", { name: "Compliance operations" }).waitFor();
    await page.screenshot({ path: `/tmp/hrms-compliance-${tab}-desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${tab} mobile overflow`);
    await page.screenshot({ path: `/tmp/hrms-compliance-${tab}-mobile.png`, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  const exportResponse = await contexts[0].request.get(`${base}/console/statutory/operations/export?company=${fixture.companyId}&year=2026&month=9&kind=eps`);
  assert.equal(exportResponse.status(), 200); assert.match(await exportResponse.text(), /WF001/);
  const denied = await contexts[0].request.get(`${base}/console/statutory/operations/export?company=not-authorised&year=2026&month=9&kind=eps`);
  assert.equal(denied.status(), 403);
  assert.deepEqual(errors, []);
  console.log("Browser integration passed: deposit, allocation limits, segregation of duties, overtime/bonus/leave/EPS posting, structured opening carry, authorised exports, six desktop/mobile tabs.");
} finally { await browser.close(); }
