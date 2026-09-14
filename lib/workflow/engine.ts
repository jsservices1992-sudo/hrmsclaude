/**
 * The workflow engine — PRD §3.17.
 *
 * The PRD's first differentiator is "a no-code workflow and policy builder
 * that is a real engine, not an add-on". What makes it real is that the
 * rules live here, as data interpreted by pure functions: a template is a
 * list of steps, an instance is a template bound to a subject, and every
 * transition is decided by the code below rather than by whichever screen
 * happened to call it.
 */

export type AssigneeRule =
  | { kind: "reporting_manager" }
  | { kind: "role"; role: string }
  | { kind: "department"; department: string }
  | { kind: "user"; email: string };

export type StepType = "approval" | "task";

export type WorkflowStep = {
  key: string;
  label: string;
  type: StepType;
  assignee: AssigneeRule;
  /** Days from the step opening until it is overdue. */
  slaDays: number;
  /**
   * Steps sharing a group run in parallel; groups run in ascending order.
   * Exit clearance is the canonical case: IT and Admin at the same time,
   * then HR and Payroll once both are done.
   */
  group: number;
  /** A rejection here ends the workflow rather than sending it back. */
  rejectionEndsWorkflow: boolean;
};

export type WorkflowTemplate = {
  code: string;
  name: string;
  trigger: TriggerEvent;
  steps: WorkflowStep[];
};

export type TriggerEvent =
  | "resignation_accepted"
  | "termination_approved"
  | "probation_due"
  | "salary_revision_requested"
  | "joiner_created";

/* ==================================================================
   Template validation
   ================================================================== */

export type TemplateCheck = { valid: boolean; errors: string[]; warnings: string[] };

/**
 * A template someone builds without code must be checked before it can
 * run, because nobody is going to read the resulting state machine.
 */
export function validateTemplate(template: WorkflowTemplate): TemplateCheck {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!template.name.trim()) errors.push("The template needs a name.");
  if (template.steps.length === 0) {
    errors.push("A workflow with no steps does nothing.");
  }

  const keys = new Set<string>();
  for (const step of template.steps) {
    if (!step.key || !/^[a-z0-9_]+$/.test(step.key)) {
      errors.push(`Step "${step.label}" needs a key of lower-case letters, digits and underscores.`);
    }
    if (keys.has(step.key)) {
      errors.push(`Two steps share the key "${step.key}".`);
    }
    keys.add(step.key);

    if (!step.label.trim()) errors.push("Every step needs a label.");
    if (!Number.isInteger(step.slaDays) || step.slaDays < 0 || step.slaDays > 365) {
      errors.push(`"${step.label}" has an SLA of ${step.slaDays} days, which is not a sensible deadline.`);
    }
    if (!Number.isInteger(step.group) || step.group < 1) {
      errors.push(`"${step.label}" must be in a group numbered from 1.`);
    }
    if (step.assignee.kind === "role" && !step.assignee.role) {
      errors.push(`"${step.label}" is assigned to a role but names none.`);
    }
    if (step.assignee.kind === "user" && !/.+@.+/.test(step.assignee.email)) {
      errors.push(`"${step.label}" is assigned to an address that is not an email.`);
    }
    if (step.assignee.kind === "user") {
      warnings.push(
        `"${step.label}" is assigned to one named person. If they leave or are away, the workflow stalls — a role is usually safer.`,
      );
    }
  }

  // Groups must run 1, 2, 3 with no gaps, or a group is silently skipped.
  const groups = [...new Set(template.steps.map((s) => s.group))].sort((a, b) => a - b);
  groups.forEach((g, i) => {
    if (g !== i + 1) {
      errors.push(
        `Step groups must run in sequence from 1 without gaps; found ${groups.join(", ")}.`,
      );
    }
  });

  return { valid: errors.length === 0, errors: [...new Set(errors)], warnings };
}

/* ==================================================================
   Assignee resolution
   ================================================================== */

export type Directory = {
  /** Email of the subject's reporting manager, if any. */
  reportingManagerOf: (employeeId: string) => string | null;
  /** Users holding a role in the subject's company. */
  usersWithRole: (role: string, companyId: string) => string[];
  /** Users responsible for a department. */
  departmentOwners: (department: string, companyId: string) => string[];
};

export type Resolution = {
  assignees: string[];
  /** Resolution failed and nobody would own the step. */
  unassigned: boolean;
  note: string;
};

