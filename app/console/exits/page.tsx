import { today as clockToday } from "@/lib/clock";
import Link from "next/link";
import { redirect } from "next/navigation";
import { listExitCases } from "@/lib/exit/load";
import { listCompanies } from "@/lib/payroll/load";
import { daysBetween } from "@/lib/exit/notice";
import {
  getSessionUser,
  canAccessConsole,
  scopeCompanies,
} from "@/lib/auth/session";
import { loadFnfQueue } from "@/lib/exit/fnf-load";
import { db } from "@/db";
import * as s2 from "@/db/schema";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { canMutate } from "@/lib/auth/session";
import { StartExitForm } from "./start-form";
import {
  PageHeader,
  Card,
  Select,
  FilterBar,
  FilterField,
  Badge,
  Table,
  THead,
  TH,
  TBody,
  TR,
  TD,
  type BadgeTone,
} from "@/components/console/ui";

export const metadata = { title: "Exits" };

const TYPE_LABEL: Record<string, string> = {
  resignation: "Resignation",
  termination: "Termination",
  termination_cause: "Termination for cause",
  probation_termination: "Probation termination",
  abscondment: "Abscondment",
  retirement: "Retirement",
  contract_end: "Contract end",
  death_in_service: "Death in service",
};

const STATUS_TONE: Record<string, BadgeTone> = {
  submitted: "neutral",
  manager_approved: "brass",
  accepted: "brass",
  clearance: "indigo",
  settled: "teal",
  withdrawn: "neutral",
};

