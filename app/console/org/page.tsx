import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { loadOrg } from "@/lib/hris/org-load";
import { loadHiring } from "@/lib/hris/hiring-load";
import type { OrgNode } from "@/lib/hris/org";
import { listCompanies } from "@/lib/payroll/load";
import { getSessionUser, scopeCompanies, canMutate,
  canActOnPeople,
} from "@/lib/auth/session";
import {
  PageHeader,
  Card,
  FilterBar,
  FilterField,
  Badge,
  Tabs,
  TabLink,
  Table,
  THead,
  TH,
  TBody,
  TR,
  TD,
  EmptyState,
  MetricStrip,
} from "@/components/console/ui";
import {
  ReassignTeamForm,
  ReplacementForm,
  HeadcountForm,
  NodeEditButton,
  type PersonOption,
} from "./forms";
import { formatDate } from "@/lib/format/date";

export const metadata = { title: "Org chart" };

/** Today, for deciding whether a departure has already happened. */
const TODAY = new Date().toISOString().slice(0, 10);

/**
 * Neutral wording for a departure. "On notice" reads as a resignation,
 * which is wrong — and callous — for an exit type such as death in
 * service, so the label says only whether the person has gone yet.
 */
function departureLabel(p: { status: string; lastWorkingDay: string | null }): string {
  const gone = p.status === "exited" || (p.lastWorkingDay !== null && p.lastWorkingDay <= TODAY);
  if (gone) return p.lastWorkingDay ? `left · ${formatDate(p.lastWorkingDay)}` : "left";
  return p.lastWorkingDay ? `leaving · ${formatDate(p.lastWorkingDay)}` : "leaving";
}

type Ctx = {
  canAct: boolean;
  departments: PersonOption[];
  people: PersonOption[];
  q: string;
};

/** Highlights the matched part of a name when the tree is filtered. */
function matches(node: OrgNode, q: string): boolean {
  if (!q) return true;
  return `${node.name} ${node.empCode} ${node.designation ?? ""} ${node.department ?? ""}`
    .toLowerCase()
    .includes(q);
}

/** A node is kept when it matches, or when anything beneath it does. */
function subtreeMatches(node: OrgNode, q: string): boolean {
  return matches(node, q) || node.children.some((c) => subtreeMatches(c, q));
}

