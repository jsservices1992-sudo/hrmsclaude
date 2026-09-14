import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import {
  decide,
  overdueSteps,
  resolveAssignees,
  startInstance,
  validateTemplate,
  EXIT_CLEARANCE_TEMPLATE,
  type Decision,
  type Directory,
  type InstanceState,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowTemplate,
} from "./engine";

/**
 * Binding the pure engine to real people and records. The engine decides;
 * this file only loads what it needs and saves what it returns.
 */

/** Every step that resolves to nobody lands with an administrator. */
const FALLBACK_ROLE = "admin";

export async function buildDirectory(companyId: string): Promise<Directory> {
  const users = await db.select().from(s.users).where(eq(s.users.active, true));
  const employees = await db
    .select({ id: s.employees.id, managerId: s.employees.managerId, email: s.employees.email })
    .from(s.employees)
    .where(eq(s.employees.companyId, companyId));

  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const loginByEmployee = new Map(
    users.filter((u) => u.employeeId).map((u) => [u.employeeId!, u.email]),
  );

  return {
    // The manager must be able to sign in, or the step goes to nobody. An
    // employee record's email is not a login, so it is not used here.
    reportingManagerOf: (employeeId) => {
      const managerId = employeeById.get(employeeId)?.managerId;
      return managerId ? (loginByEmployee.get(managerId) ?? null) : null;
    },
    usersWithRole: (role, cid) =>
      users
        .filter((u) => u.role === role && (u.companyId === null || u.companyId === cid))
        .map((u) => u.email),
    // Department ownership is not modelled yet, so these steps fall back to
    // an administrator — and the step says so rather than pretending.
    departmentOwners: () => [],
  };
}

export function parseTemplate(row: typeof s.workflowTemplates.$inferSelect): WorkflowTemplate {
  return {
    code: row.code,
    name: row.name,
    trigger: row.trigger as WorkflowTemplate["trigger"],
    steps: JSON.parse(row.stepsJson) as WorkflowStep[],
  };
}

/** Install the shipped templates for a company that has none. */
export async function ensureTemplates(companyId: string, actor = "system") {
  const existing = await db
    .select()
    .from(s.workflowTemplates)
    .where(
      and(
        eq(s.workflowTemplates.companyId, companyId),
        eq(s.workflowTemplates.code, EXIT_CLEARANCE_TEMPLATE.code),
      ),
    )
    .limit(1);
  if (existing.length > 0) return existing[0];

  const row = {
    id: randomUUID(),
    companyId,
    code: EXIT_CLEARANCE_TEMPLATE.code,
    name: EXIT_CLEARANCE_TEMPLATE.name,
    trigger: EXIT_CLEARANCE_TEMPLATE.trigger,
    stepsJson: JSON.stringify(EXIT_CLEARANCE_TEMPLATE.steps),
    version: 1,
    active: true,
    updatedBy: actor,
    updatedAt: new Date().toISOString(),
  };
  await db.insert(s.workflowTemplates).values(row);
  return row;
}

async function log(instanceId: string, actor: string, events: WorkflowEvent[]) {
  if (events.length === 0) return;
  const at = new Date().toISOString();
  await db.insert(s.workflowEvents).values(
    events.map((e) => ({
      id: randomUUID(),
      instanceId,
      at,
      actor,
      stepKey: e.stepKey,
      message: e.message,
    })),
  );
}

/**
 * Start a workflow for a record. Starting twice for the same record is a
 * no-op rather than a duplicate, because triggers fire more than once.
 */
