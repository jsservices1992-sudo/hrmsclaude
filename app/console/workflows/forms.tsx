"use client";

import { useActionState, useState } from "react";
import {
  actOnStep,
  saveTemplate,
  startExitWorkflow,
  startPendingExitWorkflows,
  type WorkflowState,
} from "./actions";
import type { WorkflowStep, AssigneeRule } from "@/lib/workflow/engine";
import { Input, Select, SubmitButton, FormFeedback } from "@/components/console/ui";

export function StepActionForm({
  instanceId,
  stepKey,
  type,
}: {
  instanceId: string;
  stepKey: string;
  type: "approval" | "task";
}) {
  const [state, action] = useActionState<WorkflowState, FormData>(actOnStep, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="instanceId" value={instanceId} />
      <input type="hidden" name="stepKey" value={stepKey} />
      <Input
        name="comment"
        placeholder={type === "approval" ? "Comment (required to reject)" : "Note (optional)"}
        className="w-56"
      />
      {type === "approval" ? (
        <>
          <SubmitButton
            name="decision"
            value="approve"
            size="sm"
            className="hover:border-teal hover:text-teal"
          >
            Approve
          </SubmitButton>
          <SubmitButton
            name="decision"
            value="reject"
            size="sm"
            className="hover:border-rust hover:text-rust"
          >
            Reject
          </SubmitButton>
        </>
      ) : (
        <SubmitButton
          name="decision"
          value="complete"
          size="sm"
          className="hover:border-teal hover:text-teal"
        >
          Mark done
        </SubmitButton>
      )}
      <FormFeedback state={state} />
    </form>
  );
}