export function resolveAssignees(args: {
  rule: AssigneeRule;
  subjectEmployeeId: string;
  companyId: string;
  directory: Directory;
  /** Who a step falls to when its rule resolves to nobody. */
  fallbackRole: string;
}): Resolution {
  const { rule, directory } = args;
  let assignees: string[] = [];
  let note = "";

  switch (rule.kind) {
    case "reporting_manager": {
      const manager = directory.reportingManagerOf(args.subjectEmployeeId);
      assignees = manager ? [manager] : [];
      note = manager ? "The subject's reporting manager" : "No reporting manager is recorded";
      break;
    }
    case "role":
      assignees = directory.usersWithRole(rule.role, args.companyId);
      note = `Anyone holding the ${rule.role.replace(/_/g, " ")} role`;
      break;
    case "department":
      assignees = directory.departmentOwners(rule.department, args.companyId);
      note = `The ${rule.department} owners`;
      break;
    case "user":
      assignees = [rule.email];
      note = "A named person";
      break;
  }

  // A step with no owner is how a workflow silently stops. It falls back
  // to a role that always exists, and says so.
  if (assignees.length === 0) {
    const fallback = directory.usersWithRole(args.fallbackRole, args.companyId);
    return {
      assignees: fallback,
      unassigned: fallback.length === 0,
      note: `${note} — routed to ${args.fallbackRole.replace(/_/g, " ")} instead`,
    };
  }

  return { assignees, unassigned: false, note };
}

/* ==================================================================
   Instance state
   ================================================================== */

export type StepState = {
  key: string;
  status: "waiting" | "open" | "approved" | "rejected" | "completed" | "skipped";
  assignees: string[];
  openedAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  comment: string | null;
};

export type InstanceStatus = "running" | "completed" | "rejected" | "cancelled";

export type InstanceState = {
  status: InstanceStatus;
  steps: StepState[];
  currentGroup: number | null;
};

/** Open the first group of a freshly created instance. */
export function startInstance(args: {
  template: WorkflowTemplate;
  resolve: (step: WorkflowStep) => string[];
  now: string;
}): InstanceState {
  const firstGroup = Math.min(...args.template.steps.map((s) => s.group));
  const steps = args.template.steps.map<StepState>((step) => ({
    key: step.key,
    status: step.group === firstGroup ? "open" : "waiting",
    assignees: step.group === firstGroup ? args.resolve(step) : [],
    openedAt: step.group === firstGroup ? args.now : null,
    decidedAt: null,
    decidedBy: null,
    comment: null,
  }));

  return { status: "running", steps, currentGroup: firstGroup };
}

export type Decision = "approve" | "reject" | "complete";

/** A line for the execution log, tied to the step it is about (null: the whole workflow). */
export type WorkflowEvent = { stepKey: string | null; message: string };

export type TransitionResult =
  | { ok: true; state: InstanceState; events: WorkflowEvent[] }
  | { ok: false; error: string };

/**
 * Record a decision and move the instance on.
 *
 * Everything that can go wrong in a workflow — someone acting on a step
 * that isn't theirs, acting twice, approving a task that has no approval,
 * advancing before a parallel sibling is done — is refused here, so no
 * screen can get it wrong.
 */
export function decide(args: {
  template: WorkflowTemplate;
  state: InstanceState;
  stepKey: string;
  decision: Decision;
  actor: string;
  comment: string | null;
  now: string;
  resolve: (step: WorkflowStep) => string[];
}): TransitionResult {
  if (args.state.status !== "running") {
    return { ok: false, error: `This workflow is ${args.state.status}; nothing more can be decided.` };
  }

  const def = args.template.steps.find((s) => s.key === args.stepKey);
  const current = args.state.steps.find((s) => s.key === args.stepKey);
  if (!def || !current) return { ok: false, error: "That step is not part of this workflow." };

  if (current.status !== "open") {
    return {
      ok: false,
      error:
        current.status === "waiting"
          ? `"${def.label}" is not open yet — it waits for the steps before it.`
          : `"${def.label}" has already been ${current.status}.`,
    };
  }

  if (!current.assignees.includes(args.actor)) {
    return {
      ok: false,
      error: `"${def.label}" is assigned to ${current.assignees.join(", ") || "nobody"}, not to you.`,
    };
  }

  if (def.type === "task" && args.decision !== "complete") {
    return { ok: false, error: `"${def.label}" is a task to complete, not something to approve or reject.` };
  }
  if (def.type === "approval" && args.decision === "complete") {
    return { ok: false, error: `"${def.label}" needs an approval or a rejection.` };
  }
  if (args.decision === "reject" && !args.comment?.trim()) {
    return { ok: false, error: "A rejection needs a reason the next person can act on." };
  }

  const events: WorkflowEvent[] = [];
  const steps = args.state.steps.map((s) => ({ ...s }));
  const target = steps.find((s) => s.key === args.stepKey)!;

  target.status =
    args.decision === "approve" ? "approved" : args.decision === "reject" ? "rejected" : "completed";
  target.decidedAt = args.now;
  target.decidedBy = args.actor;
  target.comment = args.comment;
  events.push({ stepKey: def.key, message: `${def.label}: ${target.status} by ${args.actor}` });

  if (args.decision === "reject" && def.rejectionEndsWorkflow) {
    // Nothing downstream should open once the workflow has been stopped.
    for (const s of steps) {
      if (s.status === "waiting" || s.status === "open") s.status = "skipped";
    }
    events.push({ stepKey: null, message: "Workflow rejected; the remaining steps were skipped" });
    return { ok: true, state: { status: "rejected", steps, currentGroup: null }, events };
  }

  // A group advances only when every step in it is finished.
  const group = def.group;
  const groupDone = args.template.steps
    .filter((s) => s.group === group)
    .every((s) => {
      const st = steps.find((x) => x.key === s.key)!;
      return st.status !== "open" && st.status !== "waiting";
    });

  if (!groupDone) {
    return { ok: true, state: { ...args.state, steps }, events };
  }

  const nextGroup = args.template.steps
    .map((s) => s.group)
    .filter((g) => g > group)
    .sort((a, b) => a - b)[0];

  if (nextGroup === undefined) {
    events.push({ stepKey: null, message: "All steps finished; workflow completed" });
    return { ok: true, state: { status: "completed", steps, currentGroup: null }, events };
  }

  for (const stepDef of args.template.steps.filter((s) => s.group === nextGroup)) {
    const st = steps.find((x) => x.key === stepDef.key)!;
    st.status = "open";
    st.openedAt = args.now;
    st.assignees = args.resolve(stepDef);
    events.push({
      stepKey: stepDef.key,
      message: `${stepDef.label}: opened for ${st.assignees.join(", ") || "nobody"}`,
    });
  }

  return { ok: true, state: { status: "running", steps, currentGroup: nextGroup }, events };
}

