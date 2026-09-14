import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateTemplate,
  resolveAssignees,
  startInstance,
  decide,
  overdueSteps,
  EXIT_CLEARANCE_TEMPLATE as T,
  type Directory,
  type WorkflowTemplate,
  type InstanceState,
} from "./engine";

const directory: Directory = {
  reportingManagerOf: (id) => (id === "orphan" ? null : "manager@x.in"),
  usersWithRole: (role) =>
    role === "hr_manager"
      ? ["hr@x.in"]
      : role === "payroll_manager"
        ? ["payroll@x.in"]
        : role === "admin"
          ? ["admin@x.in"]
          : [],
  departmentOwners: (dept) =>
    dept === "it" ? ["it@x.in"] : dept === "admin" ? ["facilities@x.in"] : [],
};

const resolve = (subject = "e1") => (step: WorkflowTemplate["steps"][number]) =>
  resolveAssignees({
    rule: step.assignee,
    subjectEmployeeId: subject,
    companyId: "c1",
    directory,
    fallbackRole: "admin",
  }).assignees;

const start = () =>
  startInstance({ template: T, resolve: resolve(), now: "2026-09-01T10:00:00Z" });

function act(
  state: InstanceState,
  stepKey: string,
  decision: "approve" | "reject" | "complete",
  actor: string,
  comment: string | null = null,
) {
  return decide({
    template: T,
    state,
    stepKey,
    decision,
    actor,
    comment,
    now: "2026-09-02T10:00:00Z",
    resolve: resolve(),
  });
}

/* ---------------- template validation ---------------- */

test("the shipped exit template is valid", () => {
  const r = validateTemplate(T);
  assert.equal(r.valid, true, r.errors.join("; "));
});

test("a template with no steps is refused", () => {
  const r = validateTemplate({ ...T, steps: [] });
  assert.ok(r.errors.some((e) => e.includes("no steps")));
});

test("duplicate step keys are refused", () => {
  const r = validateTemplate({ ...T, steps: [T.steps[0], { ...T.steps[1], key: T.steps[0].key }] });
  assert.ok(r.errors.some((e) => e.includes("share the key")));
});

test("a gap in the group sequence is refused, since it would skip a group", () => {
  const r = validateTemplate({
    ...T,
    steps: [{ ...T.steps[0], group: 1 }, { ...T.steps[1], group: 3 }],
  });
  assert.ok(r.errors.some((e) => e.includes("without gaps")));
});

test("an impossible SLA is refused", () => {
  const r = validateTemplate({ ...T, steps: [{ ...T.steps[0], slaDays: -1 }] });
  assert.ok(r.errors.some((e) => e.includes("sensible deadline")));
});

test("assigning to one named person is allowed but warned", () => {
  const r = validateTemplate({
    ...T,
    steps: [{ ...T.steps[0], assignee: { kind: "user", email: "one@x.in" } }],
  });
  assert.equal(r.valid, true);
  assert.ok(r.warnings.some((w) => w.includes("workflow stalls")));
});

test("a malformed step key is refused", () => {
  const r = validateTemplate({ ...T, steps: [{ ...T.steps[0], key: "Bad Key!" }] });
  assert.equal(r.valid, false);
});

/* ---------------- assignee resolution ---------------- */

test("reporting manager resolves to the subject's manager", () => {
  const r = resolveAssignees({
    rule: { kind: "reporting_manager" },
    subjectEmployeeId: "e1",
    companyId: "c1",
    directory,
    fallbackRole: "admin",
  });
  assert.deepEqual(r.assignees, ["manager@x.in"]);
  assert.equal(r.unassigned, false);
});

test("no manager falls back to a role rather than leaving the step ownerless", () => {
  const r = resolveAssignees({
    rule: { kind: "reporting_manager" },
    subjectEmployeeId: "orphan",
    companyId: "c1",
    directory,
    fallbackRole: "admin",
  });
  assert.deepEqual(r.assignees, ["admin@x.in"]);
  assert.match(r.note, /routed to admin instead/);
});

test("a role nobody holds, with no fallback either, is flagged unassigned", () => {
  const r = resolveAssignees({
    rule: { kind: "role", role: "treasurer" },
    subjectEmployeeId: "e1",
    companyId: "c1",
    directory,
    fallbackRole: "nobody_role",
  });
  assert.equal(r.unassigned, true);
});

test("a department resolves to its owners", () => {
  const r = resolveAssignees({
    rule: { kind: "department", department: "it" },
    subjectEmployeeId: "e1",
    companyId: "c1",
    directory,
    fallbackRole: "admin",
  });
  assert.deepEqual(r.assignees, ["it@x.in"]);
});

/* ---------------- starting ---------------- */

test("starting opens only the first group", () => {
  const s = start();
  assert.equal(s.status, "running");
  assert.equal(s.currentGroup, 1);
  assert.equal(s.steps.find((x) => x.key === "manager_approval")!.status, "open");
  assert.equal(s.steps.find((x) => x.key === "it_revocation")!.status, "waiting");
});

test("waiting steps have no assignees yet, since who owns them can change", () => {
  const s = start();
  assert.deepEqual(s.steps.find((x) => x.key === "hr_fnf")!.assignees, []);
});

/* ---------------- transitions ---------------- */

