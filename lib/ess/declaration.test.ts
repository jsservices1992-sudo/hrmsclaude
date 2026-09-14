import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRupeeField,
  checkForSubmission,
  proofSectionsFor,
  DECLARATION_SECTIONS,
  LANDLORD_PAN_THRESHOLD_PAISE,
} from "./declaration";

test("blank means nothing declared, not an error", () => {
  assert.deepEqual(parseRupeeField(""), { ok: true, paise: 0 });
  assert.deepEqual(parseRupeeField("   "), { ok: true, paise: 0 });
});

test("the ways people actually type rupees all parse", () => {
  assert.deepEqual(parseRupeeField("150000"), { ok: true, paise: 15_000_000 });
  assert.deepEqual(parseRupeeField("1,50,000"), { ok: true, paise: 15_000_000 });
  assert.deepEqual(parseRupeeField("₹1,50,000"), { ok: true, paise: 15_000_000 });
  assert.deepEqual(parseRupeeField(" 1500.50 "), { ok: true, paise: 150_050 });
});

test("a non-amount is refused rather than read as zero", () => {
  for (const bad of ["abc", "-500", "1.234", "1e5", "50%"]) {
    const r = parseRupeeField(bad);
    assert.equal(r.ok, false, bad);
  }
});

test("rent with nothing else is incomplete", () => {
  const issues = checkForSubmission({
    annualRentPaise: 24_000_00,
    landlordName: null,
    landlordPan: null,
    rentCity: null,
  });
  assert.deepEqual(issues.map((i) => i.field).sort(), ["landlordName", "rentCity"]);
});

test("rent over one lakh a year requires the landlord PAN", () => {
  const justUnder = checkForSubmission({
    annualRentPaise: LANDLORD_PAN_THRESHOLD_PAISE,
    landlordName: "R Kulkarni",
    landlordPan: null,
    rentCity: "metro",
  });
  assert.deepEqual(justUnder, []);

  const over = checkForSubmission({
    annualRentPaise: LANDLORD_PAN_THRESHOLD_PAISE + 1,
    landlordName: "R Kulkarni",
    landlordPan: null,
    rentCity: "metro",
  });
  assert.equal(over.length, 1);
  assert.match(over[0].message, /landlord's PAN/);
});

test("a malformed landlord PAN is caught below the threshold too", () => {
  const issues = checkForSubmission({
    annualRentPaise: 50_000_00,
    landlordName: "R Kulkarni",
    landlordPan: "NOTAPAN",
    rentCity: "metro",
  });
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /valid format/);
});

test("declaring no rent asks for no landlord at all", () => {
  assert.deepEqual(
    checkForSubmission({ annualRentPaise: 0, landlordName: null, landlordPan: null, rentCity: null }),
    [],
  );
});

test("only sections actually claimed reach the proof queue", () => {
  const rows = proofSectionsFor({ section80cPaise: 15_000_000, section80gPaise: 0 }, 0);
  assert.deepEqual(rows, [{ section: "80C", declaredPaise: 15_000_000 }]);
});

test("rent joins the proof queue as HRA", () => {
  const rows = proofSectionsFor({}, 24_000_00);
  assert.deepEqual(rows, [{ section: "HRA", declaredPaise: 24_000_00 }]);
});

test("every declared section maps to a distinct proof section", () => {
  const sections = DECLARATION_SECTIONS.map((d) => d.section);
  assert.equal(new Set(sections).size, sections.length);
});