export async function startWorkflow(args: {
  companyId: string;
  templateCode: string;
  subjectEmployeeId: string;
  sourceEntity: string;
  sourceId: string;
  actor: string;
}): Promise<{ ok: true; instanceId: string; created: boolean } | { ok: false; error: string }> {
  await ensureTemplates(args.companyId, args.actor);

  const [templateRow] = await db
    .select()
    .from(s.workflowTemplates)
    .where(
      and(
        eq(s.workflowTemplates.companyId, args.companyId),
        eq(s.workflowTemplates.code, args.templateCode),
        eq(s.workflowTemplates.active, true),
      ),
    )
    .limit(1);
  if (!templateRow) return { ok: false, error: "No active template for this workflow." };

  const [existing] = await db
    .select()
    .from(s.workflowInstances)
    .where(
      and(
        eq(s.workflowInstances.templateId, templateRow.id),
        eq(s.workflowInstances.sourceEntity, args.sourceEntity),
        eq(s.workflowInstances.sourceId, args.sourceId),
      ),
    )
    .limit(1);
  if (existing) return { ok: true, instanceId: existing.id, created: false };

  const template = parseTemplate(templateRow);
  const check = validateTemplate(template);
  if (!check.valid) return { ok: false, error: check.errors.join(" ") };

  const directory = await buildDirectory(args.companyId);
  const opened: WorkflowEvent[] = [];
  const resolve = (step: WorkflowStep) => {
    const r = resolveAssignees({
      rule: step.assignee,
      subjectEmployeeId: args.subjectEmployeeId,
      companyId: args.companyId,
      directory,
      fallbackRole: FALLBACK_ROLE,
    });
    // Name who it went to, and why — a fallback to admin should be visible.
    opened.push({
      stepKey: step.key,
      message: `${step.label}: opened for ${r.assignees.join(", ") || "nobody"} (${r.note})`,
    });
    return r.assignees;
  };

  const now = new Date().toISOString();
  const state = startInstance({ template, resolve, now });
  const id = randomUUID();

  await db.insert(s.workflowInstances).values({
    id,
    templateId: templateRow.id,
    templateVersion: templateRow.version,
    templateStepsJson: templateRow.stepsJson,
    companyId: args.companyId,
    subjectEmployeeId: args.subjectEmployeeId,
    sourceEntity: args.sourceEntity,
    sourceId: args.sourceId,
    status: state.status,
    stateJson: JSON.stringify(state),
    startedAt: now,
    finishedAt: null,
  });

  await log(id, args.actor, [
    { stepKey: null, message: `Started from ${args.sourceEntity} ${args.sourceId}` },
    ...opened,
  ]);
  return { ok: true, instanceId: id, created: true };
}

export async function decideStep(args: {
  instanceId: string;
  stepKey: string;
  decision: Decision;
  actor: string;
  comment: string | null;
}): Promise<{ ok: true; status: string; events: WorkflowEvent[] } | { ok: false; error: string }> {
  const [row] = await db
    .select()
    .from(s.workflowInstances)
    .where(eq(s.workflowInstances.id, args.instanceId))
    .limit(1);
  if (!row) return { ok: false, error: "Workflow not found." };

  // Decide against the template the instance started on, not today's.
  const template: WorkflowTemplate = {
    code: "",
    name: "",
    trigger: "resignation_accepted",
    steps: JSON.parse(row.templateStepsJson),
  };
  const directory = await buildDirectory(row.companyId);

  const result = decide({
    template,
    state: JSON.parse(row.stateJson) as InstanceState,
    stepKey: args.stepKey,
    decision: args.decision,
    actor: args.actor,
    comment: args.comment,
    now: new Date().toISOString(),
    resolve: (step) =>
      resolveAssignees({
        rule: step.assignee,
        subjectEmployeeId: row.subjectEmployeeId,
        companyId: row.companyId,
        directory,
        fallbackRole: FALLBACK_ROLE,
      }).assignees,
  });

  if (!result.ok) return result;

  const finished = result.state.status !== "running";
  await db
    .update(s.workflowInstances)
    .set({
      status: result.state.status,
      stateJson: JSON.stringify(result.state),
      finishedAt: finished ? new Date().toISOString() : null,
    })
    .where(eq(s.workflowInstances.id, args.instanceId));

  await log(
    args.instanceId,
    args.actor,
    args.comment
      ? [
          result.events[0],
          { stepKey: args.stepKey, message: `Comment: ${args.comment}` },
          ...result.events.slice(1),
        ]
      : result.events,
  );

  return { ok: true, status: result.state.status, events: result.events };
}

/* ==================================================================
   Reading
   ================================================================== */

export type InboxItem = {
  instanceId: string;
  templateName: string;
  stepKey: string;
  stepLabel: string;
  stepType: "approval" | "task";
  subjectName: string;
  subjectCode: string;
  sourceEntity: string;
  sourceId: string;
  openedAt: string | null;
  daysOverdue: number;
};

