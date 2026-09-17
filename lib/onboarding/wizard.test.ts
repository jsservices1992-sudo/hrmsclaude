import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { wizardSteps, wizardPosition, withWizard, nextStop, type WizardFacts } from "./wizard";

const empty: WizardFacts = {
  hasPan: false,
  hasTan: false,
  branches: 0,
  departments: 0,
  grades: 0,
  payComponents: 0,
  salaryStructures: 0,
  leaveTypes: 0,
  shifts: 0,
  employees: 0,
  holidays: 0,
  bankAccounts: 0,
  employeesWithoutSalary: 0,
  registrations: 0,
  variablePayTypes: 0,
  loanSchemes: 0,
  glAccounts: 0,
};

const C = "company-1";

describe("The setup path", () => {
  test("runs in the order the screens depend on each other", () => {
    assert.deepEqual(
      wizardSteps(C, empty).map((s) => s.id),
      [
        "profile", "branches", "registrations", "org", "leave", "shifts",
        "pay", "variable", "loans", "gl", "structure", "employees",
        "salaries", "bank",
      ],
    );
  });

  test("nothing is done on an empty company", () => {
    assert.equal(wizardSteps(C, empty).every((s) => !s.done), true);
  });

  test("a step knows what comes before and after it", () => {
    const at = wizardPosition(C, empty, "org")!;
    assert.equal(at.previous?.id, "registrations");
    assert.equal(at.next?.id, "leave");
    assert.equal(at.index, 3);
    assert.equal(at.total, 14);
  });

  test("the first step has nothing before it and the last nothing after", () => {
    assert.equal(wizardPosition(C, empty, "profile")!.previous, null);
    assert.equal(wizardPosition(C, empty, "bank")!.next, null);
  });

  test("an unknown step is not a position", () => {
    assert.equal(wizardPosition(C, empty, "nonsense"), null);
  });

  test("progress counts the steps actually satisfied", () => {
    const facts: WizardFacts = { ...empty, hasPan: true, hasTan: true, branches: 2 };
    const at = wizardPosition(C, facts, "org")!;
    assert.equal(at.done, 2);
    assert.equal(at.steps.find((s) => s.id === "profile")!.done, true);
    assert.equal(at.steps.find((s) => s.id === "branches")!.done, true);
  });

  test("leave is done only when both the types and the calendar are", () => {
    const types = wizardSteps(C, { ...empty, leaveTypes: 3 });
    assert.equal(types.find((s) => s.id === "leave")!.done, false, "types alone");
    const both = wizardSteps(C, { ...empty, leaveTypes: 3, holidays: 10 });
    assert.equal(both.find((s) => s.id === "leave")!.done, true);
  });

  test("salaries is not done while somebody is missing one", () => {
    const short = wizardSteps(C, { ...empty, employees: 5, employeesWithoutSalary: 1 });
    assert.equal(short.find((s) => s.id === "salaries")!.done, false);
    const all = wizardSteps(C, { ...empty, employees: 5, employeesWithoutSalary: 0 });
    assert.equal(all.find((s) => s.id === "salaries")!.done, true);
  });

  test("every step addresses the company it is setting up", () => {
    for (const step of wizardSteps(C, empty)) {
      // The two that are not company-scoped are company-scoped by session.
      if (["employees", "salaries"].includes(step.id)) continue;
      assert.match(step.href, new RegExp(C), `${step.id} lost the company`);
    }
  });

  /* Both of these land on the payroll settings screen, which shows one
     tab at a time. A step that names a tab the screen does not have is
     silently dropped onto the default one, and the person is left on a
     page that has nothing to do with the step they are on. */
  test("the two payroll steps name the tab that holds their form", () => {
    const steps = wizardSteps(C, empty);
    assert.match(steps.find((s) => s.id === "structure")!.href, /tab=structures\b/);
    assert.match(steps.find((s) => s.id === "bank")!.href, /tab=banks\b/);
  });

  test("next is the following step, when it still needs doing", () => {
    const steps = wizardSteps(C, empty);
    assert.equal(nextStop(steps, 0)!.id, "branches");
  });

  test("next passes over the steps already satisfied", () => {
    /* Branches and registrations are both accounted for, so the step
       after the profile is the first one with anything left to do. */
    const steps = wizardSteps(C, { ...empty, branches: 1, registrations: 2 });
    assert.equal(nextStop(steps, 0)!.id, "org");
  });

  test("nothing left to do is the end of the path", () => {
    const steps = wizardSteps(C, empty);
    assert.equal(nextStop(steps, steps.length - 1), null);
  });

  test("the wizard marker survives a href that already has a query", () => {
    assert.equal(withWizard("/a?tab=b", "org"), "/a?tab=b&setup=org");
    assert.equal(withWizard("/a", "org"), "/a?setup=org");
  });
});