function Node({ node, ctx }: { node: OrgNode; ctx: Ctx }) {
  const leaving = node.status !== "active";
  const dimmed = ctx.q && !matches(node, ctx.q);
  const visibleChildren = node.children.filter((c) => subtreeMatches(c, ctx.q));

  return (
    <li className="relative">
      {/* Elbow connector into the parent's rail */}
      <div className="group flex flex-wrap items-center gap-x-2.5 gap-y-1 py-1.5 pl-4 relative before:absolute before:left-0 before:top-1/2 before:w-3 before:border-t before:border-line-2">
        <Link
          href={`/console/employees/${node.id}`}
          className={`text-sm font-medium hover:text-indigo hover:underline ${dimmed ? "text-ink-3" : ""}`}
        >
          {node.name}
        </Link>
        <span className="font-mono text-xs text-ink-3">{node.empCode}</span>
        {node.designation && <span className="text-xs text-ink-2">{node.designation}</span>}
        {node.department && <span className="label text-ink-3">{node.department}</span>}

        {node.directCount > 0 && (
          <Badge tone="neutral">
            {node.directCount} direct
            {node.totalCount !== node.directCount && ` · ${node.totalCount} total`}
          </Badge>
        )}
        {leaving && (
          <Badge tone={node.status === "exited" ? "rust" : "brass"}>
            {departureLabel(node)}
          </Badge>
        )}
        {leaving && node.replacementName && (
          <Badge tone="teal">→ {node.replacementName}</Badge>
        )}
        {leaving && node.directCount > 0 && !node.replacementName && (
          <Badge tone="rust">team needs a manager</Badge>
        )}

        {ctx.canAct && (
          <NodeEditButton
            name={node.name}
            empCode={node.empCode}
            employeeId={node.id}
            designation={node.designation}
            departmentId={node.departmentId}
            managerId={node.managerId}
            departments={ctx.departments}
            managers={ctx.people}
          />
        )}
      </div>

      {visibleChildren.length > 0 && (
        <ul className="ml-4 border-l border-line-2">
          {visibleChildren.map((c) => (
            <Node key={c.id} node={c} ctx={ctx} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Open positions by department, and the plan they are counted against. */
function HiringView({
  hiring,
  canAct,
}: {
  hiring: Awaited<ReturnType<typeof loadHiring>>;
  canAct: boolean;
}) {
  return (
    <div className="flex flex-col gap-5">
      <MetricStrip
        items={[
          { label: "Approved", value: (hiring.totalApproved), hint: "Budgeted headcount" },
          { label: "Committed", value: (hiring.totalProjected), hint: "After leavers and joiners" },
          { label: "Open to hire", value: (hiring.totalOpen) },
          { label: "Joining", value: (hiring.totalIncoming), hint: "Offers out or onboarding" },
          { label: "Leaving", value: (hiring.totalLeaving), hint: "Seats freeing up" },
        ]}
      />

      <Card padded={false}>
        <div className="px-5 py-3.5 border-b border-line-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[15px] font-semibold text-ink">Open positions by department</span>
          <span className="text-xs text-ink-3">
            Open = approved − (on roll − leaving + joining)
          </span>
        </div>
        <Table className="min-w-[52rem]">
          <THead>
            <TH>Department</TH>
            <TH className="text-right">Approved</TH>
            <TH className="text-right">On roll</TH>
            <TH className="text-right">Leaving</TH>
            <TH className="text-right">Joining</TH>
            <TH className="text-right">Committed</TH>
            <TH className="text-right">Open</TH>
            {canAct && <TH>Set plan</TH>}
          </THead>
          <TBody>
            {hiring.departments.map((d) => (
              <TR key={d.departmentId ?? "none"}>
                <TD>
                  <span className="font-mono text-xs text-amber mr-2">{d.code}</span>
                  {d.name}
                </TD>
                <TD className="text-right tnum font-mono">
                  {d.approved ?? <span className="text-ink-3">not set</span>}
                </TD>
                <TD className="text-right tnum font-mono">{d.filled}</TD>
                <TD className="text-right tnum font-mono text-ink-2">
                  {d.leaving > 0 ? `−${d.leaving}` : "—"}
                </TD>
                <TD className="text-right tnum font-mono text-ink-2">
                  {d.incoming > 0 ? `+${d.incoming}` : "—"}
                </TD>
                <TD className="text-right tnum font-mono">{d.projected}</TD>
                <TD className="text-right">
                  {d.approved === null ? (
                    <span className="text-ink-3">—</span>
                  ) : d.overBudget > 0 ? (
                    <Badge tone="rust">{d.overBudget} over</Badge>
                  ) : d.openPositions > 0 ? (
                    <Badge tone="teal">{d.openPositions} open</Badge>
                  ) : (
                    <Badge tone="neutral">full</Badge>
                  )}
                </TD>
                {canAct && (
                  <TD>
                    {d.departmentId ? (
                      <HeadcountForm
                        key={`${d.departmentId}-${d.approved ?? "none"}`}
                        departmentId={d.departmentId}
                        approved={d.approved}
                      />
                    ) : (
                      <span className="text-xs text-ink-3">Assign a department first</span>
                    )}
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
        <p className="px-4 py-2.5 text-xs text-ink-3 border-t border-line-2 max-w-[76ch]">
          A leaver&apos;s seat counts as open from the day their exit is
          recorded, and a joiner&apos;s is taken from the day they accept — so
          the same seat is never offered twice. Leave the plan blank where
          nobody has set one; a plan of zero means no more hiring here.
        </p>
      </Card>
    </div>
  );
}

export default async function OrgPage(props: PageProps<"/console/org">) {
  const user = (await getSessionUser())!;
  const sp = await props.searchParams;

  const companies = scopeCompanies(user, await listCompanies());
  const requested = typeof sp.company === "string" ? sp.company : null;
  const companyId =
    requested && companies.some((c) => c.id === requested) ? requested : companies[0]?.id;

  if (!companyId) return <p className="text-ink-2">No company available.</p>;

  const view =
    sp.view === "report" ? "report" : sp.view === "hiring" ? "hiring" : "tree";
  const q = (typeof sp.q === "string" ? sp.q : "").trim().toLowerCase();

  const [org, hiring] = await Promise.all([loadOrg(companyId), loadHiring(companyId)]);
  const departmentRows = await db
    .select()
    .from(s.departments)
    .where(eq(s.departments.companyId, companyId))
    .orderBy(asc(s.departments.code));

  const canAct = canActOnPeople(user);

  const ctx: Ctx = {
    canAct,
    q,
    departments: departmentRows.map((d) => ({ id: d.id, label: `${d.code} — ${d.name}` })),
    people: org.flat
      .filter((p) => p.status === "active")
      .map((p) => ({ id: p.id, label: `${p.name} (${p.empCode})` }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };

  const visibleRoots = org.roots.filter((r) => subtreeMatches(r, q));
  const query = `company=${companyId}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Organisation"
        title="Structure & reporting"
        description={`${org.headcount} active · ${org.roots.length} at the top · ${departmentRows.length} departments · ${org.maxDepth + 1} levels deep`}
      />

      <MetricStrip
        items={[
          { label: "Active headcount", value: (org.headcount) },
          { label: "Managers", value: (org.spans.length), hint: (org.spans.length > 0 ? `largest team ${org.spans[0].total}` : undefined) },
          { label: "Teams needing a manager", value: (org.orphans.filter((o) => !o.replacementName).length), hint: (org.orphans.length > 0 ? `${org.orphans.length} leaver(s) with reports` : "None") },
          { label: "Open to hire", value: (hiring.totalOpen), hint: (hiring.unplanned > 0
              ? `${hiring.unplanned} department(s) have no plan set`
              : `across ${hiring.planned} planned department(s)`) },
        ]}
      />

      {/* Leavers whose team has nowhere to go — the thing that silently
          breaks an org chart the day somebody's notice runs out. */}
      {org.orphans.length > 0 && (
        <Card padded={false}>
          <div className="px-5 py-3.5 border-b border-line-2">
            <span className="text-[15px] font-semibold text-ink">Teams losing their manager</span>
          </div>
          <ul className="divide-y divide-line-2">
            {org.orphans.map((o) => (
              <li key={o.manager.id} className="px-4 py-3 flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/console/employees/${o.manager.id}`}
                    className="font-medium hover:text-indigo hover:underline"
                  >
                    {o.manager.name}
                  </Link>
                  <span className="font-mono text-xs text-ink-3">{o.manager.empCode}</span>
                  <Badge tone={o.manager.status === "exited" ? "rust" : "brass"}>
                    {departureLabel(o.manager)}
                  </Badge>
                  <Badge tone="neutral">{o.reportCount} report(s)</Badge>
                  {o.replacementName ? (
                    <Badge tone="teal">replacement: {o.replacementName}</Badge>
                  ) : (
                    <Badge tone="rust">no replacement named</Badge>
                  )}
                </div>
                {canAct && (
                  <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
                    {/* Keyed on the stored value so the select re-mounts
                        after a save — otherwise its defaultValue keeps
                        showing the old choice next to the new badge. */}
                    <ReplacementForm
                      key={o.manager.replacementId ?? "none"}
                      employeeId={o.manager.id}
                      replacementId={o.manager.replacementId}
                      people={ctx.people}
                    />
                    <ReassignTeamForm
                      fromId={o.manager.id}
                      reportCount={o.reportCount}
                      managers={ctx.people}
                      suggestedId={o.manager.replacementId}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Tabs>
        <TabLink href={`/console/org?${query}`} active={view === "tree"}>
          Reporting tree
        </TabLink>
        <TabLink href={`/console/org?${query}&view=report`} active={view === "report"}>
          Report view
        </TabLink>
        <TabLink href={`/console/org?${query}&view=hiring`} active={view === "hiring"}>
          Open to hire{hiring.totalOpen > 0 ? ` (${hiring.totalOpen})` : ""}
        </TabLink>
      </Tabs>

      {view === "hiring" ? (
        <HiringView hiring={hiring} canAct={canAct} />
      ) : view === "tree" ? (
        <Card padded={false}>
          <div className="px-5 py-3.5 border-b border-line-2 flex flex-wrap items-center justify-between gap-3">
            <span className="text-[15px] font-semibold text-ink">Reporting tree</span>
            <FilterBar
              action="/console/org"
              mode="filter"
              hidden={{ company: companyId }}
              clearHref={q ? `/console/org?${query}` : null}
            >
              <FilterField label="Search">
                <input
                  name="q"
                  defaultValue={q}
                  placeholder="Find a person, role or team"
                  className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm w-64 max-w-full"
                />
              </FilterField>
            </FilterBar>
          </div>
          <div className="p-4 overflow-x-auto">
            {visibleRoots.length === 0 ? (
              <EmptyState title="Nobody matches that" description="Try a different name, code or team." />
            ) : (
              <ul className="min-w-[34rem]">
                {visibleRoots.map((r) => (
                  <Node key={r.id} node={r} ctx={ctx} />
                ))}
              </ul>
            )}
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          <Card padded={false}>
            <div className="px-5 py-3.5 border-b border-line-2">
              <span className="text-[15px] font-semibold text-ink">Span of control — who has whom</span>
            </div>
            {org.spans.length === 0 ? (
              <p className="px-4 py-4 text-sm text-ink-3">Nobody has reports yet.</p>
            ) : (
              <Table>
                <THead>
                  <TH>Manager</TH>
                  <TH>Role</TH>
                  <TH>Department</TH>
                  <TH className="text-right">Direct</TH>
                  <TH className="text-right">Total below</TH>
                  <TH>Status</TH>
                </THead>
                <TBody>
                  {org.spans.map(({ person, direct, total }) => (
                    <TR key={person.id}>
                      <TD className="max-w-[14rem]">
                        <Link
                          href={`/console/employees/${person.id}`}
                          className="font-medium hover:text-indigo hover:underline truncate block"
                        >
                          {person.name}
                        </Link>
                        <span className="block text-xs text-ink-3 font-mono">{person.empCode}</span>
                      </TD>
                      <TD className="text-ink-2 max-w-[12rem] truncate" title={person.designation ?? undefined}>
                        {person.designation ?? "—"}
                      </TD>
                      <TD className="text-ink-2">{person.department ?? "—"}</TD>
                      <TD className="text-right tnum font-mono">{direct}</TD>
                      <TD className="text-right tnum font-mono">{total}</TD>
                      <TD>
                        {person.status === "active" ? (
                          <span className="text-ink-3">—</span>
                        ) : (
                          <Badge tone={person.status === "exited" ? "rust" : "brass"}>
                            {departureLabel(person)}
                          </Badge>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>

          <div className="grid lg:grid-cols-2 gap-5 items-start">
            <Card padded={false}>
              <div className="px-5 py-3.5 border-b border-line-2">
                <span className="text-[15px] font-semibold text-ink">Headcount by department</span>
              </div>
              <Table>
                <THead>
                  <TH>Department</TH>
                  <TH className="text-right">People</TH>
                  <TH className="text-right">Share</TH>
                </THead>
                <TBody>
                  {org.byDepartment.map((d) => (
                    <TR key={d.id ?? "none"}>
                      <TD>{d.name}</TD>
                      <TD className="text-right tnum font-mono">{d.count}</TD>
                      <TD className="text-right tnum font-mono text-ink-2">
                        {org.headcount > 0 ? `${Math.round((d.count / org.headcount) * 100)}%` : "—"}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>

            <Card padded={false}>
              <div className="px-5 py-3.5 border-b border-line-2">
                <span className="text-[15px] font-semibold text-ink">Leavers &amp; replacements</span>
              </div>
              {org.leavers.length === 0 ? (
                <p className="px-4 py-4 text-sm text-ink-3">Nobody is leaving.</p>
              ) : (
                <Table>
                  <THead>
                    <TH>Person</TH>
                    <TH>Last day</TH>
                    <TH className="text-right">Reports</TH>
                    <TH>Replacement</TH>
                  </THead>
                  <TBody>
                    {org.leavers.map((l) => {
                      const node = org.flat.find((n) => n.id === l.id);
                      return (
                        <TR key={l.id}>
                          <TD className="max-w-[12rem]">
                            <Link
                              href={`/console/employees/${l.id}`}
                              className="font-medium hover:text-indigo hover:underline truncate block"
                            >
                              {l.name}
                            </Link>
                            <span className="block text-xs text-ink-3 font-mono">{l.empCode}</span>
                          </TD>
                          <TD className="font-mono text-xs tnum">{l.lastWorkingDay ?? "—"}</TD>
                          <TD className="text-right tnum font-mono">{node?.directCount ?? 0}</TD>
                          <TD>
                            {l.replacementName ? (
                              <Badge tone="teal">{l.replacementName}</Badge>
                            ) : (
                              <span className="text-ink-3">Not decided</span>
                            )}
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              )}
            </Card>
          </div>

          {org.unassigned.length > 0 && (
            <Card padded={false}>
              <div className="px-5 py-3.5 border-b border-line-2">
                <span className="text-[15px] font-semibold text-ink">No manager set</span>
              </div>
              <ul className="divide-y divide-line-2">
                {org.unassigned.map((p) => (
                  <li key={p.id} className="px-4 py-2.5 flex flex-wrap items-center gap-2">
                    <Link
                      href={`/console/employees/${p.id}`}
                      className="font-medium hover:text-indigo hover:underline"
                    >
                      {p.name}
                    </Link>
                    <span className="font-mono text-xs text-ink-3">{p.empCode}</span>
                    {p.designation && <span className="text-xs text-ink-2">{p.designation}</span>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
