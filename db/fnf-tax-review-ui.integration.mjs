import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const base = process.env.COMPLIANCE_TEST_URL;
if (base !== "http://localhost:3017") throw new Error("F&F browser tests require the isolated server on port 3017");
const fixture = JSON.parse(await readFile("/tmp/hrms-fnf-tax-fixture.json", "utf8"));
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const contexts = await Promise.all(fixture.sessions.map(async value => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies([{ name: "lekha_session", value, url: base }]);
    return context;
  }));
  const [page, reviewer] = await Promise.all(contexts.map(c => c.newPage()));
  page.on("pageerror", e => errors.push(e.message));
  reviewer.on("pageerror", e => errors.push(e.message));
  const url = `${base}/console/exits/${fixture.exitCaseId}/settlement`;
  assert.equal((await page.goto(url)).status(), 200);
  await page.getByRole("heading", { name: "Separation tax & notice review" }).waitFor();
  const review = page.locator("form").filter({ has: page.locator('input[name="inputDigest"]') });
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "Settlement mobile overflow");
    await review.screenshot({ path: `/tmp/hrms-fnf-review-${viewport.width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const [name, value] of Object.entries({ lastTaxSalaryPaise: "10000", gratuityAveragePaise: "9000", leaveAveragePaise: "9500",
    priorGratuityExemptPaise: "0", priorLeaveExemptPaise: "0", earnedLeaveDays: "20", leaveAvailedDays: "100", noticeDays: "30",
    exemptAllowancesYtdPaise: "0", professionalTaxYtdPaise: "0", chapterViaPaise: "0", newRegimeAllowedDeductionsPaise: "0", otherTaxableYtdPaise: "0",
    legalBasis: "TEST ONLY: independently reviewed Section 19 Sl. 6 basis and salary/DA terms",
    evidence: "TEST ONLY: salary-history worksheet, earned-leave ledger, previous employer declarations and notice contract" })) {
    await review.locator(`[name="${name}"]`).fill(value);
  }
  await review.getByRole("button", { name: "Record reviewed facts" }).click();
  await page.getByText("Review recorded. Compute and save the settlement before second-person release.").waitFor();
  await page.getByRole("button", { name: "Compute & save settlement" }).click();
  await page.getByText(/^Prepared\./).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Approve & release" }).click();
  await page.getByText(/You prepared this settlement/).waitFor();
  await reviewer.goto(url);
  await reviewer.getByRole("button", { name: "Approve & release" }).click();
  try { await reviewer.getByRole("button", { name: "Record payment" }).waitFor({ timeout: 5000 }); }
  catch (error) {
    console.log("Release form feedback:", await reviewer.locator("form").filter({ has: reviewer.getByRole("button", { name: "Approve & release" }) }).innerText());
    throw error;
  }
  const payout = await contexts[1].request.get(`${base}/console/exits/${fixture.exitCaseId}/payout`);
  assert.equal(payout.status(), 409, "The test tenant has no salary bank; export must fail safely");
  assert.match(await payout.text(), /salary bank account/);
  const payment = reviewer.locator("form").filter({ has: reviewer.getByRole("button", { name: "Record payment" }) });
  await payment.locator('[name="paidAt"]').fill(new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10));
  await payment.locator('[name="reference"]').fill("TEST-NO-TRANSFER-" + Date.now());
  await payment.getByRole("button", { name: "Record payment" }).click();
  await reviewer.waitForFunction(() => ![...document.querySelectorAll('button')].some(button => button.textContent.trim() === "Record payment"));
  const afterPayment = await contexts[1].request.get(`${base}/console/exits/${fixture.exitCaseId}/payout`);
  assert.equal(afterPayment.status(), 409, "A paid settlement must not produce another payout file");
  assert.match(await afterPayment.text(), /unpaid/);
  for (const path of ["/console", "/console/employees", "/console/attendance", "/console/payroll", "/console/tax",
    "/console/statutory", "/console/banking", "/console/exits", "/console/loans", "/console/assets", "/console/settings/payroll", "/console/compliance"]) {
    const response = await contexts[0].request.get(`${base}${path}?company=${fixture.companyId}&year=2026&month=9`);
    assert.equal(response.status(), 200, `${path} did not load`);
    assert.doesNotMatch(await response.text(), /This page could not load/, `${path} reached the error boundary`);
  }
  for (const tab of ["deposits", "eps", "bonus", "overtime", "leave", "notifications"]) {
    const response = await contexts[0].request.get(`${base}/console/statutory/operations?company=${fixture.companyId}&year=2026&month=9&tab=${tab}`);
    assert.equal(response.status(), 200, `${tab} operation did not load`);
    assert.doesNotMatch(await response.text(), /This page could not load/);
  }
  assert.deepEqual(errors, []);
  console.log("F&F browser integration passed: desktop/mobile review, prepare, second-person release, missing-bank gate, test payment, duplicate payout prevention.");
} finally { await browser.close(); }
