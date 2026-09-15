"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSessionUser, canAccessCompany, canMutate,
  canActOnPeople,
} from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit/log";
import { decideStep, startWorkflow } from "@/lib/workflow/service";
import { validateTemplate, type WorkflowStep } from "@/lib/workflow/engine";

export type WorkflowState = { error?: string; ok?: string };

/**
 * Fire the exit trigger for an accepted exit — PRD §3.17: the Exit &
 * Clearance template "starts on Resignation Accepted or Termination
 * Approved".
 */
export async function startExitWorkflow(
  _prev: WorkflowState,
  fd: FormData,
): Promise<WorkflowState> {
  const user = await getSessionUser();
  if (!user || (!canActOnPeople(user))) {
    return { error: "Only HR or payroll may start a workflow." };
  }

  const exitCaseId = String(fd.get("exitCaseId") ?? "");
  const [row] = await db
    .select({ exit: s.exitCases, emp: s.employees })
    .from(s.exitCases)
    .innerJoin(s.employees, eq(s.exitCases.employeeId, s.employees.id))
    .where(eq(s.exitCases.id, exitCaseId))
    .limit(1);
  if (!row) return { error: "Exit case not found." };
  if (!canAccessCompany(user, row.emp.companyId)) return { error: "Not authorised." };

  if (!["accepted", "clearance"].includes(row.exit.status)) {
    return {
      error: `This exit is ${row.exit.status}. The clearance workflow starts once a resignation is accepted.`,
    };
  }

  const result = await startWorkflow({
    companyId: row.emp.companyId,
    templateCode: "EXIT_CLEARANCE",
    subjectEmployeeId: row.emp.id,
    sourceEntity: "exit_case",
    sourceId: exitCaseId,
    actor: user.email,
  });
  if (!result.ok) return { error: result.error };

  if (result.created) {
    await recordAudit({
      user,
      action: "workflow.started",
      entity: "workflow_instance",
      entityId: result.instanceId,
      after: { template: "EXIT_CLEARANCE", exitCaseId },
    });
  }

  revalidatePath("/console/workflows");
  revalidatePath(`/console/exits/${exitCaseId}`);
  return {
    ok: result.created
      ? "Clearance workflow started. The first step is with the reporting manager."
      : "A clearance workflow is already running for this exit.",
  };
}

/** Start the workflow for every accepted exit that does not have one. */
export async function startPendingExitWorkflows(
  _prev: WorkflowState,
  fd: FormData,
): Promise<WorkflowState> {
  const user = await getSessionUser();
  if (!user || (!canActOnPeople(user))) {
    return { error: "Only HR or payroll may start a workflow." };
  }
  const companyId = String(fd.get("companyId") ?? "");
  if (!canAccessCompany(user, companyId)) return { error: "Not authorised." };

  const exits = await db
    .select({ exit: s.exitCases, emp: s.employees })
    .from(s.exitCases)
    .innerJoin(s.employees, eq(s.exitCases.employeeId, s.employees.id))
    .where(
      and(
        eq(s.employees.companyId, companyId),
        inArray(s.exitCases.status, ["accepted", "clearance"]),
      ),
    );

  let started = 0;
  for (const { exit, emp } of exits) {
    const r = await startWorkflow({
      companyId,
      templateCode: "EXIT_CLEARANCE",
      subjectEmployeeId: emp.id,
      sourceEntity: "exit_case",
      sourceId: exit.id,
      actor: user.email,
    });
    if (r.ok && r.created) started++;
  }

  if (started > 0) {
    await recordAudit({
      user,
      action: "workflow.started",
      entity: "workflow_instance",
      entityId: companyId,
      after: { template: "EXIT_CLEARANCE" },
      affectedCount: started,
    });
  }

  revalidatePath("/console/workflows");
  return {
    ok:
      started === 0
        ? "Every accepted exit already has a workflow."
        : `Started ${started} clearance workflow(s).`,
  };
}

/**
 * Act on a step. Every rule — whose step it is, whether it is open,
 * whether a rejection has a reason — is enforced by the engine, so this
 * action cannot be used to skip one.
 */
export async function actOnStep(
  _prev: WorkflowState,
  fd: FormData,
): Promise<WorkflowState> {
  const user = await getSessionUser();
  if (!user) return { error: "Not authorised." };

  const instanceId = String(fd.get("instanceId") ?? "");
  const stepKey = String(fd.get("stepKey") ?? "");
  const decision = String(fd.get("decision") ?? "");
  const comment = String(fd.get("comment") ?? "").trim() || null;

  if (!["approve", "reject", "complete"].includes(decision)) {
    return { error: "Choose what to do with this step." };
  }

  const result = await decideStep({
    instanceId,
    stepKey,
    decision: decision as "approve" | "reject" | "complete",
    actor: user.email,
    comment,
  });
  if (!result.ok) return { error: result.error };

  await recordAudit({
    user,
    action: `workflow.step_${decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "completed"}`,
    entity: "workflow_instance",
    entityId: instanceId,
    after: { stepKey, status: result.status },
    reason: comment,
  });

  revalidatePath("/console/workflows");
  revalidatePath(`/console/workflows/${instanceId}`);
  revalidatePath("/me");

  return {
    ok:
      result.status === "completed"
        ? "Done — that was the last step, and the workflow is complete."
        : result.status === "rejected"
          ? "Rejected. The workflow has stopped."
          : "Done. It has moved to the next step.",
  };
}

/**
 * Save a template from the builder. Validation runs before anything is
 * stored, and the version is bumped so running instances keep the steps
 * they started with.
 */
export async function saveTemplate(
  _prev: WorkflowState,
  fd: FormData,
): Promise<WorkflowState> {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") {
    return { error: "Only an administrator may change a workflow template." };
  }

  const templateId = String(fd.get("templateId") ?? "");
  const [row] = await db
    .select()
    .from(s.workflowTemplates)
    .where(eq(s.workflowTemplates.id, templateId))
    .limit(1);
  if (!row) return { error: "Template not found." };
  if (!canAccessCompany(user, row.companyId)) return { error: "Not authorised." };

  let steps: WorkflowStep[];
  try {
    steps = JSON.parse(String(fd.get("stepsJson") ?? "[]"));
  } catch {
    return { error: "The steps could not be read." };
  }

  const name = String(fd.get("name") ?? row.name).trim();
  const check = validateTemplate({
    code: row.code,
    name,
    trigger: row.trigger as never,
    steps,
  });
  if (!check.valid) return { error: check.errors.join(" ") };

  await db
    .update(s.workflowTemplates)
    .set({
      name,
      stepsJson: JSON.stringify(steps),
      version: row.version + 1,
      updatedBy: user.email,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(s.workflowTemplates.id, templateId));

  await recordAudit({
    user,
    action: "workflow_template.updated",
    entity: "workflow_template",
    entityId: templateId,
    before: { version: row.version, steps: JSON.parse(row.stepsJson).length },
    after: { version: row.version + 1, steps: steps.length },
  });

  revalidatePath("/console/workflows");
  return {
    ok: `Saved as version ${row.version + 1}. Workflows already running keep the version they started with.${
      check.warnings.length ? ` Note: ${check.warnings.join(" ")}` : ""
    }`,
  };
}
