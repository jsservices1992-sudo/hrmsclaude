import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq, notInArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSessionUser, canAccessCompany } from "@/lib/auth/session";
import { findCandidateEmployees } from "@/lib/payroll/load";
import type { ResolvedStructureSource } from "@/lib/payroll/structures";
import {
  AddLineForm,
  RemoveLineForm,
  SetDefaultForm,
  StructurePresentationForm,
} from "../forms";
import { PayComponentForm } from "@/app/console/settings/master-data/forms";
import {
  PageHeader,
  Card,
  Badge,
  Table,
  THead,
  TH,
  TBody,
  TR,
  TD,
} from "@/components/console/ui";

export const metadata = { title: "Salary structure" };

const SOURCE_LABEL: Record<ResolvedStructureSource, string> = {
  employee_pin: "Pinned directly",
  department_override: "Via department",
  company_default: "Company default",
  fallback_flat_components: "—",
};

export default async function StructureDetailPage(
  props: PageProps<"/console/settings/payroll/structures/[structureId]">,
) {
  const user = (await getSessionUser())!;
  const { structureId } = await props.params;

  const [structure] = await db
    .select()
    .from(s.salaryStructures)
    .where(eq(s.salaryStructures.id, structureId))
    .limit(1);
  if (!structure) notFound();
  if (!canAccessCompany(user, structure.companyId)) redirect("/console/settings/payroll");

  const isAdmin = user.role === "admin";

  const lineRows = await db
    .select({
      id: s.salaryStructureLines.id,
      sequence: s.salaryStructureLines.sequence,
      calcMethodOverride: s.salaryStructureLines.calcMethodOverride,
      percentValueOverride: s.salaryStructureLines.percentValueOverride,
      fixedPaiseOverride: s.salaryStructureLines.fixedPaiseOverride,
      componentId: s.payComponents.id,
      componentCode: s.payComponents.code,
      componentLabel: s.payComponents.name,
      componentKind: s.payComponents.kind,
      componentCalcMethod: s.payComponents.calcMethod,
      componentPercentValue: s.payComponents.percentValue,
      componentPercentOfCode: s.payComponents.percentOfCode,
      componentFixedPaise: s.payComponents.fixedPaise,
    })
    .from(s.salaryStructureLines)
    .innerJoin(s.payComponents, eq(s.salaryStructureLines.componentId, s.payComponents.id))
    .where(eq(s.salaryStructureLines.structureId, structureId))
    .orderBy(asc(s.salaryStructureLines.sequence));

  const usedComponentIds = lineRows.map((l) => l.componentId);
  const availableComponents = await db
    .select({ id: s.payComponents.id, code: s.payComponents.code, name: s.payComponents.name })
    .from(s.payComponents)
    .where(
      usedComponentIds.length > 0
        ? and(eq(s.payComponents.companyId, structure.companyId), notInArray(s.payComponents.id, usedComponentIds))
        : eq(s.payComponents.companyId, structure.companyId),
    )
    .orderBy(asc(s.payComponents.sequence));

  const candidates = await findCandidateEmployees(structure.companyId, structureId);

  /* Every one of the company's components, not just the ones this
     structure does not use yet — creating a new one that is a percent
     of an existing line needs to see it too. */
  const allComponents = await db
    .select({ id: s.payComponents.id, code: s.payComponents.code, name: s.payComponents.name })
    .from(s.payComponents)
    .where(eq(s.payComponents.companyId, structure.companyId))
    .orderBy(asc(s.payComponents.sequence));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/console/settings/payroll?tab=structures"
          className="text-sm font-semibold text-indigo hover:text-indigo-2"
        >
          ← Salary structures
        </Link>
        <PageHeader
          title={
            <>
              {structure.name}{" "}
              {structure.isDefault && (
                <Badge tone="brass" className="align-middle ml-2">Default</Badge>
              )}
              {!structure.active && (
                <Badge tone="rust" className="align-middle ml-2">Inactive</Badge>
              )}
            </>
          }
          description={structure.description ?? undefined}
          actions={
            isAdmin && !structure.isDefault ? (
              <SetDefaultForm companyId={structure.companyId} structureId={structure.id} />
            ) : undefined
          }
        />
      </div>

      {isAdmin && (
        <Card padded={false}>
          <div className="px-5 py-3.5 border-b border-line-2">
            <span className="text-[15px] font-semibold text-ink">What the payslip shows</span>
          </div>
          <div className="p-4">
            <StructurePresentationForm
              structureId={structure.id}
              values={{
                payBasis: structure.payBasis,
                showCtcOnPayslip: structure.showCtcOnPayslip,
                showEmployerContribution: structure.showEmployerContribution,
                hideZeroComponents: structure.hideZeroComponents,
              }}
            />
          </div>
        </Card>
      )}

      <Card padded={false}>
        <div className="px-5 py-3.5 border-b border-line-2">
          <span className="text-[15px] font-semibold text-ink">Components</span>
        </div>
        <Table>
          <THead>
            {["Code", "Name", "Calc method", "Value", "Sequence", ""].map((h) => (
              <TH key={h}>{h}</TH>
            ))}
          </THead>
          <TBody>
            {lineRows.map((l) => {
              const method = l.calcMethodOverride ?? l.componentCalcMethod;
              const percentValue = l.percentValueOverride ?? l.componentPercentValue;
              const fixedPaise = l.fixedPaiseOverride ?? l.componentFixedPaise;
              return (
                <TR key={l.id}>
                  <TD className="font-mono text-xs text-ink-3">{l.componentCode}</TD>
                  <TD>{l.componentLabel}</TD>
                  <TD className="text-ink-2">
                    {l.calcMethodOverride ? (
                      <span className="text-brass">{l.calcMethodOverride.replace(/_/g, " ")}</span>
                    ) : (
                      <span className="text-ink-3">{l.componentCalcMethod.replace(/_/g, " ")} (inherited)</span>
                    )}
                  </TD>
                  <TD className="font-mono tnum text-ink-2">
                    {method.startsWith("percent")
                      ? `${percentValue}%${l.componentPercentOfCode ? ` of ${l.componentPercentOfCode}` : ""}`
                      : method === "fixed"
                        ? `₹${(fixedPaise / 100).toLocaleString("en-IN")}`
                        : "—"}
                  </TD>
                  <TD className="font-mono tnum text-ink-2">{l.sequence}</TD>
                  <TD className="text-right">{isAdmin && <RemoveLineForm lineId={l.id} />}</TD>
                </TR>
              );
            })}
            {lineRows.length === 0 && (
              <TR>
                <TD colSpan={6} className="text-center text-ink-3 py-6">
                  No components yet.
                </TD>
              </TR>
            )}
          </TBody>
        </Table>
      </Card>

      {isAdmin && (
        <Card padded={false}>
          <div className="px-5 py-3.5 border-b border-line-2">
            <span className="text-[15px] font-semibold text-ink">Add a component</span>
          </div>
          <div className="p-4">
            {availableComponents.length > 0 ? (
              <AddLineForm structureId={structure.id} availableComponents={availableComponents} />
            ) : (
              <p className="text-sm text-ink-2">
                Every component this company has is already on this structure. Create a new one below to add another.
              </p>
            )}
          </div>
        </Card>
      )}

      {isAdmin && (
        <Card padded={false}>
          <div className="px-5 py-3.5 border-b border-line-2">
            <span className="text-[15px] font-semibold text-ink">Create a new component</span>
          </div>
          <div className="p-4">
            <p className="text-xs text-ink-2 max-w-[72ch] mb-3">
              Not the same as picking one above — this defines a component
              this company has never had before, the way Settings → Master
              Data → Pay components does. It appears in the list above and
              on every other structure&rsquo;s once it exists; adding it to
              this one is the separate step above.
            </p>
            <PayComponentForm
              companyId={structure.companyId}
              otherComponents={allComponents.map((c) => ({ code: c.code, name: c.name }))}
              structureId={structure.id}
            />
          </div>
        </Card>
      )}

      <Card padded={false}>
        <div className="px-5 py-3.5 border-b border-line-2">
          <span className="text-[15px] font-semibold text-ink">Employees currently on this structure ({candidates.length})</span>
        </div>
        <Table>
          <THead>
            {["Code", "Name", "How assigned"].map((h) => (
              <TH key={h}>{h}</TH>
            ))}
          </THead>
          <TBody>
            {candidates.map((c) => (
              <TR key={c.employeeId}>
                <TD className="font-mono text-xs text-ink-3">{c.empCode}</TD>
                <TD>
                  <Link href={`/console/employees/${c.employeeId}`} className="hover:underline">
                    {c.name}
                  </Link>
                </TD>
                <TD className="text-ink-2">{SOURCE_LABEL[c.source]}</TD>
              </TR>
            ))}
            {candidates.length === 0 && (
              <TR>
                <TD colSpan={3} className="text-center text-ink-3 py-6">
                  No employees currently resolve to this structure.
                </TD>
              </TR>
            )}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