export function StartExitWorkflowForm({ exitCaseId }: { exitCaseId: string }) {
  const [state, action] = useActionState<WorkflowState, FormData>(startExitWorkflow, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="exitCaseId" value={exitCaseId} />
      <SubmitButton size="sm" pendingText="Working…">Start clearance workflow</SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

export function StartPendingForm({ companyId }: { companyId: string }) {
  const [state, action] = useActionState<WorkflowState, FormData>(
    startPendingExitWorkflows,
    {},
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="companyId" value={companyId} />
      <SubmitButton size="sm" pendingText="Working…">Start for accepted exits</SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

const ASSIGNEE_LABEL: Record<AssigneeRule["kind"], string> = {
  reporting_manager: "Reporting manager",
  role: "A role",
  department: "A department",
  user: "A named person",
};

/**
 * The no-code builder: an ordered list of steps, each with a type, an
 * owner rule, an SLA and a group. Steps sharing a group run in parallel.
 * It is a form rather than a drag-and-drop canvas — the rules are the
 * same, and the engine validates whatever is built before it is saved.
 */
export function TemplateBuilder({
  templateId,
  name: initialName,
  steps: initialSteps,
  editable,
}: {
  templateId: string;
  name: string;
  steps: WorkflowStep[];
  editable: boolean;
}) {
  const [state, action] = useActionState<WorkflowState, FormData>(saveTemplate, {});
  const [name, setName] = useState(initialName);
  const [steps, setSteps] = useState<WorkflowStep[]>(initialSteps);

  const update = (i: number, patch: Partial<WorkflowStep>) =>
    setSteps((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const move = (i: number, dir: -1 | 1) =>
    setSteps((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const setAssignee = (i: number, kind: AssigneeRule["kind"]) => {
    const rule: AssigneeRule =
      kind === "role"
        ? { kind: "role", role: "hr_manager" }
        : kind === "department"
          ? { kind: "department", department: "it" }
          : kind === "user"
            ? { kind: "user", email: "" }
            : { kind: "reporting_manager" };
    update(i, { assignee: rule });
  };

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="templateId" value={templateId} />
      <input type="hidden" name="stepsJson" value={JSON.stringify(steps)} />

      <label className="flex flex-col gap-1 max-w-md">
        <span className="label text-ink-3">Template name</span>
        <Input
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!editable}
        />
      </label>

      <ol className="flex flex-col gap-2">
        {steps.map((step, i) => (
          <li key={i} className="border border-line bg-surface px-3 py-3 flex flex-col gap-2">
            <div className="flex flex-wrap items-end gap-2">
              <span className="font-mono text-xs text-ink-3 w-6 pb-2">{i + 1}.</span>
              <label className="flex flex-col gap-1 flex-1 min-w-[16rem]">
                <span className="label text-ink-3">Step</span>
                <Input
                  value={step.label}
                  onChange={(e) => update(i, { label: e.target.value })}
                  disabled={!editable}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="label text-ink-3">Kind</span>
                <Select
                  value={step.type}
                  onChange={(e) => update(i, { type: e.target.value as WorkflowStep["type"] })}
                  disabled={!editable}
                >
                  <option value="approval">Approval</option>
                  <option value="task">Task</option>
                </Select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="label text-ink-3">Owner</span>
                <Select
                  value={step.assignee.kind}
                  onChange={(e) => setAssignee(i, e.target.value as AssigneeRule["kind"])}
                  disabled={!editable}
                >
                  {Object.entries(ASSIGNEE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </label>
              {step.assignee.kind === "role" && (
                <label className="flex flex-col gap-1">
                  <span className="label text-ink-3">Role</span>
                  <Select
                    value={step.assignee.role}
                    onChange={(e) => update(i, { assignee: { kind: "role", role: e.target.value } })}
                    disabled={!editable}
                  >
                    <option value="hr_manager">HR manager</option>
                    <option value="payroll_manager">Payroll manager</option>
                    <option value="admin">Administrator</option>
                  </Select>
                </label>
              )}
              {step.assignee.kind === "department" && (
                <label className="flex flex-col gap-1">
                  <span className="label text-ink-3">Department</span>
                  <Input
                    value={step.assignee.department}
                    onChange={(e) =>
                      update(i, { assignee: { kind: "department", department: e.target.value } })
                    }
                    disabled={!editable}
                    className="w-28"
                  />
                </label>
              )}
              {step.assignee.kind === "user" && (
                <label className="flex flex-col gap-1">
                  <span className="label text-ink-3">Email</span>
                  <Input
                    value={step.assignee.email}
                    onChange={(e) => update(i, { assignee: { kind: "user", email: e.target.value } })}
                    disabled={!editable}
                    className="w-48"
                  />
                </label>
              )}
              <label className="flex flex-col gap-1">
                <span className="label text-ink-3">SLA days</span>
                <Input
                  type="number"
                  min={0}
                  value={step.slaDays}
                  onChange={(e) => update(i, { slaDays: Number(e.target.value) })}
                  disabled={!editable}
                  className="font-mono tnum w-20"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="label text-ink-3">Group</span>
                <Input
                  type="number"
                  min={1}
                  value={step.group}
                  onChange={(e) => update(i, { group: Number(e.target.value) })}
                  disabled={!editable}
                  className="font-mono tnum w-16"
                />
              </label>
            </div>
            {editable && (
              <div className="flex flex-wrap items-center gap-3 pl-8">
                <label className="flex items-center gap-1.5 text-xs text-ink-2">
                  <input
                    type="checkbox"
                    checked={step.rejectionEndsWorkflow}
                    onChange={(e) => update(i, { rejectionEndsWorkflow: e.target.checked })}
                  />
                  A rejection here stops the workflow
                </label>
                <button type="button" onClick={() => move(i, -1)} className="text-xs text-ink-3 hover:text-ink">
                  ↑ Up
                </button>
                <button type="button" onClick={() => move(i, 1)} className="text-xs text-ink-3 hover:text-ink">
                  ↓ Down
                </button>
                <button
                  type="button"
                  onClick={() => setSteps((prev) => prev.filter((_, j) => j !== i))}
                  className="text-xs text-rust hover:underline"
                >
                  Remove
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>

      {editable && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() =>
              setSteps((prev) => [
                ...prev,
                {
                  key: `step_${prev.length + 1}`,
                  label: "New step",
                  type: "task",
                  assignee: { kind: "role", role: "hr_manager" },
                  slaDays: 3,
                  group: Math.max(0, ...prev.map((p) => p.group)) + 1,
                  rejectionEndsWorkflow: false,
                },
              ])
            }
            className="px-3 py-1.5 text-xs border border-line bg-surface hover:border-ink-3"
          >
            + Add step
          </button>
          <SubmitButton pendingText="Saving…">Save template</SubmitButton>
          <span className="text-xs text-ink-3">
            Steps with the same group number run at the same time.
          </span>
        </div>
      )}
      <FormFeedback state={state} />
    </form>
  );
}