test("the manager's approval opens IT and Admin together", () => {
  const r = act(start(), "manager_approval", "approve", "manager@x.in");
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.state.currentGroup, 2);
  assert.equal(r.state.steps.find((x) => x.key === "it_revocation")!.status, "open");
  assert.equal(r.state.steps.find((x) => x.key === "admin_assets")!.status, "open");
  assert.deepEqual(r.state.steps.find((x) => x.key === "it_revocation")!.assignees, ["it@x.in"]);
});

test("a parallel group waits for every sibling before advancing", () => {
  let r = act(start(), "manager_approval", "approve", "manager@x.in");
  assert.ok(r.ok); if (!r.ok) return;
  r = act(r.state, "it_revocation", "complete", "it@x.in");
  assert.ok(r.ok); if (!r.ok) return;
  assert.equal(r.state.currentGroup, 2, "Admin has not finished");
  assert.equal(r.state.steps.find((x) => x.key === "hr_fnf")!.status, "waiting");

  r = act(r.state, "admin_assets", "complete", "facilities@x.in");
  assert.ok(r.ok); if (!r.ok) return;
  assert.equal(r.state.currentGroup, 3);
  assert.equal(r.state.steps.find((x) => x.key === "hr_fnf")!.status, "open");
});

test("the full route completes the workflow", () => {
  let s = start();
  for (const [key, decision, actor] of [
    ["manager_approval", "approve", "manager@x.in"],
    ["it_revocation", "complete", "it@x.in"],
    ["admin_assets", "complete", "facilities@x.in"],
    ["hr_fnf", "complete", "hr@x.in"],
    ["payroll_signoff", "approve", "payroll@x.in"],
  ] as const) {
    const r = act(s, key, decision, actor);
    assert.ok(r.ok, r.ok ? "" : r.error);
    if (!r.ok) return;
    s = r.state;
  }
  assert.equal(s.status, "completed");
  assert.equal(s.currentGroup, null);
});

test("someone not assigned to the step cannot act on it", () => {
  const r = act(start(), "manager_approval", "approve", "stranger@x.in");
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /not to you/);
});

test("a step that is not open yet cannot be acted on", () => {
  const r = act(start(), "hr_fnf", "complete", "hr@x.in");
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /not open yet/);
});

test("a step cannot be decided twice", () => {
  const first = act(start(), "manager_approval", "approve", "manager@x.in");
  assert.ok(first.ok); if (!first.ok) return;
  const second = act(first.state, "manager_approval", "approve", "manager@x.in");
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.match(second.error, /already been approved/);
});

test("a task cannot be approved and an approval cannot be completed", () => {
  const taskApprove = decide({
    template: T,
    state: (act(start(), "manager_approval", "approve", "manager@x.in") as { ok: true; state: InstanceState }).state,
    stepKey: "it_revocation",
    decision: "approve",
    actor: "it@x.in",
    comment: null,
    now: "2026-09-03T10:00:00Z",
    resolve: resolve(),
  });
  assert.equal(taskApprove.ok, false);

  const approvalComplete = act(start(), "manager_approval", "complete", "manager@x.in");
  assert.equal(approvalComplete.ok, false);
});

test("a rejection without a reason is refused", () => {
  const r = act(start(), "manager_approval", "reject", "manager@x.in", null);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /reason/);
});

test("a rejection that ends the workflow skips everything downstream", () => {
  const r = act(start(), "manager_approval", "reject", "manager@x.in", "Resignation withdrawn");
  assert.ok(r.ok); if (!r.ok) return;
  assert.equal(r.state.status, "rejected");
  assert.ok(
    r.state.steps.filter((s) => s.key !== "manager_approval").every((s) => s.status === "skipped"),
  );
});

test("nothing can be decided on a finished workflow", () => {
  const rejected = act(start(), "manager_approval", "reject", "manager@x.in", "Withdrawn");
  assert.ok(rejected.ok); if (!rejected.ok) return;
  const r = act(rejected.state, "it_revocation", "complete", "it@x.in");
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /rejected/);
});

test("every transition reports what happened, for the execution log", () => {
  const r = act(start(), "manager_approval", "approve", "manager@x.in");
  assert.ok(r.ok); if (!r.ok) return;
  assert.ok(r.events.some((e) => e.message.includes("approved by manager@x.in")));
  assert.ok(r.events.some((e) => e.message.includes("opened for it@x.in")));
});

test("a decision does not mutate the state it was given", () => {
  const s = start();
  const snapshot = JSON.stringify(s);
  act(s, "manager_approval", "approve", "manager@x.in");
  assert.equal(JSON.stringify(s), snapshot);
});

/* ---------------- SLA ---------------- */

test("a step open past its SLA is overdue", () => {
  const overdue = overdueSteps({ template: T, state: start(), today: "2026-09-10" });
  assert.equal(overdue.length, 1);
  assert.equal(overdue[0].key, "manager_approval");
  assert.equal(overdue[0].daysOverdue, 6, "9 days open against a 3-day SLA");
});

test("a step within its SLA is not overdue", () => {
  assert.equal(overdueSteps({ template: T, state: start(), today: "2026-09-03" }).length, 0);
});

test("decided steps are never overdue", () => {
  const r = act(start(), "manager_approval", "approve", "manager@x.in");
  assert.ok(r.ok); if (!r.ok) return;
  const overdue = overdueSteps({ template: T, state: r.state, today: "2026-09-30" });
  assert.ok(!overdue.some((o) => o.key === "manager_approval"));
});
