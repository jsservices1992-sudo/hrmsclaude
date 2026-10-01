import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mergeTemplate, LETTER_TYPES, isLetterType } from "./template";

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
