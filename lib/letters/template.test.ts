import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mergeTemplate, LETTER_TYPES, isLetterType, fieldsForLetter, unknownPlaceholders, SAMPLE_VALUES } from "./template";
import { renderLetterHtml, LETTER_THEMES } from "./themes";

describe("mergeTemplate", () => {
  test("substitutes every field supplied", () => {
    const r = mergeTemplate("Dear {{employee_name}}, your role is {{designation}}.", {
      employee_name: "Asha Rao",
      designation: "Analyst",
    });
    assert.equal(r.text, "Dear Asha Rao, your role is Analyst.");
    assert.equal(r.missingFields.length, 0);
  });

  test("a field not supplied is left exactly as written, not blanked or guessed", () => {
    const r = mergeTemplate("Last working day: {{date_of_exit}}.", {});
    assert.equal(r.text, "Last working day: {{date_of_exit}}.");
    assert.deepEqual(r.missingFields, ["date_of_exit"]);
  });

  test("is case-insensitive on the field name but not on the value", () => {
    const r = mergeTemplate("{{Employee_Name}}", { employee_name: "Rohit" });
    assert.equal(r.text, "Rohit");
  });

  test("the same missing field is reported once even if it appears twice", () => {
    const r = mergeTemplate("{{x}} and {{x}} again", {});
    assert.deepEqual(r.missingFields, ["x"]);
  });

  test("an empty-string value counts as missing, not as a deliberate blank", () => {
    const r = mergeTemplate("{{department}}", { department: "" });
    assert.deepEqual(r.missingFields, ["department"]);
  });

  test("plain text with no placeholders passes through untouched", () => {
    const r = mergeTemplate("No fields here.", {});
    assert.equal(r.text, "No fields here.");
    assert.equal(r.missingFields.length, 0);
  });
});

describe("Letter types", () => {
  test("there are exactly the five the product supports", () => {
    assert.deepEqual(
      LETTER_TYPES.map((t) => t.type).sort(),
      ["experience", "fnf_noc", "loi", "offer", "relieving"],
    );
  });

  test("isLetterType rejects anything else", () => {
    assert.ok(isLetterType("offer"));
    assert.ok(!isLetterType("invoice"));
    assert.ok(!isLetterType(undefined));
  });
});

describe("Per-letter fields", () => {
  test("every sample uses only fields its own letter knows", () => {
    for (const t of LETTER_TYPES) {
      assert.deepEqual(unknownPlaceholders(t.type, t.sample), [], t.type);
    }
  });

  test("each letter has its own fields, not one shared list", () => {
    const keys = (type: Parameters<typeof fieldsForLetter>[0]) => fieldsForLetter(type).map((f) => f.key);
    assert.ok(keys("offer").includes("offer_valid_till"));
    assert.ok(!keys("offer").includes("fnf_net_amount"));
    assert.ok(keys("fnf_noc").includes("fnf_net_amount"));
    assert.ok(!keys("relieving").includes("annual_ctc"));
  });

  test("a misspelt field is reported", () => {
    assert.deepEqual(unknownPlaceholders("offer", "Dear {{employe_name}}"), ["employe_name"]);
  });

  test("every sample merges completely with the preview values", () => {
    for (const t of LETTER_TYPES) {
      assert.deepEqual(mergeTemplate(t.sample, { ...SAMPLE_VALUES, company_name: "Acme", company_address: "Pune" }).missingFields, [], t.type);
    }
  });
});

describe("Themes", () => {
  test("every theme renders the body, escaped, and the signatory", () => {
    for (const { theme } of LETTER_THEMES) {
      const html = renderLetterHtml({
        theme,
        companyName: "Acme <Pvt> Ltd",
        companyAddress: "Pune",
        date: "1 October 2026",
        subject: "Offer of Employment",
        body: "Dear Asha,\n\nWelcome & congratulations.",
        signatoryName: "Priya Nair",
      });
      assert.ok(html.includes("Acme &lt;Pvt&gt; Ltd"), theme);
      assert.ok(html.includes("Welcome &amp; congratulations."), theme);
      assert.ok(html.includes("Priya Nair"), theme);
    }
  });
});
