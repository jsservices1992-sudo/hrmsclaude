import { formatINR } from "@/lib/payroll/money";
import type { CtcBreakdown } from "@/lib/payroll/compensation";
import { Table, THead, TH, TBody, TR, TD } from "./ui";

type Line = {
  label: string;
  basis: string;
  amountPaise: number;
  /** Where the annual figure is not simply twelve of the monthly one. */
  annualPaise?: number;
};

/**
 * What the employee is actually left with, and everything that came off to
 * get there. Optional only because one caller does not have it yet; the
 * table is worse without it — CTC is the number a company talks about and
 * net is the number the employee lives on, and a breakup that stops at CTC
 * answers the wrong person's question.
 */
export type TakeHomeSummary = {
  takeHomePaise: number;
  epfPaise: number;
  esicPaise: number;
  ptPaise: number;
  /** Employee share of labour welfare fund, per deduction, and per year. */
  lwfPaise?: number;
  lwfAnnualPaise?: number;
  lwfBasis?: string;
  /** Projected income tax for the month, once declarations are in. */
  incomeTaxPaise?: number;
  incomeTaxAnnualPaise?: number;
  incomeTaxBasis?: string;
};

function SectionRow({ label }: { label: string }) {
  return (
    <TR className="bg-surface-2">
      <TD className="label text-ink-2" colSpan={4}>
        {label}
      </TD>
    </TR>
  );
}

/**
 * The whole compensation picture for one salary: every earning component
 * that derives the monthly gross, then the employer-borne cost stacked on
 * top of it to reach CTC, then everything deducted from the employee to
 * reach the net. Monthly and annual are shown side by side because offers
 * are discussed annually and payroll is run monthly.
 *
 * The three sides are labelled rather than merely ordered. Read as one
 * unbroken list, an employer contribution and an employee deduction look
 * alike — both sit under the gross, both are statutory, and only the minus
 * sign tells them apart. The employee's own deductions are the ones they
 * came to this screen to find.
 */
