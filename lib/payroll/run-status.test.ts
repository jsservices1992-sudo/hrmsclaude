import test from "node:test";
import assert from "node:assert/strict";
import { buildRunSteps, nextStep, progressOf, type RunStatusInput } from "./run-status";

const Q = "company=c1&year=2026&month=9";

function input(p: Partial<RunStatusInput> = {}): RunStatusInput {
  return {
    activeEmployees: 32,
    missingSalary: 0,
    missingBank: 0,
    lopTotalDays: 4.5,
    pendingLeave: 0,
    pendingRegularisation: 0,
    attendanceFinalised: true,
    variablePayCount: 0,
    variablePayNetPaise: 0,
    run: null,
    criticalExceptions: 0,
    warningExceptions: 0,
    viewerPreparedRun: false,
    ...p,
  };
}

const step = (i: RunStatusInput, id: string) =>
  buildRunSteps(i, Q).find((s) => s.id === id)!;

test("a fresh period points at calculating, with later steps waiting", () => {
  const steps = buildRunSteps(input(), Q);
  assert.equal(step(input(), "calculate").state, "ready");
  assert.equal(step(input(), "review").state, "waiting");
  assert.equal(step(input(), "approve").state, "waiting");
  assert.equal(step(input(), "disburse").state, "waiting");
  assert.equal(nextStep(steps)?.id, "variable", "variable pay is offered before calculating");
});

test("master-data problems block, and hold calculation back", () => {
  const i = input({ missingSalary: 2, missingBank: 1 });
  assert.equal(step(i, "people").state, "blocked");
  assert.equal(step(i, "people").blockingCount, 3);
  assert.match(step(i, "people").detail, /2 without salary, 1 without bank details/);
  assert.equal(step(i, "calculate").state, "waiting", "cannot calculate over broken master data");
  assert.equal(nextStep(buildRunSteps(i, Q))?.id, "people", "the blocker is what to do next");
});

test("attendance that moved after calculation asks for a look", () => {
  const i = input({ attendanceFinalised: false });
  assert.equal(step(i, "attendance").state, "attention");
  assert.match(step(i, "attendance").detail, /changed since the last calculation/);
});

test("pending leave shows as a count to decide", () => {
  const i = input({ pendingLeave: 2, pendingRegularisation: 1 });
  assert.equal(step(i, "attendance").warningCount, 3);
  assert.match(step(i, "attendance").detail, /3 awaiting a decision/);
});

test("a calculated run opens review, and blocking findings stop approval", () => {
  const i = input({
    run: { version: 1, status: "calculated", employees: 32 },
    criticalExceptions: 2,
    warningExceptions: 5,
  });
  assert.equal(step(i, "calculate").state, "done");
  assert.equal(step(i, "review").state, "blocked");
  assert.equal(step(i, "approve").state, "blocked");
  assert.match(step(i, "approve").detail, /Blocked by the findings/);
  assert.equal(nextStep(buildRunSteps(i, Q))?.id, "review");
});

test("the preparer is told a second person must approve", () => {
  const i = input({
    run: { version: 1, status: "calculated", employees: 32 },
    viewerPreparedRun: true,
  });
  assert.equal(step(i, "approve").state, "attention");
  assert.match(step(i, "approve").detail, /second person/);

  const other = input({
    run: { version: 1, status: "calculated", employees: 32 },
    viewerPreparedRun: false,
  });
  assert.equal(step(other, "approve").state, "ready");
});

test("money cannot move before approval, and can after", () => {
  const before = input({ run: { version: 1, status: "calculated", employees: 32 } });
  assert.equal(step(before, "disburse").state, "waiting");
  assert.match(step(before, "disburse").detail, /only move against an approved run/);

  const after = input({ run: { version: 1, status: "approved", employees: 32 } });
  assert.equal(step(after, "disburse").state, "ready");
  assert.equal(step(after, "approve").state, "done");
});

test("a closed period reports every stage complete", () => {
  const i = input({ run: { version: 1, status: "closed", employees: 32 }, variablePayCount: 2 });
  assert.equal(step(i, "disburse").state, "done");
  assert.equal(step(i, "close").state, "done");
  assert.equal(nextStep(buildRunSteps(i, Q)), null, "nothing left to do");
});

test("variable pay reports what was entered, not an instruction", () => {
  const none = input();
  assert.equal(step(none, "variable").state, "ready");

  const some = input({ variablePayCount: 2, variablePayNetPaise: 450_000 });
  assert.equal(step(some, "variable").state, "done");
  assert.match(step(some, "variable").detail, /2 entries · ₹4,500 net/);
});

test("progress counts only finished steps", () => {
  const p = progressOf(buildRunSteps(input(), Q));
  assert.equal(p.total, 9);
  assert.ok(p.done < p.total);
});
