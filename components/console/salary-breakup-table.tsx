import { formatINR } from "@/lib/payroll/money";
import type { CtcBreakdown } from "@/lib/payroll/compensation";
import { Table, THead, TH, TBody, TR, TD } from "./ui";

/**
 * The whole compensation picture for one salary: every earning component
 * that derives the monthly gross, then the employer-borne cost stacked on
 * top of it to reach CTC. Monthly and annual are shown side by side
 * because offers are discussed annually and payroll is run monthly.
 */
export function SalaryBreakupTable({ ctc }: { ctc: CtcBreakdown }) {
  const employerLines = [
    { label: "Employer provident fund", amountPaise: ctc.employerPfPaise, basis: "Employer share of PF on PF wages" },
    { label: "Employer ESIC", amountPaise: ctc.employerEsicPaise, basis: "Employer share, where ESIC applies" },
    { label: "Gratuity provision", amountPaise: ctc.gratuityProvisionPaise, basis: "15 days' wages a year, accrued monthly" },
    { label: "Other employer cost", amountPaise: ctc.otherEmployerPaise, basis: "Flat monthly employer cost" },
  ].filter((l) => l.amountPaise > 0);

  return (
    <Table>
      <THead>
        <TH>Component</TH>
        <TH>Basis</TH>
        <TH className="text-right">Monthly</TH>
        <TH className="text-right">Annual</TH>
      </THead>
      <TBody>
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

        {employerLines.map((l) => (
          <TR key={l.label}>
            <TD className="text-ink-2">{l.label}</TD>
            <TD className="text-ink-2 text-xs whitespace-normal">{l.basis}</TD>
            <TD className="text-right font-mono tnum text-ink-2">{formatINR(l.amountPaise)}</TD>
            <TD className="text-right font-mono tnum text-ink-2">{formatINR(l.amountPaise * 12)}</TD>
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
      </TBody>
    </Table>
  );
}
