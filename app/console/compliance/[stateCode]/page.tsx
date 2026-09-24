import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { formatINR } from "@/lib/payroll/money";
import { getSessionUser } from "@/lib/auth/session";
import {
  JurisdictionForm,
  VerifyPtSlabForm,
  AddPtSlabForm,
  VerifyLwfRateForm,
  AddLwfRateForm,
} from "../forms";
import { Card, Badge, Table, THead, TH, TBody, TR, TD } from "@/components/console/ui";

export const metadata = { title: "Jurisdiction" };

export default async function JurisdictionDetailPage(
  props: PageProps<"/console/compliance/[stateCode]">,
) {
  const user = (await getSessionUser())!;
  const isAdmin = user.role === "admin";
  const { stateCode } = await props.params;

  const [jur] = await db.select().from(s.jurisdictions).where(eq(s.jurisdictions.stateCode, stateCode)).limit(1);
  if (!jur) notFound();

  const slabs = await db
    .select()
    .from(s.ptSlabs)
    .where(eq(s.ptSlabs.stateCode, stateCode))
    .orderBy(asc(s.ptSlabs.gender), asc(s.ptSlabs.effectiveFrom), asc(s.ptSlabs.minPaise));
  const lwf = await db
    .select()
    .from(s.lwfRates)
    .where(eq(s.lwfRates.stateCode, stateCode))
    .orderBy(asc(s.lwfRates.effectiveFrom));

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div>
        <Link href="/console/compliance" className="inline-flex w-fit items-center gap-1 text-sm font-medium text-ink-2 hover:text-ink">
          ← Statutory rules
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-ink mt-2">{jur.name}</h1>
        <p className="text-sm text-ink-2 mt-1">
          <span className="font-mono">{jur.stateCode}</span> · {jur.kind === "ut" ? "Union territory" : "State"}
        </p>
      </div>

      {!isAdmin && (
        <p className="text-sm text-amber border border-amber/25 bg-amber-soft px-4 py-3 rounded-lg">
          Only an administrator can change statutory rules. You can review what is configured.
        </p>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Badge tone={jur.ptApplicable ? "teal" : "neutral"}>
            PT {jur.ptApplicable ? "levied" : "none"}
          </Badge>
          <Badge tone={jur.lwfApplicable ? "teal" : "neutral"}>
            LWF {jur.lwfApplicable ? "levied" : "none"}
          </Badge>
          {jur.verificationNote && <span className="text-xs text-amber">{jur.verificationNote}</span>}
        </div>
        {isAdmin && (
          <JurisdictionForm
            stateCode={jur.stateCode}
            ptApplicable={jur.ptApplicable}
            lwfApplicable={jur.lwfApplicable}
            verificationNote={jur.verificationNote}
          />
        )}
      </Card>

      {jur.ptApplicable && (
        <Card padded={false}>
          <div className="px-5 py-3.5 border-b border-line-2">
            <span className="text-[15px] font-semibold text-ink">Professional tax slabs</span>
          </div>
          {slabs.length === 0 ? (
            <p className="px-4 py-4 text-sm text-ink-3">No slabs configured — a run for this state raises a validation finding.</p>
          ) : (
            <Table>
              <THead>
                <TH>Gender</TH>
                <TH>Band</TH>
                <TH>Amount</TH>
                <TH>Annual cap</TH>
                <TH>Effective</TH>
                <TH>Verified</TH>
                <TH>Source</TH>
                <TH>{""}</TH>
              </THead>
              <TBody>
                {slabs.map((sl) => (
                  <TR key={sl.id}>
                    <TD className="text-xs">{sl.gender}</TD>
                    <TD className="font-mono text-xs tnum">
                      {formatINR(sl.minPaise)}–{sl.maxPaise ? formatINR(sl.maxPaise) : "∞"}
                    </TD>
                    <TD className="font-mono text-xs tnum">{formatINR(sl.amountPaise)}</TD>
                    <TD className="font-mono text-xs tnum">{formatINR(sl.annualCapPaise)}</TD>
                    <TD className="font-mono text-xs">
                      {sl.effectiveFrom}
                      {sl.effectiveTo ? ` → ${sl.effectiveTo}` : ""}
                    </TD>
                    <TD className="text-xs">
                      {sl.verified ? <span className="text-teal">Yes</span> : <span className="text-rust">No</span>}
                    </TD>
                    <TD className="text-xs text-ink-2">{sl.source ?? "—"}</TD>
                    <TD>
                      {isAdmin && !sl.verified && <VerifyPtSlabForm id={sl.id} />}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          {isAdmin && (
            <div className="p-4">
              <AddPtSlabForm stateCode={jur.stateCode} />
            </div>
          )}
        </Card>
      )}

      {jur.lwfApplicable && (
        <Card padded={false}>
          <div className="px-5 py-3.5 border-b border-line-2">
            <span className="text-[15px] font-semibold text-ink">Labour welfare fund rates</span>
          </div>
          {lwf.length === 0 ? (
            <p className="px-4 py-4 text-sm text-ink-3">No rate configured — a run for this state raises a validation finding.</p>
          ) : (
            <Table>
              <THead>
                <TH>Employee</TH>
                <TH>Employer</TH>
                <TH>Frequency</TH>
                <TH>Months</TH>
                <TH>Effective</TH>
                <TH>Verified</TH>
                <TH>Source</TH>
                <TH>{""}</TH>
              </THead>
              <TBody>
                {lwf.map((l) => (
                  <TR key={l.id}>
                    <TD className="font-mono text-xs tnum">{formatINR(l.employeePaise)}</TD>
                    <TD className="font-mono text-xs tnum">{formatINR(l.employerPaise)}</TD>
                    <TD className="text-xs">{l.frequency.replace(/_/g, "-")}</TD>
                    <TD className="text-xs">{l.deductionMonths}</TD>
                    <TD className="font-mono text-xs">
                      {l.effectiveFrom}
                      {l.effectiveTo ? ` → ${l.effectiveTo}` : ""}
                    </TD>
                    <TD className="text-xs">
                      {l.verified ? <span className="text-teal">Yes</span> : <span className="text-rust">No</span>}
                    </TD>
                    <TD className="text-xs text-ink-2">{l.source ?? "—"}</TD>
                    <TD>{isAdmin && !l.verified && <VerifyLwfRateForm id={l.id} />}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          {isAdmin && (
            <div className="p-4">
              <AddLwfRateForm stateCode={jur.stateCode} />
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
