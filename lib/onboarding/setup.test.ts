import test from "node:test";
import assert from "node:assert/strict";
import { setupSteps, setupProgress, canRunPayroll, type SetupFacts } from "./setup";

const empty: SetupFacts = {
  hasPan: false, hasTan: false, branches: 0, departments: 0, grades: 0,
  payComponents: 0, salaryStructures: 0, leaveTypes: 0, shifts: 0, employees: 0,
  holidays: 0, bankAccounts: 0, employeesWithoutSalary: 0,
};

const full: SetupFacts = {
  hasPan: true, hasTan: true, branches: 1, departments: 2, grades: 3,
  payComponents: 5, salaryStructures: 1, leaveTypes: 3, shifts: 1, employees: 4,
  holidays: 12, bankAccounts: 1, employeesWithoutSalary: 0,
};

test("a company that has just registered has everything to do", () => {
  const p = setupProgress(empty);
  assert.equal(p.done, 0);
  assert.equal(p.percent, 0);
  assert.equal(p.complete, false);
  assert.equal(p.next?.id, "company");
});

test("a configured company has nothing left", () => {
  const p = setupProgress(full);
  assert.equal(p.done, p.total);
  assert.equal(p.percent, 100);
  assert.equal(p.complete, true);
  assert.equal(p.next, null);
  assert.deepEqual(p.blockers, []);
});

test("the next step is the first unfinished one, in dependency order", () => {
  const p = setupProgress({ ...empty, hasPan: true, hasTan: true });
  assert.equal(p.next?.id, "branches");

  const q = setupProgress({ ...empty, hasPan: true, hasTan: true, branches: 1 });
  assert.equal(q.next?.id, "org");
});

test("a structure cannot precede the components it references", () => {
  const ids = setupSteps(empty).map((s) => s.id);
  assert.ok(
    ids.indexOf("pay-components") < ids.indexOf("structure"),
    "pay components must come before the structure that uses them",
  );
  assert.ok(
    ids.indexOf("branches") < ids.indexOf("employees"),
    "a branch must exist before anyone can be placed in one",
  );
});

test("blockers are the unfinished steps others depend on", () => {
  const p = setupProgress(empty);
  assert.deepEqual(
    p.blockers.map((s) => s.id),
    ["branches", "org", "pay-components", "structure"],
  );

  // Identifiers matter for filing but block nothing, so they are not blockers.
  assert.equal(p.blockers.some((s) => s.id === "company"), false);
});

test("grades and departments are one step, and both are needed", () => {
  const onlyDepts = setupProgress({ ...empty, departments: 2 });
  assert.equal(onlyDepts.steps.find((s) => s.id === "org")?.done, false);

  const both = setupProgress({ ...empty, departments: 2, grades: 1 });
  assert.equal(both.steps.find((s) => s.id === "org")?.done, true);
});

test("payroll cannot run until the blocking steps are done and someone is on the books", () => {
  assert.equal(canRunPayroll(empty), false);
  assert.equal(canRunPayroll({ ...full, employees: 0 }), false, "nobody to pay");
  assert.equal(canRunPayroll({ ...full, salaryStructures: 0 }), false, "no structure");
  assert.equal(canRunPayroll(full), true);
});

test("progress is a percentage of the whole list, not of the blockers", () => {
  const p = setupProgress({ ...empty, hasPan: true, hasTan: true });
  assert.equal(p.done, 1);
  assert.equal(p.percent, Math.round((1 / p.total) * 100));
});

test("every step names why it exists and where to go", () => {
  for (const step of setupSteps(empty)) {
    assert.ok(step.why.length > 20, `${step.id} has no explanation`);
    assert.match(step.href, /^\/console/, `${step.id} has no destination`);
    assert.ok(step.title.length > 0);
  }
});


test("an employee with no salary is surfaced, because payroll leaves them out", () => {
  const p = setupProgress({ ...full, employeesWithoutSalary: 3 });
  const step = p.steps.find((x) => x.id === "salaries")!;
  assert.equal(step.done, false, "not done while somebody has no salary");
  assert.equal(p.complete, false);
});

test("a company with no bank account can still run payroll, but is told", () => {
  const p = setupProgress({ ...full, bankAccounts: 0 });
  assert.equal(p.steps.find((x) => x.id === "bank-account")!.done, false);
  assert.equal(
    canRunPayroll({ ...full, bankAccounts: 0 }),
    true,
    "paying is a separate step from calculating, so this must not block",
  );
});

test("no holiday calendar is flagged without blocking the first run", () => {
  const facts = { ...full, holidays: 0 };
  assert.equal(setupProgress(facts).steps.find((x) => x.id === "holidays")!.done, false);
  assert.equal(canRunPayroll(facts), true);
});
