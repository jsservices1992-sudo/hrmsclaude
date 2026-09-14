import test from "node:test";
import assert from "node:assert/strict";
import { buildTree, flatten, findOrphans, wouldCycle, type OrgPerson } from "./org";

function person(p: Partial<OrgPerson> & { id: string }): OrgPerson {
  return {
    name: p.id,
    empCode: p.empCode ?? p.id,
    designation: null,
    department: null,
    departmentId: null,
    managerId: null,
    status: "active",
    lastWorkingDay: null,
    replacementId: null,
    replacementName: null,
    ...p,
  };
}

test("nests reports under their manager", () => {
  const roots = buildTree([
    person({ id: "boss" }),
    person({ id: "a", managerId: "boss" }),
    person({ id: "b", managerId: "boss" }),
    person({ id: "c", managerId: "a" }),
  ]);

  assert.equal(roots.length, 1);
  assert.equal(roots[0].id, "boss");
  assert.deepEqual(roots[0].children.map((c) => c.id), ["a", "b"]);
  assert.deepEqual(roots[0].children[0].children.map((c) => c.id), ["c"]);
});

test("counts direct reports and the whole subtree separately", () => {
  const roots = buildTree([
    person({ id: "boss" }),
    person({ id: "a", managerId: "boss" }),
    person({ id: "b", managerId: "boss" }),
    person({ id: "c", managerId: "a" }),
    person({ id: "d", managerId: "c" }),
  ]);

  const boss = roots[0];
  assert.equal(boss.directCount, 2, "a and b report directly");
  assert.equal(boss.totalCount, 4, "a, b, c and d sit underneath");
  assert.equal(boss.depth, 0);
  assert.equal(flatten(roots).find((n) => n.id === "d")!.depth, 3);
});

test("someone whose manager is not in the set stays visible at the top", () => {
  // Manager sits in another company, so is not in this company's rows.
  const roots = buildTree([person({ id: "a", managerId: "elsewhere" })]);
  assert.deepEqual(roots.map((r) => r.id), ["a"]);
});

test("a reporting cycle does not hang, and nobody disappears", () => {
  // A reports to B, B reports to A — bad data that must not recurse forever.
  const roots = buildTree([
    person({ id: "a", managerId: "b" }),
    person({ id: "b", managerId: "a" }),
    person({ id: "c" }),
  ]);

  const ids = flatten(roots).map((n) => n.id).sort();
  assert.deepEqual(ids, ["a", "b", "c"], "every person is still reachable");
});

test("a leaving manager with a team is an orphan; one without a team is not", () => {
  const roots = buildTree([
    person({ id: "leaver", status: "resigned", lastWorkingDay: "2026-10-31" }),
    person({ id: "report", managerId: "leaver" }),
    person({ id: "soloLeaver", status: "exited" }),
  ]);

  const orphans = findOrphans(flatten(roots));
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].manager.id, "leaver");
  assert.equal(orphans[0].reportCount, 1);
  assert.equal(orphans[0].replacementName, null, "no successor named yet");
});

test("an orphan with a named replacement reports who is taking over", () => {
  const roots = buildTree([
    person({
      id: "leaver",
      status: "resigned",
      replacementId: "successor",
      replacementName: "Successor",
    }),
    person({ id: "report", managerId: "leaver" }),
  ]);

  assert.equal(findOrphans(flatten(roots))[0].replacementName, "Successor");
});

test("reassignment that would form a loop is refused", () => {
  const people = [
    person({ id: "boss" }),
    person({ id: "a", managerId: "boss" }),
    person({ id: "c", managerId: "a" }),
  ];

  // Making the boss report to their own report's report closes a loop.
  assert.equal(wouldCycle(people, "boss", "c"), true);
  assert.equal(wouldCycle(people, "boss", "boss"), true, "nobody manages themselves");
  // Moving a leaf sideways is fine.
  assert.equal(wouldCycle(people, "c", "boss"), false);
});
