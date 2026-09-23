import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser, canAccessConsole, canAccessCompany } from "@/lib/auth/session";
import { loadInstance } from "@/lib/workflow/service";
import { StepActionForm } from "../forms";
import { Card, Badge, type BadgeTone } from "@/components/console/ui";
import { formatDate, formatDateTime } from "@/lib/format/date";

export const metadata = { title: "Workflow" };

const STEP_TONE: Record<string, BadgeTone> = {
  waiting: "neutral",
  open: "brass",
  approved: "teal",
  completed: "teal",
  rejected: "rust",
  skipped: "neutral",
};

export default async function WorkflowInstancePage(
  props: PageProps<"/console/workflows/[instanceId]">,
) {
  const user = (await getSessionUser())!;
  if (!canAccessConsole(user)) redirect("/me");

  const { instanceId } = await props.params;
  const view = await loadInstance(instanceId);
  if (!view) notFound();
  if (!canAccessCompany(user, view.instance.companyId)) redirect("/console?denied=workflow");

  // Steps grouped as they run: a group is a set of steps open together.
  const groups = [...new Set(view.steps.map((s) => s.group))].sort((a, b) => a - b);

  return (
    <div className="flex flex-col gap-6 max-w-[64rem]">
      <div>
        <Link href="/console/workflows" className="inline-flex w-fit items-center gap-1 text-sm font-medium text-ink-2 hover:text-ink">
          ← Approval workflows
        </Link>
        <p className="label text-ink-3 mt-3">{view.templateName}</p>
        <h1 className="text-2xl font-bold tracking-tight text-ink mt-1">
          {view.subject.firstName} {view.subject.lastName}
        </h1>
        <p className="text-sm text-ink-2 mt-1">
          <span className="font-mono">{view.subject.empCode}</span> · started{" "}
          {formatDate(view.instance.startedAt)} · {view.instance.status} · template version{" "}
          {view.instance.templateVersion}
          {view.instance.sourceEntity === "exit_case" && (
            <>
              {" · "}
              <Link
                href={`/console/exits/${view.instance.sourceId}/settlement`}
                className="text-indigo hover:underline"
              >
                settlement
              </Link>
            </>
          )}
        </p>
      </div>

      {view.overdue.length > 0 && (
        <div className="border border-rust/25 bg-rust-soft px-5 py-4 rounded-xl">
          <p className="text-sm font-semibold text-rust mb-1">Past its deadline</p>
          <ul className="text-sm text-ink-2 flex flex-col gap-1">
            {view.overdue.map((o) => (
              <li key={o.key}>
                · {o.label} — open {o.daysOpen} days against an SLA of {o.slaDays}, with{" "}
                {o.assignees.join(", ") || "nobody"}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ol className="flex flex-col gap-3">
        {groups.map((g) => (
          <li key={g}>
          <Card padded={false}>
            <div className="px-5 py-3.5 border-b border-line-2">
              <span className="label text-ink-3">
                Stage {g}
                {view.steps.filter((s) => s.group === g).length > 1 && " · runs in parallel"}
              </span>
            </div>
            <ul className="divide-y divide-line-2">
              {view.steps
                .filter((s) => s.group === g)
                .map((def) => {
                  const st = view.state.steps.find((x) => x.key === def.key)!;
                  const mine = st.status === "open" && st.assignees.includes(user.email);
                  return (
                    <li key={def.key} className="px-4 py-3 flex flex-col gap-2">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">{def.label}</p>
                          <p className="text-xs text-ink-3 mt-0.5">
                            {def.type} · SLA {def.slaDays} day(s) ·{" "}
                            {st.assignees.length > 0
                              ? st.assignees.join(", ")
                              : st.status === "waiting"
                                ? "owner decided when it opens"
                                : "nobody"}
                          </p>
                          {st.decidedBy && (
                            <p className="text-xs text-ink-2 mt-0.5">
                              {st.status} by {st.decidedBy} · {formatDateTime(st.decidedAt)}
                              {st.comment && ` · "${st.comment}"`}
                            </p>
                          )}
                        </div>
                        <Badge tone={STEP_TONE[st.status]}>{st.status}</Badge>
                      </div>
                      {mine && (
                        <StepActionForm instanceId={instanceId} stepKey={def.key} type={def.type} />
                      )}
                    </li>
                  );
                })}
            </ul>
          </Card>
          </li>
        ))}
      </ol>

      <Card padded={false}>
        <div className="px-5 py-3.5 border-b border-line-2">
          <span className="text-[15px] font-semibold text-ink">Execution log</span>
        </div>
        <ul className="divide-y divide-line-2">
          {view.events.map((e) => (
            <li key={e.id} className="px-4 py-2 flex flex-wrap items-baseline gap-3 text-sm">
              <span className="font-mono text-xs text-ink-3 whitespace-nowrap">
                {formatDateTime(e.at)}
              </span>
              <span className="font-mono text-xs text-ink-3">{e.actor}</span>
              <span className="text-ink-2">{e.message}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
