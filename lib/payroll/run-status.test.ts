import test from "node:test";
import assert from "node:assert/strict";
import {
  isRecalculable, buildRunSteps, nextStep, progressOf, canApproveRun, type RunStatusInput } from "./run-status";

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
    attendanceEmployees: 32,
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

test("attendance says paid days, never the words loss of pay", () => {
  /* This is where "loss of pay" leaked back in once already, in the
     step detail rather than on the attendance table it was fixed on —
     the phrase nobody reading a payslip understands. */
  const withLop = input({ lopTotalDays: 4.5 });
  assert.doesNotMatch(step(withLop, "attendance").detail, /loss of pay/i);
  assert.match(step(withLop, "attendance").detail, /4\.50 day\(s\) will not be paid/);

  const none = input({ lopTotalDays: 0 });
  assert.match(step(none, "attendance").detail, /every active day is paid/i);
});

test("progress counts only finished steps", () => {
  const p = progressOf(buildRunSteps(input(), Q));
  assert.equal(p.total, 9);
  assert.ok(p.done < p.total);
});

test("a run that can still be recalculated is not figures of record", () => {
  for (const status of ["draft", "calculated", "in_review"]) {
    assert.equal(isRecalculable(status), true, `${status} should still be open`);
  }
  for (const status of ["approved", "finalised", "disbursed", "closed"]) {
    assert.equal(isRecalculable(status), false, `${status} is signed off`);
  }
  assert.equal(isRecalculable(null), false, "no run at all is not recalculable");
  assert.equal(isRecalculable(undefined), false);
});


test("the preparer cannot approve their own run while the rule is on", () => {
  const run = { status: "calculated", preparedBy: "asha@x.in" };
  assert.equal(canApproveRun({ email: "asha@x.in" }, run, true), false);
  assert.equal(canApproveRun({ email: "ravi@x.in" }, run, true), true);
});

test("turning the rule off lets the preparer approve — a company of one", () => {
  /* The switch exists under Settings → Payroll → Controls and the server
     action already honoured it; the screens did not, so the button never
     appeared and the setting did nothing. */
  const run = { status: "calculated", preparedBy: "asha@x.in" };
  assert.equal(canApproveRun({ email: "asha@x.in" }, run, true, false), true);
});

test("nothing else about approval is relaxed by turning the rule off", () => {
  const run = { status: "draft", preparedBy: "asha@x.in" };
  assert.equal(canApproveRun({ email: "asha@x.in" }, run, true, false), false, "a draft is not approvable");
  assert.equal(
    canApproveRun({ email: "asha@x.in" }, { status: "calculated", preparedBy: "asha@x.in" }, false, false),
    false,
    "somebody without the right to change payroll still cannot approve",
  );
});

test("a period with no attendance on record is not reported as settled", () => {
  /* Nothing uploaded looks exactly like everybody present: zero days of
     loss of pay. Saying "every active day is paid · done" is how a month
     goes out paying everyone in full when the file never landed. */
  const steps = buildRunSteps(
    input({ activeEmployees: 24, attendanceEmployees: 0, lopTotalDays: 0 }),
    Q,
  );
  const attendance = steps.find((s) => s.id === "attendance")!;
  assert.equal(attendance.state, "attention");
  assert.match(attendance.detail, /Nothing on record/);
});

test("some people with nothing on record is said out loud", () => {
  const steps = buildRunSteps(
    input({ activeEmployees: 24, attendanceEmployees: 20, lopTotalDays: 0 }),
    Q,
  );
  assert.match(steps.find((s) => s.id === "attendance")!.detail, /4 with nothing on record/);
});

test("a full month with everybody marked is still done", () => {
  const steps = buildRunSteps(
    input({ activeEmployees: 24, attendanceEmployees: 24, lopTotalDays: 0 }),
    Q,
  );
  const attendance = steps.find((s) => s.id === "attendance")!;
  assert.equal(attendance.state, "done");
  assert.match(attendance.detail, /Every active day is paid/);
});