export default async function ExitsPage(props: PageProps<"/console/exits">) {
  const user = (await getSessionUser())!;
  if (!canAccessConsole(user)) redirect("/console?denied=exits");
  const sp = await props.searchParams;

  const companies = scopeCompanies(user, await listCompanies());
  const allCases = await listExitCases(companies.map((c) => c.id));

  const typeFilter = typeof sp.type === "string" ? sp.type : "";
  const statusFilter = typeof sp.status === "string" ? sp.status : "";
  const cases = allCases.filter(({ exit }) => {
    if (typeFilter && exit.exitType !== typeFilter) return false;
    if (statusFilter && exit.status !== statusFilter) return false;
    return true;
  });
  const hasFilters = typeFilter || statusFilter;

  // The settlement work queue — FR-PAY-21 asks for a queue, not a report,
  // so the most overdue case is the one at the top.
  const queue = await loadFnfQueue(companies.map((c) => c.id));
  const needingAttention = queue.filter(
    (q) => q.ageing.status === "overdue" || q.ageing.status === "gratuity_overdue",
  );

  const today = clockToday();

  /* Anyone who could be exited: on the books, and not already partway
     through one. An exit list with no way to start an exit was the whole
     module's missing front door. */
  const companyIds = companies.map((c) => c.id);
  const openExitEmployeeIds = new Set(
    allCases.filter(({ exit }) => exit.status !== "withdrawn").map(({ exit }) => exit.employeeId),
  );
  const exitable = companyIds.length
    ? (
        await db
          .select({
            id: s2.employees.id,
            empCode: s2.employees.empCode,
            firstName: s2.employees.firstName,
            lastName: s2.employees.lastName,
          })
          .from(s2.employees)
          .where(
            and(
              inArray(s2.employees.companyId, companyIds),
              ne(s2.employees.status, "exited"),
            ),
          )
          .orderBy(asc(s2.employees.empCode))
      )
        .filter((e) => !openExitEmployeeIds.has(e.id))
        .map((e) => ({ id: e.id, empCode: e.empCode, name: `${e.firstName} ${e.lastName}` }))
    : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Exit & settlement"
        title={
          <>
            {allCases.length} exit cases
            {hasFilters && <span className="text-ink-3 font-normal text-xl"> · {cases.length} shown</span>}
          </>
        }
        description="Settlement cannot be released until clearance closes. Ageing is measured from the last working day, which is the number an HR head is actually judged on."
      />

      {canMutate(user) && companies.length > 0 && (
        <Card padded={false}>
          <div className="px-4 py-2.5 border-b border-line bg-surface-2">
            <span className="label text-ink-2">Record an exit</span>
          </div>
          <div className="p-4">
            <StartExitForm
              companyId={companies[0].id}
              employees={exitable}
              defaultEmployeeId={typeof sp.employee === "string" ? sp.employee : undefined}
            />
          </div>
        </Card>
      )}

      {needingAttention.length > 0 && (
        <div className="border-2 border-rust bg-rust-soft px-5 py-4">
          <p className="label text-rust mb-1.5">Settlements past their deadline</p>
          <ul className="text-sm text-ink-2 max-w-[76ch] flex flex-col gap-1">
            {needingAttention.map((q) => (
              <li key={q.exitCase.id}>
                · <span className="font-mono">{q.empCode}</span> {q.employeeName}
                {" — "}
                {q.ageing.note}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The queue, most overdue first */}
      <Card padded={false}>
        <div className="px-4 py-2.5 border-b border-line bg-surface-2">
          <span className="label text-ink-2">Settlement queue</span>
        </div>
        <Table>
          <THead>
            {["Employee", "Last working day", "Days elapsed", "Clearance", "Settlement", ""].map((h) => (
              <TH key={h}>{h}</TH>
            ))}
          </THead>
          <TBody>
            {queue.map((q) => (
              <TR key={q.exitCase.id}>
                <TD>
                  {q.employeeName}
                  <span className="block font-mono text-xs text-ink-3">{q.empCode}</span>
                </TD>
                <TD className="font-mono text-xs tnum">
                  {q.exitCase.lastWorkingDay}
                </TD>
                <TD>
                  <Badge
                    tone={
                      q.ageing.status === "not_due"
                        ? "neutral"
                        : q.ageing.status === "due_soon"
                          ? "brass"
                          : "rust"
                    }
                    className="whitespace-nowrap"
                  >
                    {q.ageing.daysSinceLastWorkingDay} days
                  </Badge>
                </TD>
                <TD>
                  {q.pendingClearance === 0 ? (
                    <span className="label text-teal">closed</span>
                  ) : (
                    <span className="label text-rust">{q.pendingClearance} open</span>
                  )}
                </TD>
                <TD>
                  <span className="label text-ink-2">
                    {q.stored ? q.stored.status.replace(/_/g, " ") : "not started"}
                  </span>
                </TD>
                <TD className="text-right">
                  <Link
                    href={`/console/exits/${q.exitCase.id}/settlement`}
                    className="label text-brass hover:underline whitespace-nowrap"
                  >
                    Settlement →
                  </Link>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>

      <FilterBar
        action="/console/exits"
        mode="filter"
        clearHref={hasFilters ? "/console/exits" : null}
      >
        <FilterField label="Type">
          <Select name="type" defaultValue={typeFilter}>
            <option value="">All</option>
            {Object.entries(TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Status">
          <Select name="status" defaultValue={statusFilter}>
            <option value="">All</option>
            {Object.keys(STATUS_TONE).map((st) => (
              <option key={st} value={st}>{st.replace(/_/g, " ")}</option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>

      {cases.length === 0 ? (
        <p className="text-ink-2">
          {allCases.length === 0 ? "No exit cases yet." : "No exit cases match these filters."}
        </p>
      ) : (
        <Table>
          <THead>
            {["Employee", "Type", "Resigned", "Last working day", "Ageing", "Status", ""].map((h) => (
              <TH key={h}>{h}</TH>
            ))}
          </THead>
          <TBody>
            {cases.map(({ exit, employee, company }) => {
              const ageing = daysBetween(exit.lastWorkingDay, today);
              return (
                <TR key={exit.id}>
                  <TD>
                    <span className="font-medium">
                      {employee.firstName} {employee.lastName}
                    </span>
                    <span className="block text-xs text-ink-3 font-mono">
                      {employee.empCode} · {company.name}
                    </span>
                  </TD>
                  <TD className="text-ink-2">
                    {TYPE_LABEL[exit.exitType]}
                  </TD>
                  <TD className="font-mono text-xs tnum text-ink-2">
                    {exit.resignationDate}
                  </TD>
                  <TD className="font-mono text-xs tnum">
                    {exit.lastWorkingDay}
                  </TD>
                  <TD>
                    {ageing > 0 ? (
                      <Badge tone={ageing > 30 ? "rust" : "neutral"} className="tnum">
                        {ageing}d
                      </Badge>
                    ) : (
                      <span className="label text-ink-3">—</span>
                    )}
                  </TD>
                  <TD>
                    <Badge tone={STATUS_TONE[exit.status] ?? "neutral"}>
                      {exit.status.replace("_", " ")}
                    </Badge>
                  </TD>
                  <TD className="text-right">
                    <Link
                      href={`/console/exits/${exit.id}`}
                      className="label text-brass hover:underline whitespace-nowrap"
                    >
                      Settlement →
                    </Link>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </div>
  );
}
