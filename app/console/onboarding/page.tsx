import { narrowToSelected } from "@/lib/company-cookie";
import { selectedCompanyId } from "@/lib/company-cookie-server";
import { today } from "@/lib/clock";
import Link from "next/link";
import { listJoiners } from "@/lib/onboarding/load";
import { db } from "@/db";
import * as s from "@/db/schema";
import { inArray } from "drizzle-orm";
import { BulkJoinerForm } from "./bulk-form";
import { listCompanies } from "@/lib/payroll/load";
import { daysBetween } from "@/lib/exit/notice";
import {
  getSessionUser,
  scopeCompanies,
  canMutate,
  canActOnPeople,
} from "@/lib/auth/session";
import {
  PageHeader,
  Card,
  Button,
  Input,
  Select,
  FilterBar,
  FilterField,
  Badge,
  StatCard,
  Table,
  THead,
  TH,
  TBody,
  TR,
  TD,
  type BadgeTone,
} from "@/components/console/ui";
import { formatDate } from "@/lib/format/date";

export const metadata = { title: "Onboarding" };

const STATUS_TONE: Record<string, BadgeTone> = {
  draft: "neutral",
  offer_sent: "brass",
  accepted: "indigo",
  onboarding: "indigo",
  joined: "teal",
  dropped: "rust",
};

