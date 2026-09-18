import Link from "next/link";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { formatINR } from "@/lib/payroll/money";
import { getSessionUser } from "@/lib/auth/session";
import { AddStatutoryParamForm } from "./forms";
import { PageHeader, Card, Badge, Table, THead, TH, TBody, TR, TD } from "@/components/console/ui";
import { formatDate } from "@/lib/format/date";

export const metadata = { title: "Statutory configuration" };

export default async function ComplianceConfigPage() {
  const user = (await getSessionUser())!;
  const isAdmin = user.role === "admin";

  const [juris, slabs, lwf, params] = await Promise.all([
    db.select().from(s.jurisdictions).orderBy(asc(s.jurisdictions.name)),
    db.select().from(s.ptSlabs),
    db.select().from(s.lwfRates),
    db.select().from(s.statutoryParams).orderBy(asc(s.statutoryParams.key)),
  ]);

  const slabCount: Record<string, number> = {};
  for (const x of slabs) slabCount[x.stateCode] = (slabCount[x.stateCode] ?? 0) + 1;
  const lwfByState = Object.fromEntries(lwf.map((l) => [l.stateCode, l]));

  const unverified = slabs.filter((x) => !x.verified).length + lwf.filter((x) => !x.verified).length;
  /* A row verified on somebody's say-so with no notification named is
     still a gap, just a smaller one than an unverified row. */
  const attestedWithoutReference =
    slabs.filter((x) => x.verified && x.source?.startsWith("Attested by")).length +
    lwf.filter((x) => x.verified && x.source?.startsWith("Attested by")).length;
  const contested = juris.filter((j) => j.verificationNote);
  const missingSlabs = juris.filter((j) => j.ptApplicable && !slabCount[j.stateCode]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Statutory configuration"
        title="Rules as data, with their provenance"
        description="Every row below is effective-dated. A payroll run records which versions it used, so recomputing a historic period reproduces what was actually paid."
      />

      {/*
        Two different states of the world, and the banner said the first
        one either way: it announced figures were unverified while
        counting zero of them. A warning that stays up after the thing it
        warns about is fixed teaches people to ignore warnings.
      */}
      {unverified > 0 ? (
        <div className="border-2 border-rust bg-rust-soft px-5 py-4">
          <p className="label text-rust mb-1.5">Not fit for real payroll yet</p>
          <p className="text-sm text-ink-2 max-w-[70ch]">
            <strong className="text-ink tnum">{unverified}</strong> of the
            seeded PT slabs and LWF rates are marked <code>verified: false</code>.
            They are indicative development figures, not a compliance source,
            and every one must be checked against the state Act or latest
            notification before a real run.
            {contested.length > 0 && (
              <>
                {" "}
                <strong className="text-ink">{contested.length}</strong>{" "}
                jurisdictions additionally have contested <em>applicability</em>.
              </>
            )}
          </p>
        </div>
      ) : (
        <div className="border-2 border-teal bg-teal-soft px-5 py-4">
          <p className="label text-teal mb-1.5">Checked and attested</p>
          <p className="text-sm text-ink-2 max-w-[70ch]">
            Every PT slab and LWF rate has been marked verified against a named
            source. The audit log records who attested to each row and when, and
            a reseed will not overwrite them.
            {attestedWithoutReference > 0 && (
              <>
                {" "}
                <strong className="text-ink tnum">
                  {attestedWithoutReference}
                </strong>{" "}
                of them name no notification — they were attested on review
                alone, and the reference is still worth adding.
              </>
            )}
            {contested.length > 0 && (
              <>
                {" "}
                <strong className="text-ink">{contested.length}</strong>{" "}
                jurisdictions have contested <em>applicability</em>, which is a
                separate question from whether the rate is right.
              </>
            )}
          </p>
        </div>
      )}


      {contested.length > 0 && (
        <Card padded={false}>
          <div className="px-4 py-2.5 border-b border-line bg-surface-2">
            <span className="label text-ink-2">Contested applicability</span>
          </div>
          <ul className="divide-y divide-line-2">
            {contested.map((j) => (
              <li key={j.stateCode} className="px-4 py-3">
                <p className="font-medium">
                  {j.name}{" "}
                  <span className="font-mono text-xs text-ink-3">
                    {j.stateCode}
                  </span>
                </p>
                <p className="text-sm text-brass mt-0.5">{j.verificationNote}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {missingSlabs.length > 0 && (
        <div className="border border-brass/40 bg-brass-soft px-4 py-3 text-sm">
          <span className="label text-brass">Gap</span>{" "}
          <span className="text-ink-2">
            {missingSlabs.map((j) => j.name).join(", ")} levy PT but have no slab
            configured — a run for these states raises a validation finding.
          </span>
        </div>
      )}

      <Card padded={false}>
        <div className="px-4 py-2.5 border-b border-line bg-surface-2">
          <span className="label text-ink-2">Central parameters</span>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {params.map((p) => (
              <tr key={p.id} className="border-b border-line-2 last:border-0">
                <td className="px-4 py-2 font-mono text-xs text-indigo whitespace-nowrap">
                  {p.key}
                </td>
                <td className="px-4 py-2 font-mono tnum whitespace-nowrap">
                  {p.unit === "paise"
                    ? formatINR(p.value)
                    : p.unit === "bps"
                      ? `${(p.value / 100).toFixed(2)}%`
                      : p.value}
                </td>
                <td className="px-4 py-2 text-ink-2">{p.note}</td>
                <td className="px-4 py-2 font-mono text-xs text-ink-3 whitespace-nowrap">
                  from {formatDate(p.effectiveFrom)}
                </td>
                <td className="px-4 py-2 text-xs whitespace-nowrap">
                  {p.verified ? (
                    <span className="text-teal" title={p.source ?? undefined}>
                      verified
                    </span>
                  ) : (
                    <span className="text-ink-3">seeded, unverified</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {isAdmin && (
          <div className="p-4 border-t border-line-2 flex flex-col gap-2">
            <p className="text-sm text-ink-2 max-w-[80ch]">
              Change a figure by adding the version that replaces it. The row
              above is closed the day before the new one starts, so a period
              already run still reproduces what it was actually paid on.
            </p>
            <AddStatutoryParamForm paramKeys={[...new Set(params.map((p) => p.key))]} />
          </div>
        )}
      </Card>

      <Card padded={false} className="overflow-x-auto">
        <div className="px-4 py-2.5 border-b border-line bg-surface-2 flex items-center justify-between">
          <span className="label text-ink-2">Jurisdiction coverage</span>
          <span className="label text-ink-3 tnum">{juris.length} states &amp; UTs</span>
        </div>
        <Table>
          <THead>
            {["Jurisdiction", "Code", "PT", "Slabs", "LWF", "LWF rate", "Frequency", ""].map((h) => (
              <TH key={h}>{h}</TH>
            ))}
          </THead>
          <TBody>
            {juris.map((j) => {
              const l = lwfByState[j.stateCode];
              return (
                <TR key={j.stateCode}>
                  <TD>
                    {j.name}
                    {j.verificationNote && (
                      <span className="label text-brass ml-2">verify</span>
                    )}
                  </TD>
                  <TD className="font-mono text-xs text-ink-3">
                    {j.stateCode}
                  </TD>
                  <TD>
                    <Badge tone={j.ptApplicable ? "teal" : "neutral"}>
                      {j.ptApplicable ? "Levied" : "None"}
                    </Badge>
                  </TD>
                  <TD className="font-mono tnum text-xs text-ink-2">
                    {slabCount[j.stateCode] ?? "—"}
                  </TD>
                  <TD>
                    <Badge tone={j.lwfApplicable ? "teal" : "neutral"}>
                      {j.lwfApplicable ? "Levied" : "None"}
                    </Badge>
                  </TD>
                  <TD className="font-mono tnum text-xs text-ink-2">
                    {l ? `${formatINR(l.employeePaise)} / ${formatINR(l.employerPaise)}` : "—"}
                  </TD>
                  <TD className="text-xs text-ink-2">
                    {l ? l.frequency.replace("_", "-") : "—"}
                  </TD>
                  <TD>
                    <Link href={`/console/compliance/${j.stateCode}`} className="label text-brass hover:underline">
                      {isAdmin ? "Manage →" : "View →"}
                    </Link>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