/** Everything waiting on this person, most overdue first. */
export async function loadInbox(email: string): Promise<InboxItem[]> {
  const rows = await db
    .select({ inst: s.workflowInstances, tpl: s.workflowTemplates, emp: s.employees })
    .from(s.workflowInstances)
    .innerJoin(s.workflowTemplates, eq(s.workflowInstances.templateId, s.workflowTemplates.id))
    .innerJoin(s.employees, eq(s.workflowInstances.subjectEmployeeId, s.employees.id))
    .where(eq(s.workflowInstances.status, "running"));

  const today = new Date().toISOString().slice(0, 10);
  const items: InboxItem[] = [];

  for (const { inst, tpl, emp } of rows) {
    const state = JSON.parse(inst.stateJson) as InstanceState;
    const steps = JSON.parse(inst.templateStepsJson) as WorkflowStep[];
    const overdue = overdueSteps({
      template: { code: "", name: "", trigger: "resignation_accepted", steps },
      state,
      today,
    });

    for (const step of state.steps) {
      if (step.status !== "open" || !step.assignees.includes(email)) continue;
      const def = steps.find((d) => d.key === step.key)!;
      items.push({
        instanceId: inst.id,
        templateName: tpl.name,
        stepKey: step.key,
        stepLabel: def.label,
        stepType: def.type,
        subjectName: `${emp.firstName} ${emp.lastName}`,
        subjectCode: emp.empCode,
        sourceEntity: inst.sourceEntity,
        sourceId: inst.sourceId,
        openedAt: step.openedAt,
        daysOverdue: overdue.find((o) => o.key === step.key)?.daysOverdue ?? 0,
      });
    }
  }

  return items.sort((a, b) => b.daysOverdue - a.daysOverdue);
}

export async function loadInstances(companyIds: string[]) {
  if (companyIds.length === 0) return [];
  const rows = await db
    .select({ inst: s.workflowInstances, tpl: s.workflowTemplates, emp: s.employees })
    .from(s.workflowInstances)
    .innerJoin(s.workflowTemplates, eq(s.workflowInstances.templateId, s.workflowTemplates.id))
    .innerJoin(s.employees, eq(s.workflowInstances.subjectEmployeeId, s.employees.id))
    .where(inArray(s.workflowInstances.companyId, companyIds))
    .orderBy(desc(s.workflowInstances.startedAt));

  const today = new Date().toISOString().slice(0, 10);
  return rows.map(({ inst, tpl, emp }) => {
    const state = JSON.parse(inst.stateJson) as InstanceState;
    const steps = JSON.parse(inst.templateStepsJson) as WorkflowStep[];
    return {
      instance: inst,
      templateName: tpl.name,
      subjectName: `${emp.firstName} ${emp.lastName}`,
      subjectCode: emp.empCode,
      state,
      steps,
      overdue: overdueSteps({
        template: { code: "", name: "", trigger: "resignation_accepted", steps },
        state,
        today,
      }),
    };
  });
}

export async function loadInstance(instanceId: string) {
  const [row] = await db
    .select({ inst: s.workflowInstances, tpl: s.workflowTemplates, emp: s.employees })
    .from(s.workflowInstances)
    .innerJoin(s.workflowTemplates, eq(s.workflowInstances.templateId, s.workflowTemplates.id))
    .innerJoin(s.employees, eq(s.workflowInstances.subjectEmployeeId, s.employees.id))
    .where(eq(s.workflowInstances.id, instanceId))
    .limit(1);
  if (!row) return null;

  const events = await db
    .select()
    .from(s.workflowEvents)
    .where(eq(s.workflowEvents.instanceId, instanceId))
    .orderBy(asc(s.workflowEvents.at));

  const steps = JSON.parse(row.inst.templateStepsJson) as WorkflowStep[];
  const state = JSON.parse(row.inst.stateJson) as InstanceState;

  return {
    instance: row.inst,
    templateName: row.tpl.name,
    subject: row.emp,
    steps,
    state,
    events,
    overdue: overdueSteps({
      template: { code: "", name: "", trigger: "resignation_accepted", steps },
      state,
      today: new Date().toISOString().slice(0, 10),
    }),
  };
}
