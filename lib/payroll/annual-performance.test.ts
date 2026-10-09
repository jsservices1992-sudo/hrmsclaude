import { test } from "node:test";
import assert from "node:assert/strict";
import { esicWage } from "./esic-wage";

test("annual performance incentive does not inflate remuneration or wages", () => {
  const result = esicWage([
    { code: "BASIC", amountPaise: 2000000, treatment: "included" },
    { code: "HRA", amountPaise: 800000, treatment: "excluded_50" },
    { code: "ANNUAL_PERFORMANCE", amountPaise: 10000000, treatment: "not_remuneration" },
  ], "social_security_code");
  assert.equal(result.remunerationPaise, 2800000);
  assert.equal(result.contributionWagePaise, 2000000);
});
