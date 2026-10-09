import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import postgres from "postgres";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const base = process.env.COMPLIANCE_TEST_URL;
const databaseUrl = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (base !== "http://localhost:3017" || databaseUrl.hostname !== "127.0.0.1" || databaseUrl.port !== "55439") {
  throw new Error("Statutory permission tests require the isolated local database and server");
}
const fixture = JSON.parse(await readFile("/tmp/hrms-compliance-fixture.json", "utf8"));
const sql = postgres(databaseUrl.toString());
const browser = await chromium.launch({ headless: true });
const ids = [];
const state = `TEST-${randomUUID()}`;
const paramId = randomUUID();
try {
  await sql`insert into jurisdictions (state_code, name, kind, pt_applicable, lwf_applicable)
    values (${state}, 'TEST permission jurisdiction', 'state', false, false)`;
  await sql`insert into statutory_params (id, key, value, unit, effective_from, source, verified)
    values (${paramId}, ${"test.permission." + paramId}, 0, 'count', '2026-01-01', 'TEST ONLY', false)`;
  for (const scope of ["operator", "company", "auditor"]) {
    const id = randomUUID();
    const session = randomUUID();
    ids.push(id);
    await sql`insert into users (id, email, name, password_hash, role, company_id, compensation_scope, active, created_at)
      values (${id}, ${id + "@test.invalid"}, 'TEST statutory permissions', 'unusable',
      ${scope === "auditor" ? "auditor" : "admin"}, ${scope === "operator" ? null : fixture.companyId}, 'company', true, ${new Date().toISOString()})`;
    await sql`insert into sessions (id, user_id, expires_at, created_at) values
      (${session}, ${id}, ${new Date(Date.now() + 3600000).toISOString()}, ${new Date().toISOString()})`;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies([{ name: "lekha_session", value: session, url: base }]);
    const page = await context.newPage();
    await page.goto(`${base}/console/compliance`);
    assert.equal(await page.locator('input[name="key"]').count() > 0, scope === "operator");
    if (scope !== "operator") {
      const link = page.getByRole("link", { name: "Company minimum wages & verification" });
      assert.match(await link.getAttribute("href"), new RegExp(fixture.companyId));
    }
    await page.goto(`${base}/console/compliance/${state}`);
    assert.equal(await page.getByRole("button", { name: "Edit", exact: true }).count() > 0, scope === "operator");
    if (scope === "operator") await page.getByRole("button", { name: "Edit", exact: true }).click();
    assert.equal(await page.locator('input[name="ptApplicable"]').count() > 0, scope === "operator");
    await page.goto(`${base}/console/settings/payroll?company=${fixture.companyId}&tab=statutory&state=${state}&skill=unskilled`);
    assert.equal(await page.locator('input[name="monthly"]').count() > 0, scope !== "auditor", "Company minimum wage form permission");
    assert.equal(await page.locator('input[name="paramKey"]').count() > 0, scope === "operator", "Central parameter form permission");
    assert.equal(await page.getByText("Add LWF rate", { exact: true }).count() > 0, scope === "operator");
    assert.equal(await page.getByText("Add professional tax slab", { exact: true }).count() > 0, scope === "operator");
    if (scope === "company") {
      const wageForm = page.locator("form").filter({ has: page.locator('input[name="monthly"]') });
      assert.equal(await wageForm.locator('input[name="companyId"]').inputValue(), fixture.companyId);
      assert.equal(await wageForm.locator('select[name="scope"]').count(), 0);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator("#minimum-wages").waitFor({ state: "visible" });
      await page.getByText("Shared PF/ESI parameters, PT slabs and LWF rates:", { exact: false }).waitFor();
      await page.screenshot({ path: "/tmp/hrms-statutory-company-mobile.png" });
      const overflow = await page.evaluate(() => [...document.querySelectorAll("body *")].filter(el => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 5).map(el => ({ tag: el.tagName, classes: el.className, text: el.textContent.slice(0, 80) })));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, JSON.stringify(overflow));
    }
    assert.doesNotMatch(await page.locator("body").innerText(), /This page could not load/);
    await context.close();
  }
  console.log("Statutory UI permissions passed: operator, company admin and auditor; company-scoped minimum-wage forms retained; mobile layout checked.");
} finally {
  await browser.close();
  for (const id of ids) {
    await sql`delete from sessions where user_id = ${id}`;
    await sql`delete from users where id = ${id}`;
  }
  await sql`delete from jurisdictions where state_code = ${state}`;
  await sql`delete from statutory_params where id = ${paramId}`;
  await sql.end();
}
