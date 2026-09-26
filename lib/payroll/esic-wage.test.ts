import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  esicWage,
  esicRuleFor,
  defaultEsicTreatment,
  esicTreatmentForCategory,
  type EsicWageLine,
  codeWageSplit,
} from "./esic-wage";

const R = (rupees: number) => Math.round(rupees * 100);
const line = (code: string, rupees: number, treatment: EsicWageLine["treatment"]): EsicWageLine => ({
  code,
  amountPaise: R(rupees),
  treatment,
});

describe("ESI wages under the Code", () => {
  test("exclusions over half of remuneration are added back", () => {
    /* Basic 8,000 + DA 2,000, HRA 7,000 + conveyance 5,000. Remuneration
       22,000, half is 11,000, exclusions are 12,000 — 1,000 over. */
    const w = esicWage(
      [
        line("BASIC", 8000, "included"),
        line("DA", 2000, "included"),
        line("HRA", 7000, "excluded_50"),
        line("CONV", 5000, "excluded_50"),
      ],
      "social_security_code",
    );
    assert.equal(w.remunerationPaise, R(22000));
    assert.equal(w.limitPaise, R(11000));
    assert.equal(w.addBackPaise, R(1000));
    assert.equal(w.contributionWagePaise, R(11000));
    assert.equal(Math.ceil((w.contributionWagePaise * 75) / 10000), R(82.5), "employee 0.75%");
    assert.equal(Math.ceil((w.contributionWagePaise * 325) / 10000), R(357.5), "employer 3.25%");
  });

  test("exclusions within half are simply left out", () => {
    /* Basic 10,000 + DA 2,000, HRA 4,000 + conveyance 2,000. Remuneration
       18,000, half is 9,000, exclusions 6,000 — nothing added back. */
    const w = esicWage(
      [
        line("BASIC", 10000, "included"),
        line("DA", 2000, "included"),
        line("HRA", 4000, "excluded_50"),
        line("CONV", 2000, "excluded_50"),
      ],
      "social_security_code",
    );
    assert.equal(w.addBackPaise, 0);
    assert.equal(w.contributionWagePaise, R(12000));
    assert.equal(Math.ceil((w.contributionWagePaise * 75) / 10000), R(90));
    assert.equal(Math.ceil((w.contributionWagePaise * 325) / 10000), R(390));
  });

  test("fully excluded components are neither wages nor part of the 50% test", () => {
    const with_ = esicWage(
      [
        line("BASIC", 10000, "included"),
        line("HRA", 4000, "excluded_50"),
        line("REIMB", 50000, "excluded"),
      ],
      "social_security_code",
    );
    const without = esicWage(
      [line("BASIC", 10000, "included"), line("HRA", 4000, "excluded_50")],
      "social_security_code",
    );
    assert.deepEqual(with_, without, "a reimbursement changes nothing");
  });

  test("overtime is left out of the ceiling test but counted for contribution", () => {
    /* A month heavy with overtime: it must not take somebody out of the
       scheme, and it must still be charged once it overruns half. */
    const w = esicWage(
      [line("BASIC", 10000, "included"), line("OT", 15000, "overtime")],
      "social_security_code",
    );
    assert.equal(w.coverageWagePaise, R(10000), "overtime ignored for coverage");
    assert.equal(w.addBackPaise, R(2500), "15,000 against a 12,500 limit");
    assert.equal(w.contributionWagePaise, R(12500));
  });

  test("a salary of included components only is its own wage", () => {
    const w = esicWage([line("BASIC", 15000, "included"), line("SPL", 4000, "included")], "social_security_code");
    assert.equal(w.contributionWagePaise, R(19000));
    assert.equal(w.coverageWagePaise, R(19000));
  });

  test("gross over 21,000 can still be covered once HRA is excluded", () => {
    /* The reason not to test the ceiling on gross: 24,000 gross, but the
       wage the Code recognises is well inside the limit. */
    const w = esicWage(
      [line("BASIC", 12000, "included"), line("HRA", 4800, "excluded_50"), line("SPL", 7200, "included")],
      "social_security_code",
    );
    assert.equal(w.coverageWagePaise, R(19200));
    assert.ok(w.coverageWagePaise <= R(21000));
  });
});

describe("ESI wages under the ESI Act", () => {
  test("everything that counts, counts in full — no 50% rule", () => {
    const w = esicWage(
      [
        line("BASIC", 8000, "included"),
        line("HRA", 7000, "excluded_50"),
        line("CONV", 5000, "excluded_50"),
      ],
      "esi_act",
    );
    assert.equal(w.contributionWagePaise, R(20000), "the old gross-style wage");
    assert.equal(w.addBackPaise, 0);
  });

  test("overtime counted for contribution and left out of the ceiling", () => {
    const w = esicWage([line("BASIC", 18000, "included"), line("OT", 5000, "overtime")], "esi_act");
    assert.equal(w.coverageWagePaise, R(18000));
    assert.equal(w.contributionWagePaise, R(23000));
  });
});

describe("Which rule a period falls under", () => {
  test("the Code applies from the day the Labour Codes came into force", () => {
    assert.equal(esicRuleFor("2025-11-20"), "esi_act");
    assert.equal(esicRuleFor("2025-11-21"), "social_security_code");
    assert.equal(esicRuleFor("2026-09-30"), "social_security_code");
  });
});

describe("Default treatments", () => {
  test("the Code's named exclusions are recognised by code", () => {
    assert.equal(defaultEsicTreatment("HRA", true), "excluded_50");
    assert.equal(defaultEsicTreatment("conv", true), "excluded_50");
    assert.equal(defaultEsicTreatment("OT", true), "overtime");
  });

  test("anything else follows the flag it already had", () => {
    assert.equal(defaultEsicTreatment("BASIC", true), "included");
    assert.equal(defaultEsicTreatment("SPL", true), "included");
    assert.equal(defaultEsicTreatment("WASHING", false), "excluded");
  });

  test("variable pay by category", () => {
    assert.equal(esicTreatmentForCategory("ot"), "overtime");
    assert.equal(esicTreatmentForCategory("incentive"), "included");
    assert.equal(esicTreatmentForCategory("bonus"), "excluded_50");
    assert.equal(esicTreatmentForCategory("deduction"), "excluded");
  });
});

test("the Code's 50% split counts special allowance and a monthly bonus as wages, not basic alone", () => {
  // JBM00041's September: take-home held at ₹40,000, gross re-solved to ₹43,000.
  const lines = [
    { code: "BASIC", kind: "earning", amountPaise: 2_090_000 },
    { code: "HRA", kind: "earning", amountPaise: 836_000 },
    { code: "BONUS", kind: "earning", amountPaise: 58_310 },
    { code: "SPL", kind: "earning", amountPaise: 1_315_690 },
    { code: "EPF_EE", kind: "deduction", amountPaise: 300_000 },
  ];
  const components = [
    { code: "BASIC", esicBase: true, esicTreatment: null },
    { code: "HRA", esicBase: true, esicTreatment: null },
    { code: "BONUS", esicBase: false, esicTreatment: "included" as const },
    { code: "SPL", esicBase: true, esicTreatment: null },
  ];
  const split = codeWageSplit(lines, components);
  assert.equal(split.remunerationPaise, 4_300_000);
  assert.equal(split.wagesPaise, 4_300_000 - 836_000, "only HRA is excluded");
  assert.ok(split.wagesPaise / split.remunerationPaise > 0.5, "80.6% — compliant, not 48.6%");
});
