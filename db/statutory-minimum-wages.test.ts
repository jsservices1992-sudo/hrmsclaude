import { strict as assert } from "node:assert";
import { test } from "node:test";
import { MINIMUM_WAGES, JURISDICTIONS } from "./statutory-data";
import { applicableMinimumWage, minimumWageZones, type MinimumWageRule } from "../lib/payroll/compensation";

const SKILLS = ["unskilled", "semi_skilled", "skilled", "highly_skilled"] as const;
const rules: MinimumWageRule[] = MINIMUM_WAGES.map((w) => ({
  stateCode: w.state,
  zone: w.zone,
  skillCategory: w.skill,
  monthlyPaise: w.monthlyPaise,
  effectiveFrom: w.effectiveFrom,
}));
const ASOF = "2026-09-18";
const states = [...new Set(MINIMUM_WAGES.map((w) => w.state))];

test("every jurisdiction has a minimum wage on file", () => {
  const missing = JURISDICTIONS.map((j) => j.code).filter((c) => !states.includes(c));
  assert.deepEqual(missing, [], "these jurisdictions have no minimum wage seeded");
});

test("every state and zone carries all four skill categories", () => {
  const groups = new Map<string, Set<string>>();
  for (const w of MINIMUM_WAGES) {
    const key = `${w.state}|${w.zone ?? ""}`;
    (groups.get(key) ?? groups.set(key, new Set()).get(key)!).add(w.skill);
  }
  for (const [key, skills] of groups) {
    assert.equal(skills.size, 4, `${key} has ${skills.size} skill categories, not 4`);
  }
});

test("the skill ladder never goes down", () => {
  const groups = new Map<string, Map<string, number>>();
  for (const w of MINIMUM_WAGES) {
    const key = `${w.state}|${w.zone ?? ""}|${w.effectiveFrom}`;
    (groups.get(key) ?? groups.set(key, new Map()).get(key)!).set(w.skill, w.monthlyPaise);
  }
  for (const [key, byskill] of groups) {
    const ladder = SKILLS.map((s) => byskill.get(s)!);
    assert.deepEqual(
      ladder,
      [...ladder].sort((a, b) => a - b),
      `${key} pays a lower skill more than a higher one: ${ladder.join(", ")}`,
    );
  }
});

test("a state is either zoned or statewide, never both", () => {
  for (const state of states) {
    const rows = MINIMUM_WAGES.filter((w) => w.state === state);
    const zoned = rows.some((w) => w.zone !== null);
    const statewide = rows.some((w) => w.zone === null);
    assert.ok(
      zoned !== statewide,
      `${state} mixes zoned and statewide rates, so a lookup could match either`,
    );
  }
});

test("every statewide state resolves a figure for every skill", () => {
  for (const state of states) {
    if (minimumWageZones(rules, state, ASOF).length > 0) continue;
    for (const skill of SKILLS) {
      const r = applicableMinimumWage(rules, state, skill, ASOF, null);
      assert.ok(r, `${state} ${skill} resolves to nothing`);
      assert.ok(r!.monthlyPaise > 0, `${state} ${skill} is zero`);
    }
  }
});

test("every zoned state resolves a figure for every zone and skill, and none without one", () => {
  for (const state of states) {
    const zones = minimumWageZones(rules, state, ASOF);
    if (zones.length === 0) continue;
    for (const zone of zones) {
      for (const skill of SKILLS) {
        const r = applicableMinimumWage(rules, state, skill, ASOF, zone);
        assert.ok(r, `${state} ${zone} ${skill} resolves to nothing`);
      }
    }
    assert.equal(
      applicableMinimumWage(rules, state, "skilled", ASOF, null),
      null,
      `${state} is zoned and must not answer without a zone`,
    );
  }
});

test("no figure is implausible for an Indian monthly minimum wage", () => {
  for (const w of MINIMUM_WAGES) {
    const rupees = w.monthlyPaise / 100;
    assert.ok(
      rupees >= 3_000 && rupees <= 60_000,
      `${w.state} ${w.zone ?? "statewide"} ${w.skill} is ₹${rupees}, outside anything a state notifies`,
    );
  }
});

test("nothing is dated in the future", () => {
  for (const w of MINIMUM_WAGES) {
    assert.ok(w.effectiveFrom <= ASOF, `${w.state} starts ${w.effectiveFrom}, after today`);
  }
});

test("every rate names the notification it came from", () => {
  for (const w of MINIMUM_WAGES) {
    assert.ok(w.source && w.source.length > 3, `${w.state} ${w.skill} has no source`);
  }
});

test("Karnataka's zones carry the figures its notification prints", () => {
  /*
   * One state checked against its own notification in full, so that a
   * mistake in loading the workbook — a column misread, a zone attached
   * to the wrong rate, a skill ladder shifted by one — fails here rather
   * than quietly setting the floor a whole zone too high or too low.
   */
  const expected: Record<string, [number, number, number, number]> = {
    "Zone I": [23376, 25831, 28285, 31114],
    "Zone II": [21251, 23483, 25714, 28285],
    "Zone III": [19319, 21348, 23376, 25714],
  };
  for (const [zone, wages] of Object.entries(expected)) {
    SKILLS.forEach((skill, i) => {
      const r = applicableMinimumWage(rules, "KA", skill, ASOF, zone);
      assert.equal(
        r?.monthlyPaise,
        wages[i] * 100,
        `KA ${zone} ${skill} should be ₹${wages[i].toLocaleString("en-IN")}`,
      );
    });
  }
});

test("Haryana keeps its Gazette figures, not the workbook's", () => {
  /*
   * The two sources disagree by about 26% for the same period. The
   * Gazette is primary and wins; this pins that decision so a later
   * bulk reload of the workbook cannot quietly reverse it.
   */
  const expected = [15_220.71, 16_780.74, 18_500.81, 19_425.85];
  SKILLS.forEach((skill, i) => {
    const r = applicableMinimumWage(rules, "HR", skill, ASOF, null);
    assert.equal(r?.monthlyPaise, Math.round(expected[i] * 100), `HR ${skill}`);
  });
  const row = MINIMUM_WAGES.find((w) => w.state === "HR")!;
  assert.match(row.source, /CONFLICT/, "the disagreement must stay recorded on the row");
});