export function SalaryBreakupTable({
  ctc,
  takeHome,
}: {
  ctc: CtcBreakdown;
  takeHome?: TakeHomeSummary;
}) {
  const annualOf = (l: Line) => l.annualPaise ?? l.amountPaise * 12;

  const employerLines: Line[] = [
    { label: "Employer provident fund", amountPaise: ctc.employerPfPaise, basis: "Employer share of PF on PF wages" },
    { label: "Employer ESIC", amountPaise: ctc.employerEsicPaise, basis: "Employer share, where ESIC applies" },
    { label: "Gratuity provision", amountPaise: ctc.gratuityProvisionPaise, basis: "15 days' wages a year, accrued monthly" },
    { label: "Other employer cost", amountPaise: ctc.otherEmployerPaise, basis: "Flat monthly employer cost" },
  ].filter((l) => l.amountPaise > 0);

  const employeeLines: Line[] = takeHome
    ? (
        [
          { label: "Provident fund (employee)", amountPaise: takeHome.epfPaise, basis: "12% of PF wages, deducted from pay" },
          { label: "ESIC (employee)", amountPaise: takeHome.esicPaise, basis: "0.75% of gross, where ESIC applies" },
          { label: "Professional tax", amountPaise: takeHome.ptPaise, basis: "State slab on the PT base" },
          {
            label: "Labour welfare fund (employee)",
            amountPaise: takeHome.lwfPaise ?? 0,
            annualPaise: takeHome.lwfAnnualPaise,
            basis: takeHome.lwfBasis ?? "State labour welfare fund",
          },
          {
            label: "Income tax (TDS)",
            amountPaise: takeHome.incomeTaxPaise ?? 0,
            annualPaise: takeHome.incomeTaxAnnualPaise,
            basis: takeHome.incomeTaxBasis ?? "Projected annual tax spread over the remaining months",
          },
        ] satisfies Line[]
      ).filter((l) => l.amountPaise > 0)
    : [];

  /* The net above is struck before income tax, because that is how the
     rest of the app defines take-home. Tax is subtracted again here so the
     final line is the figure that actually reaches the bank. */
  const taxMonthly = takeHome?.incomeTaxPaise ?? 0;
  const taxAnnual = takeHome?.incomeTaxAnnualPaise ?? taxMonthly * 12;
  const netMonthly = (takeHome?.takeHomePaise ?? 0) - (takeHome?.lwfPaise ?? 0) - taxMonthly;
  const netAnnual =
    (takeHome?.takeHomePaise ?? 0) * 12 - (takeHome?.lwfAnnualPaise ?? (takeHome?.lwfPaise ?? 0) * 12) - taxAnnual;

  const employeeTotalMonthly = employeeLines.reduce((a, l) => a + l.amountPaise, 0);
  const employeeTotalAnnual = employeeLines.reduce((a, l) => a + annualOf(l), 0);

  return (
    <Table>
      <THead>
        <TH>Component</TH>
        <TH>Basis</TH>
        <TH className="text-right">Monthly</TH>
        <TH className="text-right">Annual</TH>
      </THead>
      <TBody>
        <SectionRow label="Earnings — what makes up the gross" />
        {ctc.components.map((l) => (
          <TR key={l.code}>
            <TD>{l.label}</TD>
            <TD className="text-ink-2 text-xs whitespace-normal">{l.basis}</TD>
            <TD className="text-right font-mono tnum">{formatINR(l.amountPaise)}</TD>
            <TD className="text-right font-mono tnum text-ink-2">{formatINR(l.amountPaise * 12)}</TD>
          </TR>
        ))}

        <TR className="bg-surface-2">
          <TD className="font-medium">Gross</TD>
          <TD className="text-ink-2 text-xs whitespace-normal">What the payslip is built from, before deductions</TD>
          <TD className="text-right font-mono tnum font-medium">{formatINR(ctc.monthlyGrossPaise)}</TD>
          <TD className="text-right font-mono tnum font-medium">{formatINR(ctc.annualGrossPaise)}</TD>
        </TR>

        {employerLines.length > 0 && (
          <SectionRow label="Employer contributions — paid on top of gross, not deducted" />
        )}
        {employerLines.map((l) => (
          <TR key={l.label}>
            <TD className="text-ink-2">{l.label}</TD>
            <TD className="text-ink-2 text-xs whitespace-normal">{l.basis}</TD>
            <TD className="text-right font-mono tnum text-ink-2">{formatINR(l.amountPaise)}</TD>
            <TD className="text-right font-mono tnum text-ink-2">{formatINR(annualOf(l))}</TD>
          </TR>
        ))}

        <TR className="bg-surface-2">
          <TD className="font-medium">Cost to company</TD>
          <TD className="text-ink-2 text-xs whitespace-normal">
            Gross plus everything the employer pays on top — not money the employee receives
          </TD>
          <TD className="text-right font-mono tnum font-medium">{formatINR(ctc.monthlyCtcPaise)}</TD>
          <TD className="text-right font-mono tnum font-medium">{formatINR(ctc.annualCtcPaise)}</TD>
        </TR>

        {takeHome && (
          <>
            <SectionRow label="Employee deductions — taken out of gross" />
            {employeeLines.map((l) => (
              <TR key={l.label}>
                <TD className="text-ink-2">{l.label}</TD>
                <TD className="text-ink-2 text-xs whitespace-normal">{l.basis}</TD>
                <TD className="text-right font-mono tnum text-rust">−{formatINR(l.amountPaise)}</TD>
                <TD className="text-right font-mono tnum text-rust">−{formatINR(annualOf(l))}</TD>
              </TR>
            ))}

            {employeeLines.length === 0 && (
              <TR>
                <TD className="text-ink-2" colSpan={4}>
                  Nothing is deducted at this salary — PF, ESIC, professional tax and labour
                  welfare fund all fall outside their thresholds, and no income tax is projected.
                </TD>
              </TR>
            )}

            {employeeLines.length > 1 && (
              <TR>
                <TD className="font-medium">Total deductions</TD>
                <TD className="text-ink-2 text-xs whitespace-normal">
                  Everything that comes off the gross before it is paid
                </TD>
                <TD className="text-right font-mono tnum font-medium text-rust">
                  −{formatINR(employeeTotalMonthly)}
                </TD>
                <TD className="text-right font-mono tnum font-medium text-rust">
                  −{formatINR(employeeTotalAnnual)}
                </TD>
              </TR>
            )}

            <TR className="bg-surface-2">
              <TD className="font-medium">Net in hand</TD>
              <TD className="text-ink-2 text-xs whitespace-normal">
                {takeHome.incomeTaxPaise
                  ? "What reaches the bank account, after every deduction including income tax."
                  : "What reaches the bank account. No income tax is projected yet — it is added once their declarations are in."}
              </TD>
              <TD className="text-right font-mono tnum font-medium">{formatINR(netMonthly)}</TD>
              <TD className="text-right font-mono tnum font-medium">{formatINR(netAnnual)}</TD>
            </TR>
          </>
        )}
      </TBody>
    </Table>
  );
}
