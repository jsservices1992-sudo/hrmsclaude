import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSessionUser, canAccessCompany } from "@/lib/auth/session";
import {
  CompanyForm,
  BranchForm,
  RegistrationForm,
  CompanyLogoForm,
} from "../../forms";
import { Badge, Card, Tabs, TabLink, Table, THead, TH, TBody, TR, TD, Alert } from "@/components/console/ui";
import { SetupWizard } from "@/components/console/setup-wizard";

export const metadata = { title: "Company settings" };

const KIND_LABEL: Record<string, string> = {
  pt: "Professional tax",
  lwf: "Labour welfare fund",
  shops_est: "Shops & establishment",
};

export default async function CompanySettingsPage(
  props: PageProps<"/console/settings/companies/[companyId]">,
) {
  const user = (await getSessionUser())!;
  const { companyId } = await props.params;
  const sp = await props.searchParams;
  const tab = typeof sp.tab === "string" ? sp.tab : "profile";
  const editBranch = typeof sp.branch === "string" ? sp.branch : null;
  const setupStep = typeof sp.setup === "string" ? sp.setup : undefined;
  /* Every link that stays on this screen has to carry the guided setup
     with it. Drop it once and the wizard vanishes mid-step, which reads
     as the guided setup having quietly given up. */
  const keepSetup = setupStep ? `&setup=${setupStep}` : "";

  if (!canAccessCompany(user, companyId)) redirect("/console/settings");

  const [company] = await db
    .select()
    .from(s.companies)
    .where(eq(s.companies.id, companyId))
    .limit(1);
  if (!company) notFound();

  const isAdmin = user.role === "admin";

  const branches = await db
    .select()
    .from(s.branches)
    .where(eq(s.branches.companyId, companyId))
    .orderBy(asc(s.branches.name));

  const registrations = await db
    .select()
    .from(s.companyRegistrations)
    .where(eq(s.companyRegistrations.companyId, companyId));

  const jurisdictions = await db
    .select()
    .from(s.jurisdictions)
    .orderBy(asc(s.jurisdictions.name));

  /* Which states notify more than one minimum wage, so a branch in one
     can be asked which zone it sits in. */
  const zoneRows = await db
    .selectDistinct({ stateCode: s.minimumWages.stateCode, zone: s.minimumWages.zone })
    .from(s.minimumWages);
  const zonesByState: Record<string, string[]> = {};
  for (const r of zoneRows) {
    if (r.zone === null) continue;
    (zonesByState[r.stateCode] ??= []).push(r.zone);
  }
  for (const list of Object.values(zonesByState)) list.sort();

  const runs = await db
    .select({ n: sql<number>`count(*)` })
    .from(s.payrollRuns)
    .where(eq(s.payrollRuns.companyId, companyId));
  const hasRuns = (runs[0]?.n ?? 0) > 0;

  const headcount = await db
    .select({ branchId: s.employees.branchId, n: sql<number>`count(*)` })
    .from(s.employees)
    .where(eq(s.employees.companyId, companyId))
    .groupBy(s.employees.branchId);
  const headByBranch = Object.fromEntries(headcount.map((h) => [h.branchId, h.n]));

  // States the company actually operates in — registrations are only
  // meaningful where a branch exists.
  const activeStates = Array.from(new Set(branches.map((b) => b.stateCode)));
  const jurisByCode = Object.fromEntries(jurisdictions.map((j) => [j.stateCode, j]));
  const regFor = (state: string, kind: string) =>
    registrations.find((r) => r.stateCode === state && r.kind === kind);

  const missingRegs = activeStates.flatMap((st) => {
    const j = jurisByCode[st];
    const out: string[] = [];
    if (j?.ptApplicable && !regFor(st, "pt")) out.push(`${st} PT`);
    if (j?.lwfApplicable && !regFor(st, "lwf")) out.push(`${st} LWF`);
    return out;
  });

  const TABS = [
    { id: "profile", label: "Profile & conventions" },
    { id: "branches", label: `Branches (${branches.length})` },
    { id: "registrations", label: `Registrations (${registrations.length})` },
  ];

  return (
    <div className="flex flex-col gap-6">
      <SetupWizard companyId={companyId} stepId={setupStep} />

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-surface p-5">
        <div className="flex min-w-0 items-center gap-4">
          <span aria-hidden className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-indigo text-lg font-bold text-on-indigo">
            {company.name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-ink">{company.name}</h1>
              {company.isDefault && <Badge tone="teal">Default</Badge>}
            </div>
            <p className="mt-0.5 text-sm text-ink-2">
              {company.legalName}
              {company.cin && <> · CIN {company.cin}</>}
            </p>
          </div>
        </div>
        <Link
          href={`/console/settings/payroll?company=${companyId}`}
          className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-ink hover:bg-surface-2"
        >
          Payroll rules
        </Link>
      </section>

      {missingRegs.length > 0 && (
        <Alert tone="danger" title={`Missing registrations: ${missingRegs.join(", ")}`}>
          You employ people in states that levy these, but no registration number is on file — the
          returns cannot be filed until one is added under Registrations.
        </Alert>
      )}

      <Tabs>
        {TABS.map((t) => (
          <TabLink
            key={t.id}
            href={`/console/settings/companies/${companyId}?tab=${t.id}${keepSetup}`}
            active={tab === t.id}
          >
            {t.label}
          </TabLink>
        ))}
      </Tabs>

      {tab === "profile" &&
        (isAdmin ? (
          <>
            {hasRuns && (
              <div className="border border-amber/25 bg-amber-soft px-4 py-3 text-sm text-ink-2 rounded-lg">
                <span className="text-xs font-semibold text-amber">Saved runs exist</span> —
                changing a payroll convention will require a reason, because it
                changes what every future part-month is worth.
              </div>
            )}
            <Card padded={false}>
              <div className="px-5 py-3.5 border-b border-line-2">
                <span className="text-[15px] font-semibold text-ink">Logo</span>
              </div>
              <div className="p-4">
                <CompanyLogoForm companyId={companyId} logoUrl={company.logoUrl} />
              </div>
            </Card>

            <CompanyForm
              mode="edit"
              hasRuns={hasRuns}
              values={{
                id: company.id,
                name: company.name,
                legalName: company.legalName,
                cin: company.cin,
                pan: company.pan,
                tan: company.tan,
                pfCode: company.pfCode,
                esicCode: company.esicCode,
                declaredHeadcount: company.declaredHeadcount,
                logoUrl: company.logoUrl,
                otRatePaisePerHour: company.otRatePaisePerHour,
                registeredAddress: company.registeredAddress,
                registeredCity: company.registeredCity,
                registeredStateCode: company.registeredStateCode,
                registeredPincode: company.registeredPincode,
                roundingMode: company.roundingMode,
                attendanceMode: company.attendanceMode,
                sandwichRule: company.sandwichRule,
                epfOnActualBasic: company.epfOnActualBasic,
              }}
            />
          </>
        ) : (
          <Card padded={false}>
            {[
              { k: "Legal name", v: company.legalName },
              { k: "CIN", v: company.cin },
              { k: "PAN", v: company.pan },
              { k: "TAN", v: company.tan },
              { k: "PF code", v: company.pfCode },
              { k: "ESIC code", v: company.esicCode },
              { k: "Proration basis", v: company.prorationBasis.replace("_", " ") },
              { k: "Rounding", v: company.roundingMode },
            ].map((r) => (
              <div key={r.k} className="px-4 py-2.5 border-b border-line-2 grid grid-cols-[12rem_1fr] gap-4">
                <span className="text-xs font-medium text-ink-2">{r.k}</span>
                <span className="text-sm font-mono">{r.v ?? "—"}</span>
              </div>
            ))}
          </Card>
        ))}

      {tab === "branches" && (
        <div className="flex flex-col gap-5">
          <Table>
            <THead>
              {["Branch", "Code", "State", "City", "Cost centre", "Headcount", "ESIC area", "Overrides", ""].map((h) => (
                <TH key={h}>{h}</TH>
              ))}
            </THead>
            <TBody>
              {branches.map((b) => {
                const j = jurisByCode[b.stateCode];
                const overrides = [
                  b.ptRegNo && "PT",
                  b.lwfRegNo && "LWF",
                  b.pfCodeOverride && "PF",
                  b.esicCodeOverride && "ESIC",
                  b.lwfApplicableOverride !== null && "LWF applicability",
                ].filter(Boolean);
                return (
                  <TR key={b.id}>
                    <TD className="font-medium">{b.name}</TD>
                    <TD className="font-mono text-xs text-ink-3">{b.code ?? "—"}</TD>
                    <TD>
                      <span className="font-mono text-xs">{b.stateCode}</span>
                      <span className="block text-xs text-ink-3 whitespace-normal">
                        PT {j?.ptApplicable ? "yes" : "no"} · LWF{" "}
                        {b.lwfApplicableOverride !== null
                          ? `${b.lwfApplicableOverride ? "yes" : "no"} (override)`
                          : j?.lwfApplicable
                            ? "yes"
                            : "no"}
                      </span>
                    </TD>
                    <TD className="text-ink-2">{b.city ?? "—"}</TD>
                    <TD className="font-mono text-xs text-ink-2">{b.costCentre ?? "—"}</TD>
                    <TD className="font-mono tnum">{headByBranch[b.id] ?? 0}</TD>
                    <TD>
                      <Badge tone={b.esicImplementedArea ? "teal" : "neutral"}>
                        {b.esicImplementedArea ? "Yes" : "No"}
                      </Badge>
                    </TD>
                    <TD className="text-xs text-ink-2 whitespace-normal">
                      {overrides.length > 0 ? overrides.join(", ") : <span className="text-ink-3">Inherits</span>}
                    </TD>
                    <TD className="text-right">
                      {isAdmin && (
                        <Link
                          href={`/console/settings/companies/${companyId}?tab=branches&branch=${b.id}${keepSetup}`}
                          className="text-sm font-semibold text-indigo hover:text-indigo-2"
                        >
                          Edit
                        </Link>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>

          {isAdmin && (
            <Card padded={false}>
              <div className="px-5 py-3.5 border-b border-line-2 flex items-center justify-between">
                <span className="text-[15px] font-semibold text-ink">
                  {editBranch ? "Edit branch" : "Add a branch"}
                </span>
                {editBranch && (
                  <Link
                    href={`/console/settings/companies/${companyId}?tab=branches${keepSetup}`}
                    className="text-sm font-semibold text-indigo hover:text-indigo-2"
                  >
                    Cancel
                  </Link>
                )}
              </div>
              <div className="p-4">
                <BranchForm
                  key={editBranch ?? "new"}
                  companyId={companyId}
                  zonesByState={zonesByState}
                  states={jurisdictions.map((j) => ({
                    id: j.stateCode,
                    label: `${j.name} (${j.stateCode})`,
                  }))}
                  values={
                    editBranch
                      ? (branches.find((b) => b.id === editBranch) ?? {})
                      : { esicImplementedArea: true }
                  }
                />
              </div>
            </Card>
          )}
        </div>
      )}

      {tab === "registrations" && (
        <div className="flex flex-col gap-5">
          <p className="text-sm text-ink-2 max-w-[70ch]">
            Registrations are held per state, because that is how they are
            issued. Only states where this company has a branch are shown — the
            state table decides which levies apply.
          </p>

          {activeStates.map((st) => {
            const j = jurisByCode[st];
            return (
              <Card key={st} padded={false}>
                <div className="px-5 py-3.5 border-b border-line-2 flex items-center justify-between">
                  <span className="font-display text-base font-semibold">
                    {j?.name ?? st}{" "}
                    <span className="font-mono text-xs text-ink-3">{st}</span>
                  </span>
                  <span className="text-xs font-medium text-ink-2">
                    PT {j?.ptApplicable ? "levied" : "none"} · LWF{" "}
                    {j?.lwfApplicable ? "levied" : "none"}
                  </span>
                </div>
                <div className="divide-y divide-line-2">
                  {(["pt", "lwf", "shops_est"] as const).map((kind) => {
                    const applicable =
                      kind === "pt"
                        ? j?.ptApplicable
                        : kind === "lwf"
                          ? j?.lwfApplicable
                          : true;
                    const reg = regFor(st, kind);
                    if (!applicable && !reg) {
                      return (
                        <div key={kind} className="px-4 py-2.5 flex items-center gap-3">
                          <span className="text-xs font-medium text-ink-2 w-44">{KIND_LABEL[kind]}</span>
                          <span className="text-xs text-ink-3">
                            Not levied in {st} — no registration required
                          </span>
                        </div>
                      );
                    }
                    return (
                      <div key={kind} className="px-4 py-3 flex flex-wrap items-center gap-3">
                        <span className="text-xs font-medium text-ink-2 w-44 shrink-0">{KIND_LABEL[kind]}</span>
                        {isAdmin ? (
                          <RegistrationForm
                            companyId={companyId}
                            stateCode={st}
                            kind={kind}
                            current={reg?.registrationNumber}
                            secondary={reg?.secondaryNumber}
                          />
                        ) : (
                          <span className="font-mono text-sm">
                            {reg?.registrationNumber ?? <span className="text-rust">Not registered</span>}
                            {reg?.secondaryNumber && ` · ${reg.secondaryNumber}`}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