/* ==================================================================
   SLA
   ================================================================== */

export type OverdueStep = {
  key: string;
  label: string;
  assignees: string[];
  daysOpen: number;
  slaDays: number;
  daysOverdue: number;
};

export function overdueSteps(args: {
  template: WorkflowTemplate;
  state: InstanceState;
  today: string;
}): OverdueStep[] {
  const result: OverdueStep[] = [];
  for (const step of args.state.steps) {
    if (step.status !== "open" || !step.openedAt) continue;
    const def = args.template.steps.find((s) => s.key === step.key);
    if (!def) continue;
    const daysOpen = Math.floor(
      (Date.parse(args.today + "T00:00:00Z") -
        Date.parse(step.openedAt.slice(0, 10) + "T00:00:00Z")) /
        86_400_000,
    );
    if (daysOpen > def.slaDays) {
      result.push({
        key: step.key,
        label: def.label,
        assignees: step.assignees,
        daysOpen,
        slaDays: def.slaDays,
        daysOverdue: daysOpen - def.slaDays,
      });
    }
  }
  return result.sort((a, b) => b.daysOverdue - a.daysOverdue);
}

/* ==================================================================
   The shipped template — PRD §3.17
   ================================================================== */

/**
 * Exit & Clearance, as the PRD specifies: manager approval, then IT for
 * access revocation and Admin for asset return in parallel, then HR and
 * Payroll for F&F initiation and final sign-off.
 */
export const EXIT_CLEARANCE_TEMPLATE: WorkflowTemplate = {
  code: "EXIT_CLEARANCE",
  name: "Exit & clearance",
  trigger: "resignation_accepted",
  steps: [
    {
      key: "manager_approval",
      label: "Manager confirms the exit and handover",
      type: "approval",
      assignee: { kind: "reporting_manager" },
      slaDays: 3,
      group: 1,
      rejectionEndsWorkflow: true,
    },
    {
      key: "it_revocation",
      label: "IT revokes access and collects devices",
      type: "task",
      assignee: { kind: "department", department: "it" },
      slaDays: 2,
      group: 2,
      rejectionEndsWorkflow: false,
    },
    {
      key: "admin_assets",
      label: "Admin collects assets, cards and keys",
      type: "task",
      assignee: { kind: "department", department: "admin" },
      slaDays: 2,
      group: 2,
      rejectionEndsWorkflow: false,
    },
    {
      key: "hr_fnf",
      label: "HR initiates the full & final settlement",
      type: "task",
      assignee: { kind: "role", role: "hr_manager" },
      slaDays: 5,
      group: 3,
      rejectionEndsWorkflow: false,
    },
    {
      key: "payroll_signoff",
      label: "Payroll signs off the settlement",
      type: "approval",
      assignee: { kind: "role", role: "payroll_manager" },
      slaDays: 5,
      group: 4,
      rejectionEndsWorkflow: false,
    },
  ],
};
