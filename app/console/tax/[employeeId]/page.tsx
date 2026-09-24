import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { loadWorksheet, compareForEmployee } from "@/lib/tax/load";
import { fyLabel, CURRENT_FY } from "@/lib/tax/fy";
import { formatINR } from "@/lib/payroll/money";
import {
  getSessionUser,
  canSeeCompensation,
  canAccessCompany,
  canMutate,
  canActOnPeople,
} from "@/lib/auth/session";
import { recordAccess } from "@/lib/audit/log";
import { ProofDecisionForm, RegimeForm, CloseWindowForm, PerquisiteForm, SpecialRateForm } from "../forms";
import { Card, Badge, StatCard, Table, THead, TH, TBody, TR, TD } from "@/components/console/ui";

export const metadata = { title: "Tax worksheet" };

function Row({
  label,
  value,
  note,
  strong,
  negative,
}: {
  label: string;
  value: string;
  note?: string;
  strong?: boolean;
  negative?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 px-4 py-2.5 ${
        strong ? "bg-surface-2 border-y border-line" : "border-b border-line-2"
      }`}
    >
      <div className="min-w-0">
        <span className={`text-sm ${strong ? "font-medium" : "text-ink-2"}`}>
          {label}
        </span>
        {note && <span className="block text-xs text-ink-3 mt-0.5">{note}</span>}
      </div>
      <span
        className={`font-mono tnum whitespace-nowrap ${
          strong ? "text-base font-semibold" : "text-sm"
        } ${negative ? "text-teal" : ""}`}
      >
        {negative ? `− ${value}` : value}
      </span>
    </div>
  );
}

export default async function TaxWorksheetPage(
  props: PageProps<"/console/tax/[employeeId]">,
) {
  const user = (await getSessionUser())!;
  if (!canSeeCompensation(user)) redirect("/console?denied=tax");

  const { employeeId } = await props.params;
  const w = await loadWorksheet(employeeId);
  if (!w) notFound();
  if (!canAccessCompany(user, w.employee.companyId)) redirect("/console?denied=tax");

  await recordAccess({
    user,
    dataClass: "tax",
    surface: "console/tax worksheet",
    companyId: w.employee.companyId,
    subjectEmployeeId: employeeId,
    rowCount: 1,
  });

  const comparison = await compareForEmployee(employeeId);
  const canAct = canActOnPeople(user);
  const emp = w.employee;
  const a = w.annual;

  const [company] = await db
    .select({ advancedTaxEnabled: s.companies.advancedTaxEnabled })
    .from(s.companies)
    .where(eq(s.companies.id, emp.companyId))
    .limit(1);
  const advancedTaxEnabled = company?.advancedTaxEnabled ?? false;

  return (
    <div className="flex flex-col gap-6 max-w-[72rem]">
      <div>
        <Link href="/console/tax" className="inline-flex w-fit items-center gap-1 text-sm font-medium text-ink-2 hover:text-ink">
          ← Income tax
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4 mt-2">
          <div>
            <p className="text-xs font-medium text-ink-2">FY {fyLabel(CURRENT_FY)}</p>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-ink mt-1">
              {emp.firstName} {emp.lastName}
            </h1>
            <p className="text-sm text-ink-2 mt-1">
              <span className="font-mono">{emp.empCode}</span> · {emp.designation}{" "}
              · PAN{" "}
              <span className={w.pan.valid ? "font-mono" : "font-mono text-rust"}>
                {emp.pan ?? "not on record"}
              </span>
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge tone={w.regime === "new" ? "brass" : "neutral"}>{w.regime} regime</Badge>
            {canAct && (
              <RegimeForm
                employeeId={emp.id}
                regime={w.regime}
                locked={w.declaration?.regimeLocked ?? false}
              />
            )}
          </div>
        </div>
      </div>

      {w.warnings.length > 0 && (
        <div className="border border-amber/30 bg-amber-soft px-5 py-4 rounded-xl">
          <p className="text-sm font-semibold text-amber mb-1">Before you rely on this</p>
          <ul className="text-sm text-ink-2 max-w-[74ch] flex flex-col gap-1">
            {w.warnings.map((warn, i) => (
              <li key={i}>· {warn}</li>
            ))}
          </ul>
        </div>
      )}

      {/* headline */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { l: "Taxable income", v: <>{formatINR(a.taxableIncomePaise)}</> },
          { l: "Annual tax", v: <>{formatINR(a.tax.totalTaxPaise)}</> },
          { l: "Deducted so far", v: <>{formatINR(w.tdsToDatePaise)}</> },
          {
            l: `TDS a month (${w.projection.monthsRemaining} left)`,
            v: (
              <span className={w.projection.higherRateApplied ? "text-rust" : undefined}>
                {formatINR(w.projection.monthlyTdsPaise)}
              </span>
            ),
          },
        ].map((x) => (
          <StatCard key={x.l} label={x.l} value={x.v} />
        ))}
      </div>

      {/* regime comparison */}
      {comparison && (
        <Card padded={false}>
          <div className="px-5 py-3.5 border-b border-line-2">
            <span className="text-[15px] font-semibold text-ink">Regime comparison</span>
          </div>
          <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-line-2">
            {(["old", "new"] as const).map((r) => {
              const side = comparison[r];
              const better = comparison.betterRegime === r;
              return (
                <div key={r} className="px-4 py-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-ink-2">{r} regime</p>
                    {better && <Badge tone="teal">lower</Badge>}
                  </div>
                  <p className="font-display text-2xl font-semibold tnum mt-1.5">
                    {formatINR(side.annual.tax.totalTaxPaise)}
                  </p>
                  <p className="text-xs text-ink-3 mt-1">
                    on {formatINR(side.annual.taxableIncomePaise)} taxable ·
                    standard deduction {formatINR(side.annual.standardDeductionPaise)}
                    {" · "}
                    Chapter VI-A {formatINR(side.annual.chapterViAPaise)}
                  </p>
                </div>
              );
            })}
          </div>
          <p className="px-4 py-2.5 text-xs text-ink-3 border-t border-line-2">
            {comparison.savingPaise === 0
              ? "Both regimes produce the same tax on these figures."
              : `The ${comparison.betterRegime} regime is lower by ${formatINR(comparison.savingPaise)} on what has been declared so far. Deductions that are never substantiated will move this.`}
          </p>
        </Card>
      )}

      {/* computation */}
      <Card padded={false}>
        <div className="px-5 py-3.5 border-b border-line-2">
          <span className="text-[15px] font-semibold text-ink">Computation</span>
        </div>
        <Row label="Salary from this employer" value={formatINR(a.grossSalaryPaise)} />
        {a.previousEmployerSalaryPaise > 0 && (
          <Row
            label="Previous employer salary"
            value={formatINR(a.previousEmployerSalaryPaise)}
            note={w.declaration?.previousEmployerName ?? "Reported on Form 12B"}
          />
        )}
        {a.perquisitesPaise > 0 && (
          <Row label="Perquisites" value={formatINR(a.perquisitesPaise)} />
        )}
        {a.exemptAllowancesPaise > 0 && (
          <Row
            label="Exempt allowances"
            value={formatINR(a.exemptAllowancesPaise)}
            note="HRA and substantiated flexi claims"
            negative
          />
        )}
        <Row
          label="Standard deduction"
          value={formatINR(a.standardDeductionPaise)}
          negative
        />
        {a.professionalTaxPaise > 0 && (
          <Row
            label="Professional tax"
            value={formatINR(a.professionalTaxPaise)}
            note="Section 16(iii)"
            negative
          />
        )}
        {a.chapterViAPaise > 0 && (
          <Row
            label="Chapter VI-A deductions"
            value={formatINR(a.chapterViAPaise)}
            negative
          />
        )}
        <Row label="Taxable income" value={formatINR(a.taxableIncomePaise)} strong />

        {a.tax.bands
          .filter((b) => b.taxableInBandPaise > 0)
          .map((b) => (
            <Row
              key={b.fromPaise}
              label={`${(b.rateBps / 100).toFixed(0)}% on ${formatINR(b.taxableInBandPaise)}`}
              value={formatINR(b.taxPaise)}
              note={`${formatINR(b.fromPaise)} to ${b.toPaise === null ? "above" : formatINR(b.toPaise)}`}
            />
          ))}
        {a.tax.rebatePaise > 0 && (
          <Row
            label="Rebate under section 87A"
            value={formatINR(a.tax.rebatePaise)}
            negative
          />
        )}
        {a.tax.surchargePaise > 0 && (
          <Row label="Surcharge" value={formatINR(a.tax.surchargePaise)} />
        )}
        <Row
          label="Health & education cess at 4%"
          value={formatINR(a.tax.cessPaise)}
        />
        <Row label="Total tax" value={formatINR(a.tax.totalTaxPaise)} strong />
        {a.previousEmployerSalaryPaise > 0 && (
          <Row
            label="Less TDS by the previous employer"
            value={formatINR(w.declaration?.previousTdsPaise ?? 0)}
            negative
          />
        )}
        <Row
          label="Tax this employer must deduct for the year"
          value={formatINR(a.netTaxPayablePaise)}
          strong
        />
        <Row
          label="Deducted so far this year"
          value={formatINR(w.tdsToDatePaise)}
          negative
        />
        <Row
          label={`Remaining, over ${w.projection.monthsRemaining} month(s)`}
          value={formatINR(w.projection.remainingTaxPaise)}
          note={
            (w.declaration?.voluntaryMonthlyPaise ?? 0) > 0
              ? `Plus ${formatINR(w.declaration!.voluntaryMonthlyPaise)} a month the employee has asked to have deducted voluntarily`
              : undefined
          }
        />
        <Row
          label="TDS this month"
          value={formatINR(w.projection.monthlyTdsPaise)}
          strong
        />
      </Card>

      {/* HRA */}
      {w.hra && (
        <Card padded={false}>
          <div className="px-5 py-3.5 border-b border-line-2">
            <span className="text-[15px] font-semibold text-ink">House rent allowance</span>
          </div>
          {w.hra.workings.length === 0 ? (
            <p className="px-4 py-4 text-sm text-ink-2">{w.hra.reason}</p>
          ) : (
            <>
              {w.hra.workings.map((x) => (
                <Row
                  key={x.label}
                  label={x.label}
                  value={formatINR(x.amountPaise)}
                />
              ))}
              <Row
                label="Exempt — the least of the three"
                value={formatINR(w.hra.exemptPaise)}
                strong
              />
              <Row label="Taxable HRA" value={formatINR(w.hra.taxablePaise)} />
            </>
          )}
          <p className="px-4 py-2.5 text-xs text-ink-3 border-t border-line-2">
            Rent declared {formatINR(w.declaration?.annualRentPaise ?? 0)} a year
            at {w.declaration?.rentCity ?? emp.city ?? "an unstated city"} ·
            landlord PAN{" "}
            <span className="font-mono">
              {w.declaration?.landlordPan ?? "not supplied"}
            </span>
          </p>
        </Card>
      )}

      {/* deductions */}
      {w.deductions.lines.length > 0 && (
        <Card padded={false} className="overflow-x-auto">
          <div className="px-5 py-3.5 border-b border-line-2">
            <span className="text-[15px] font-semibold text-ink">Declared deductions</span>
          </div>
          <Table>
            <THead>
              {["Section", "Declared", "Allowed", "Note"].map((h) => (
                <TH key={h}>{h}</TH>
              ))}
            </THead>
            <TBody>
              {w.deductions.lines.map((l) => (
                <TR key={l.section}>
                  <TD className="whitespace-nowrap">{l.section}</TD>
                  <TD className="font-mono tnum text-ink-2">
                    {formatINR(l.claimedPaise)}
                  </TD>
                  <TD
                    className={`font-mono tnum ${
                      l.allowedPaise === 0 ? "text-rust" : "text-teal"
                    }`}
                  >
                    {formatINR(l.allowedPaise)}
                  </TD>
                  <TD className="text-xs text-ink-2">{l.note}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      {/* proofs */}
      {w.proofs.length > 0 && (
        <Card padded={false}>
          <div className="px-5 py-3.5 border-b border-line-2">
            <span className="text-[15px] font-semibold text-ink">Proof verification</span>
          </div>
          <ul className="divide-y divide-line-2">
            {w.proofs.map((p) => (
              <li
                key={p.id}
                className="px-4 py-3 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{p.section}</p>
                  <p className="text-xs text-ink-2 mt-0.5">
                    declared{" "}
                    <span className="font-mono tnum">
                      {formatINR(p.declaredPaise)}
                    </span>{" "}
                    · evidenced{" "}
                    <span
                      className={`font-mono tnum ${p.verifiedPaise === 0 ? "text-rust" : "text-teal"}`}
                    >
                      {formatINR(p.verifiedPaise)}
                    </span>
                    {p.documentRef && ` · ${p.documentRef}`}
                    {p.note && ` · ${p.note}`}
                  </p>
                </div>
                {p.status === "pending" && canAct ? (
                  <ProofDecisionForm
                    proofId={p.id}
                    declaredPaise={p.declaredPaise}
                  />
                ) : (
                  <span className="text-xs font-medium text-ink-2">{p.status}</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* the February forecast */}
      {w.ifNothingProved && w.ifNothingProved.additionalTaxPaise > 0 && (
        <div className="border border-rust/25 bg-rust-soft px-5 py-4 rounded-xl">
          <p className="text-sm font-semibold text-rust mb-1">
            If nothing further is substantiated
          </p>
          <p className="text-sm text-ink-2 max-w-[74ch]">
            {formatINR(w.ifNothingProved.droppedPaise)} of declared deductions
            are still unproved. When the window closes they drop out, adding{" "}
            {formatINR(w.ifNothingProved.additionalTaxPaise)} of tax — about{" "}
            {formatINR(w.ifNothingProved.monthlyImpactPaise)} a month across the{" "}
            {w.projection.monthsRemaining} month(s) that remain. Telling the
            employee now is the difference between a plan and a February shock.
          </p>
        </div>
      )}

      {/* perquisites */}
      {w.perquisites.lines.length > 0 && (
        <Card padded={false}>
          <div className="px-5 py-3.5 border-b border-line-2">
            <span className="text-[15px] font-semibold text-ink">Perquisites</span>
          </div>
          {w.perquisites.lines.map((p) => (
            <Row
              key={p.code}
              label={p.label}
              value={formatINR(p.valuePaise)}
              note={p.basis}
            />
          ))}
          <Row
            label="Total perquisite value"
            value={formatINR(w.perquisites.totalPaise)}
            strong
          />
        </Card>
      )}

      {canActOnPeople(user) && (
        <Card padded={false}>
          <div className="px-5 py-3.5 border-b border-line-2">
            <span className="text-[15px] font-semibold text-ink">Add a perquisite</span>
          </div>
          <PerquisiteForm employeeId={emp.id} />
        </Card>
      )}

      {/* special-rate income — capital gains, VDA, lottery, gaming */}
      {w.specialRate && (
        <Card padded={false}>
          <div className="px-5 py-3.5 border-b border-line-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[15px] font-semibold text-ink">Special-rate income</span>
            <span className="text-xs font-medium text-ink-2">not part of salary TDS above — computed and shown separately</span>
          </div>
          {w.specialRate.special.stcgSpecifiedTaxPaise > 0 && (
            <Row label="STCG — specified (20%)" value={formatINR(w.specialRate.special.stcgSpecifiedTaxPaise)} />
          )}
          {w.specialRate.special.ltcgSpecifiedTaxPaise > 0 && (
            <Row
              label="LTCG — specified (12.5%)"
              value={formatINR(w.specialRate.special.ltcgSpecifiedTaxPaise)}
              note={`On ${formatINR(w.specialRate.special.ltcgSpecifiedTaxableAboveThresholdPaise)} above the ₹1,25,000 threshold`}
            />
          )}
          {w.specialRate.special.ltcgGeneralTaxPaise > 0 && (
            <Row label="LTCG — general (12.5%)" value={formatINR(w.specialRate.special.ltcgGeneralTaxPaise)} />
          )}
          {w.specialRate.special.vdaTaxPaise > 0 && (
            <Row label="Virtual digital assets (30%)" value={formatINR(w.specialRate.special.vdaTaxPaise)} />
          )}
          {w.specialRate.special.lotteryTaxPaise > 0 && (
            <Row label="Lottery / games (30%)" value={formatINR(w.specialRate.special.lotteryTaxPaise)} />
          )}
          {w.specialRate.special.horseRaceTaxPaise > 0 && (
            <Row label="Horse race winnings (30%)" value={formatINR(w.specialRate.special.horseRaceTaxPaise)} />
          )}
          {w.specialRate.special.onlineGamingTaxPaise > 0 && (
            <Row label="Online gaming (30%)" value={formatINR(w.specialRate.special.onlineGamingTaxPaise)} />
          )}
          <Row
            label="Surcharge on special-rate tax"
            value={formatINR(w.specialRate.specialSurchargePaise)}
            note={`Capital gains capped at ${(w.specialRate.cappedSurchargeRateBps / 100).toFixed(0)}%; VDA/lottery/gaming at the full ${(w.specialRate.surchargeBandRateBps / 100).toFixed(0)}% band`}
          />
          <Row
            label="Total tax on special-rate income"
            value={formatINR(
              w.specialRate.special.totalTaxBeforeSurchargePaise +
                w.specialRate.specialSurchargePaise,
            )}
            strong
          />
          <p className="px-4 py-2.5 text-xs text-ink-3 border-t border-line-2 max-w-[74ch]">
            Never reduced by the ₹12L/₹60,000 rebate — that rebate applies only
            to salary taxed at the slab rate. Cess is included in the combined
            annual tax figure below the computation, not repeated here.
          </p>
        </Card>
      )}

      {advancedTaxEnabled && canActOnPeople(user) && (
        <Card padded={false}>
          <div className="px-5 py-3.5 border-b border-line-2">
            <span className="text-[15px] font-semibold text-ink">Special-rate income — capital gains, VDA, lottery, gaming</span>
          </div>
          <SpecialRateForm employeeId={emp.id} declaration={w.specialRateDeclaration} />
        </Card>
      )}
      {!advancedTaxEnabled && w.specialRateDeclaration && canActOnPeople(user) && (
        <p className="text-xs text-ink-3 px-1">
          Special-rate income was declared before this feature was turned off in Payroll Settings — the figures above still apply. Turn it back on there to change them.
        </p>
      )}

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-3 max-w-[60ch]">
          Computed on configuration set{" "}
          <span className="font-mono">{w.configVersion}</span>
          {!w.configVerified && ", whose core rates have not been checked"}.
          The set used is recorded against every deduction, so this worksheet
          stays reproducible after the rates change.
        </p>
        {canMutate(user) && w.declaration && w.declaration.status !== "locked" && (
          <CloseWindowForm employeeId={emp.id} />
        )}
      </Card>
    </div>
  );
}
