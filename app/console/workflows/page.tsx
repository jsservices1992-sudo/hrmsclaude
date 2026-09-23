import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { listCompanies } from "@/lib/payroll/load";
import {
  getSessionUser,
  canAccessConsole,
  canAccessCompany,
  canMutate,
  scopeCompanies,
  canActOnPeople,
} from "@/lib/auth/session";
import {
  ensureTemplates,
  loadInbox,
  loadInstances,
  parseTemplate,
} from "@/lib/workflow/service";
import { StartPendingForm, StepActionForm, TemplateBuilder, DepartmentOwnersPanel } from "./forms";
import { PageHeader, Card, Badge, type BadgeTone, Table, THead, TH, TBody, TR, TD } from "@/components/console/ui";

export const metadata = { title: "Workflows" };

const STATUS_TONE: Record<string, BadgeTone> = {
  running: "brass",
  completed: "teal",
  rejected: "rust",
  cancelled: "neutral",
};

export default async function WorkflowsPage(props: PageProps<"/console/workflows">) {
  const user = (await getSessionUser())!;
  if (!canAccessConsole(user)) redirect("/me");

  const sp = await props.searchParams;
  const companies = scopeCompanies(user, await listCompanies());
  const requested = typeof sp.company === "string" ? sp.company : null;
  const companyId =
    requested && canAccessCompany(user, requested) ? requested : companies[0]?.id;
  if (!companyId) redirect("/console");

  await ensureTemplates(companyId, user.email);

  const [templateRow] = await db
    .select()
    .from(s.workflowTemplates)
    .where(
      and(
        eq(s.workflowTemplates.companyId, companyId),
        eq(s.workflowTemplates.code, "EXIT_CLEARANCE"),
      ),
    )
    .limit(1);

  const inbox = await loadInbox(user.email);
  const instances = await loadInstances([companyId]);
  const deptOwners = await db
    .select({ id: s.workflowDepartmentOwners.id, department: s.workflowDepartmentOwners.department, ownerEmail: s.workflowDepartmentOwners.ownerEmail })
    .from(s.workflowDepartmentOwners)
    .where(eq(s.workflowDepartmentOwners.companyId, companyId));
  const running = instances.filter((i) => i.instance.status === "running");
  const overdue = running.filter((i) => i.overdue.length > 0);

  return (
    <div className="flex flex-col gap-6 max-w-[84rem]">
      <PageHeader
        eyebrow="Workflows"
        title="Workflows & approvals"
        description={
          <>
            {running.length} running · {overdue.length} with a step past its SLA ·{" "}
            {inbox.length} waiting on you
          </>
        }
      />

      {/* ---------- my tasks ---------- */}
      <Card padded={false}>
        <div className="px-5 py-3.5 border-b border-line-2 flex items-center justify-between">
          <span className="text-[15px] font-semibold text-ink">Waiting on you</span>
          <span className="label text-ink-3 tnum">{inbox.length}</span>
        </div>
        {inbox.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-3">Nothing is waiting on you.</p>
        ) : (
          <ul className="divide-y divide-line-2">
            {inbox.map((item) => (
              <li key={`${item.instanceId}-${item.stepKey}`} className="px-4 py-3 flex flex-col gap-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{item.stepLabel}</p>
                    <p className="text-xs text-ink-2 mt-0.5">
                      {item.templateName} ·{" "}
                      <Link
                        href={`/console/workflows/${item.instanceId}`}
                        className="text-indigo hover:underline"
                      >
                        {item.subjectName} {item.subjectCode}
                      </Link>
                    </p>
                  </div>
                  {item.daysOverdue > 0 && (
                    <Badge tone="rust">
                      {item.daysOverdue} day(s) over SLA
                    </Badge>
                  )}
                </div>
                <StepActionForm
                  instanceId={item.instanceId}
                  stepKey={item.stepKey}
                  type={item.stepType}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ---------- running instances ---------- */}
      <Card padded={false} className="overflow-x-auto">
        <div className="px-5 py-3.5 border-b border-line-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[15px] font-semibold text-ink">All workflows</span>
          {(canActOnPeople(user)) && (
            <StartPendingForm companyId={companyId} />
          )}
        </div>
        {instances.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-3">
            No workflows have been started. The exit &amp; clearance workflow
            starts when a resignation is accepted.
          </p>
        ) : (
          <Table>
            <THead>
              {["Subject", "Workflow", "Progress", "Open step", "Status", ""].map((h) => (
                <TH key={h}>{h}</TH>
              ))}
            </THead>
            <TBody>
              {instances.map((i) => {
                const done = i.state.steps.filter((s) =>
                  ["approved", "completed", "skipped", "rejected"].includes(s.status),
                ).length;
                const open = i.state.steps.filter((s) => s.status === "open");
                return (
                  <TR key={i.instance.id}>
                    <TD>
                      {i.subjectName}
                      <span className="block font-mono text-xs text-ink-3">{i.subjectCode}</span>
                    </TD>
                    <TD className="text-ink-2">{i.templateName}</TD>
                    <TD className="font-mono tnum text-xs text-ink-2">
                      {done} / {i.state.steps.length}
                    </TD>
                    <TD className="text-xs text-ink-2 max-w-[28ch] whitespace-normal">
                      {open.length === 0
                        ? "—"
                        : open
                            .map((o) => i.steps.find((d) => d.key === o.key)?.label)
                            .join("; ")}
                      {i.overdue.length > 0 && (
                        <span className="block text-rust">
                          {i.overdue[0].daysOverdue} day(s) over SLA
                        </span>
                      )}
                    </TD>
                    <TD>
                      <Badge tone={STATUS_TONE[i.instance.status]}>
                        {i.instance.status}
                      </Badge>
                    </TD>
                    <TD className="text-right">
                      <Link
                        href={`/console/workflows/${i.instance.id}`}
                        className="text-sm font-semibold text-indigo hover:text-indigo-2"
                      >
                        Open →
                      </Link>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>

      {/* ---------- the builder ---------- */}
      {templateRow && (
        <Card padded={false}>
          <div className="px-5 py-3.5 border-b border-line-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[15px] font-semibold text-ink">Template · {templateRow.name}</span>
            <span className="label text-ink-3">
              version {templateRow.version} · starts on resignation accepted
            </span>
          </div>
          <div className="px-4 py-4">
            <TemplateBuilder
              templateId={templateRow.id}
              name={templateRow.name}
              steps={parseTemplate(templateRow).steps}
              editable={user.role === "admin"}
            />
          </div>
          {user.role !== "admin" && (
            <p className="px-4 py-2.5 text-xs text-ink-3 border-t border-line-2">
              Only an administrator can change a template.
            </p>
          )}
        </Card>
      )}

      {/* ---------- department owners ---------- */}
      {user.role === "admin" && (
        <Card padded={false}>
          <div className="px-5 py-3.5 border-b border-line-2">
            <span className="text-[15px] font-semibold text-ink">Department owners</span>
            <p className="text-xs text-ink-3 mt-0.5">
              A step assigned to &quot;a department&quot; above routes to whoever is named here for
              that department. None named routes to an administrator instead.
            </p>
          </div>
          <div className="px-4 py-4">
            <DepartmentOwnersPanel companyId={companyId} owners={deptOwners} />
          </div>
        </Card>
      )}
    </div>
  );
}