export default async function OnboardingPage(props: PageProps<"/console/onboarding">) {
  const TODAY = today();
  const user = (await getSessionUser())!;
  const sp = await props.searchParams;
  const companies = narrowToSelected(scopeCompanies(user, await listCompanies()), await selectedCompanyId());
  const allJoiners = await listJoiners(companies.map((c) => c.id));

  const inFlight = allJoiners.filter((j) => j.joiner.status !== "joined" && j.joiner.status !== "dropped");
  const blocked = inFlight.filter((j) => !j.readiness.canConvert);
  const canAdd = canActOnPeople(user);
  const companyIds = companies.map((c) => c.id);

  /* The codes bulk onboarding checks against, in front of the person
     filling in the file — the same reasoning as the employee import. */
  const [bulkBranches, bulkDepartments, bulkGrades] = canAdd && companyIds.length
    ? await Promise.all([
        db.select({ code: s.branches.code }).from(s.branches).where(inArray(s.branches.companyId, companyIds)),
        db.select({ code: s.departments.code }).from(s.departments).where(inArray(s.departments.companyId, companyIds)),
        db.select({ name: s.grades.name }).from(s.grades).where(inArray(s.grades.companyId, companyIds)),
      ])
    : [[], [], []];
  const bulkBranchCodes = bulkBranches.map((b) => b.code).filter(Boolean) as string[];
  const bulkDepartmentCodes = bulkDepartments.map((d) => d.code).filter(Boolean) as string[];
  const bulkGradeNames = bulkGrades.map((g) => g.name);

  const q = (typeof sp.q === "string" ? sp.q : "").trim().toLowerCase();
  const statusFilter = typeof sp.status === "string" ? sp.status : "";
  const bgvFilter = typeof sp.bgv === "string" ? sp.bgv : "";
  const joiners = allJoiners.filter(({ joiner: j }) => {
    if (statusFilter && j.status !== statusFilter) return false;
    if (bgvFilter && j.bgvStatus !== bgvFilter) return false;
    if (q) {
      const hay = `${j.firstName} ${j.lastName} ${j.personalEmail} ${j.designation ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const hasFilters = q || statusFilter || bgvFilter;
  const exportQuery = new URLSearchParams();
  if (q) exportQuery.set("q", q);
  if (statusFilter) exportQuery.set("status", statusFilter);
  if (bgvFilter) exportQuery.set("bgv", bgvFilter);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Onboarding"
        title={`${inFlight.length} joiners in flight`}
        description="The joiner completes their own profile and documents before day one. A record cannot convert to an employee while PAN or bank details are missing — those two would break the first payroll."
        actions={
          canAdd && (
            <div className="flex items-center gap-2">
              <Button href="#bulk-onboarding" variant="ghost">
                Import in bulk
              </Button>
              <Button href="/console/onboarding/new" variant="primary">
                New joiner
              </Button>
            </div>
          )
        }
      />

      {canAdd && companyIds[0] && (
        <Card>
          <h2 id="bulk-onboarding" className="font-display text-lg font-semibold mb-1">
            Add joiners in bulk
          </h2>
          <p className="text-sm text-ink-2 mb-3 max-w-[70ch]">
            For a batch of offers landing at once. Each is still a
            complete onboarding record afterwards — documents, the
            offer and background verification happen per person, same
            as adding one by hand.
          </p>
          <BulkJoinerForm
            companyId={companyIds[0]}
            branchCodes={bulkBranchCodes}
            departmentCodes={bulkDepartmentCodes}
            gradeNames={bulkGradeNames}
          />
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total candidates" value={allJoiners.length} />
        <StatCard label="In flight" value={inFlight.length} hint="Not yet joined or dropped" />
        <StatCard
          label="Ready to join"
          value={inFlight.length - blocked.length}
          hint={inFlight.length > 0 ? `of ${inFlight.length} in flight` : undefined}
        />
        <StatCard
          label="Blocked"
          value={blocked.length}
          hint={blocked.length > 0 ? "Would break first payroll" : "Nothing blocked"}
        />
      </div>

      {blocked.length > 0 && (
        <div className="border border-rust/40 bg-rust-soft px-4 py-3 text-sm rounded-lg">
          <span className="label text-rust">Not ready to join</span>{" "}
          <span className="text-ink-2">
            {blocked.length} joiner(s) have blockers that would break their first
            payroll.
          </span>
        </div>
      )}

      <Card>
        <FilterBar
          action="/console/onboarding"
          mode="filter"
          clearHref={hasFilters ? "/console/onboarding" : null}
          trailing={
            <a
              href={`/console/onboarding/export?${exportQuery.toString()}`}
              className="label text-brass hover:underline whitespace-nowrap"
            >
              Download CSV →
            </a>
          }
        >
          <FilterField label="Search" className="flex-1 min-w-[12rem]">
            <Input name="q" defaultValue={q} placeholder="Name, email or role" className="w-full" />
          </FilterField>
          <FilterField label="Status" className="w-full sm:w-44">
            <Select name="status" defaultValue={statusFilter} className="w-full">
              <option value="">All</option>
              <option value="draft">Draft</option>
              <option value="offer_sent">Offer sent</option>
              <option value="accepted">Accepted</option>
              <option value="onboarding">Onboarding</option>
              <option value="joined">Joined</option>
              <option value="dropped">Dropped</option>
            </Select>
          </FilterField>
          <FilterField label="BGV" className="w-full sm:w-44">
            <Select name="bgv" defaultValue={bgvFilter} className="w-full">
              <option value="">All</option>
              <option value="not_started">Not started</option>
              <option value="initiated">Initiated</option>
              <option value="in_progress">In progress</option>
              <option value="clear">Clear</option>
              <option value="discrepancy">Discrepancy</option>
              <option value="failed">Failed</option>
            </Select>
          </FilterField>
        </FilterBar>
      </Card>

      {allJoiners.length === 0 ? (
        <p className="text-ink-2">No joiners yet.</p>
      ) : joiners.length === 0 ? (
        <p className="text-ink-2">No joiners match these filters.</p>
      ) : (
        <>
          <Table className="min-w-[64rem]">
            <THead>
              {["Candidate", "Role", "Branch", "Joining", "In", "Offer", "BGV", "Ready", "Status", ""].map((h) => (
                <TH key={h}>{h}</TH>
              ))}
            </THead>
            <TBody>
              {joiners.map(({ joiner: j, branch, readiness }) => {
                const daysToJoin = daysBetween(TODAY, j.proposedDoj);
                return (
                  <TR key={j.id}>
                    <TD className="max-w-[14rem]">
                      <Link href={`/console/onboarding/${j.id}`} className="font-medium hover:text-indigo hover:underline truncate block">
                        {j.firstName} {j.lastName}
                      </Link>
                      <span className="block text-xs text-ink-3 truncate" title={j.personalEmail}>{j.personalEmail}</span>
                    </TD>
                    <TD className="text-ink-2 max-w-[10rem] truncate" title={j.designation ?? undefined}>{j.designation ?? "—"}</TD>
                    <TD className="text-ink-2 whitespace-nowrap">
                      {branch?.name ?? "—"}
                      {branch && <span className="font-mono text-xs text-ink-3 ml-1.5">{branch.stateCode}</span>}
                    </TD>
                    <TD className="font-mono text-xs tnum whitespace-nowrap">{formatDate(j.proposedDoj)}</TD>
                    <TD className="whitespace-nowrap">
                      {j.status === "joined" ? (
                        <span className="label text-teal">joined</span>
                      ) : (
                        <span className={`label tnum ${daysToJoin < 0 ? "text-rust" : daysToJoin <= 7 ? "text-brass" : "text-ink-3"}`}>
                          {daysToJoin < 0 ? `${Math.abs(daysToJoin)}d late` : `${daysToJoin}d`}
                        </span>
                      )}
                    </TD>
                    <TD>
                      <Badge tone={j.offerStatus === "accepted" ? "teal" : "neutral"}>
                        {j.offerStatus}
                      </Badge>
                    </TD>
                    <TD>
                      <Badge tone={
                        j.bgvStatus === "clear" ? "teal"
                          : j.bgvStatus === "discrepancy" || j.bgvStatus === "failed" ? "rust"
                          : "neutral"
                      }>
                        {j.bgvStatus.replace(/_/g, " ")}
                      </Badge>
                    </TD>
                    <TD className="w-28">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-14 bg-surface-2 overflow-hidden">
                          <div
                            className={readiness.canConvert ? "h-full bg-teal" : "h-full bg-brass"}
                            style={{ width: `${readiness.percent}%` }}
                          />
                        </div>
                        <span className="font-mono text-xs tnum">{readiness.percent}%</span>
                      </div>
                    </TD>
                    <TD>
                      <Badge tone={STATUS_TONE[j.status] ?? "neutral"}>
                        {j.status.replace(/_/g, " ")}
                      </Badge>
                    </TD>
                    <TD className="text-right">
                      <Link href={`/console/onboarding/${j.id}`} className="label text-brass hover:underline whitespace-nowrap">
                        Open →
                      </Link>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </>
      )}
    </div>
  );
}
