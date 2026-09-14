import test from "node:test";
import assert from "node:assert/strict";
import { computeHiring, summariseHiring, type DepartmentPlan } from "./hiring";

function plan(p: Partial<DepartmentPlan> = {}): DepartmentPlan {
  return {
    departmentId: "d1",
    code: "ENG",
    name: "Engineering",
    approved: 10,
    filled: 8,
    leaving: 0,
    incoming: 0,
    ...p,
  };
}

test("open positions are the plan less the people committed to it", () => {
  const h = computeHiring(plan({ approved: 10, filled: 8 }));
  assert.equal(h.projected, 8);
  assert.equal(h.openPositions, 2);
  assert.equal(h.overBudget, 0);
});

test("a leaver's seat counts as open even while they are still employed", () => {
  // Eight at desks, one on notice: seven will remain, so three may be hired.
  const h = computeHiring(plan({ approved: 10, filled: 8, leaving: 1 }));
  assert.equal(h.projected, 7);
  assert.equal(h.openPositions, 3);
});

test("an accepted joiner's seat is taken before they start", () => {
  // Without this, the same seat is offered to two people.
  const h = computeHiring(plan({ approved: 10, filled: 8, incoming: 2 }));
  assert.equal(h.projected, 10);
  assert.equal(h.openPositions, 0);
});

test("leavers and joiners net off against each other", () => {
  const h = computeHiring(plan({ approved: 10, filled: 9, leaving: 2, incoming: 2 }));
  assert.equal(h.projected, 9);
  assert.equal(h.openPositions, 1);
});

test("committing past the plan reports as over budget, not negative openings", () => {
  const h = computeHiring(plan({ approved: 5, filled: 6, incoming: 1 }));
  assert.equal(h.projected, 7);
  assert.equal(h.openPositions, 0, "never offer a negative number of roles");
  assert.equal(h.overBudget, 2);
  assert.equal(h.utilisationPercent, 140);
});

test("no plan set reads as unset, not as a plan of zero", () => {
  const h = computeHiring(plan({ approved: null, filled: 4 }));
  assert.equal(h.openPositions, 0);
  assert.equal(h.overBudget, 0, "cannot be over a plan that does not exist");
  assert.equal(h.utilisationPercent, null);
});

test("a deliberate plan of zero is over budget once anyone is in it", () => {
  // Distinct from null: the business said no more hiring here.
  const h = computeHiring(plan({ approved: 0, filled: 2 }));
  assert.equal(h.overBudget, 2);
  assert.equal(h.utilisationPercent, 0);
});

test("the summary totals across departments and ranks the biggest gaps first", () => {
  const s = summariseHiring([
    plan({ departmentId: "a", name: "Small", approved: 3, filled: 3 }),
    plan({ departmentId: "b", name: "Hiring hard", approved: 10, filled: 4 }),
    plan({ departmentId: "c", name: "Unplanned", approved: null, filled: 2 }),
  ]);

  assert.equal(s.departments[0].name, "Hiring hard", "largest opening first");
  assert.equal(s.totalApproved, 13, "an unplanned department adds nothing");
  assert.equal(s.totalProjected, 9);
  assert.equal(s.totalOpen, 6);
  assert.equal(s.planned, 2);
  assert.equal(s.unplanned, 1);
});
