import { formatINR } from "@/lib/payroll/money";
import type { CtcBreakdown } from "@/lib/payroll/compensation";
import { Table, THead, TH, TBody, TR, TD } from "./ui";

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
  lwfEmployerPaise?: number;
  lwfMonths?: number[];
  /** Projected income tax for the month, once declarations are in. */
  incomeTaxPaise?: number;
  incomeTaxAnnualPaise?: number;
  incomeTaxBasis?: string;
};

type Row = {
  label: string;
  /** Text stands in for an amount where there is no figure to give yet. */
  monthly: number | string;
  annual?: number | string;
  note?: string;
  strong?: boolean;
  negative?: boolean;
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function Amount({ value, negative }: { value: number | string; negative?: boolean }) {
  if (typeof value === "string") return <span className="text-ink-2 text-xs">{value}</span>;
  return (
    <>
      {negative && value > 0 ? "−" : ""}
      {formatINR(value)}
    </>
  );
}

function Section({ heading, rows }: { heading: string; rows: Row[] }) {
  return (
    <Table>
      <THead>
        <TH>{heading}</TH>
        <TH className="text-right">Monthly</TH>
        <TH className="text-right">Annual</TH>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.label} className={r.strong ? "bg-surface-2" : undefined}>
            <TD className={r.strong ? "font-medium" : undefined}>
              {r.label}
              {r.note && (
                <span className="block text-ink-2 text-xs whitespace-normal">{r.note}</span>
              )}
            </TD>
            <TD
              className={`text-right font-mono tnum ${r.strong ? "font-medium" : ""} ${
                r.negative ? "text-rust" : ""
              }`}
            >
              <Amount value={r.monthly} negative={r.negative} />
            </TD>
            <TD
              className={`text-right font-mono tnum ${r.strong ? "font-medium" : "text-ink-2"} ${
                r.negative ? "text-rust" : ""
              }`}
            >
              <Amount
                value={r.annual ?? (typeof r.monthly === "number" ? r.monthly * 12 : r.monthly)}
                negative={r.negative}
              />
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

/**
 * The compensation letter's two tables: what the employee is paid and what
 * comes out of it, then the employer's cost stacked on the same gross to
 * reach CTC.
 *
 * Statutory lines are listed even at nil. "ESIC ₹0" is information — it
 * says the question was asked and this salary sits above the threshold —
 * where a missing row only raises it. Income tax is the one figure that
 * cannot be stated from a salary alone, so it says so rather than printing
 * a zero that reads as a promise.
 */
export function SalaryBreakupTable({
  ctc,
  takeHome,
}: {
  ctc: CtcBreakdown;
  takeHome?: TakeHomeSummary;
}) {
  const earnings: Row[] = ctc.components.map((c) => ({
    label: c.label,
    monthly: c.amountPaise,
    note: c.basis,
  }));

  const employeeRows: Row[] = takeHome
    ? [
        { label: "Employee PF", monthly: takeHome.epfPaise, negative: true, note: "12% of PF wages" },
        {
          label: "Professional tax",
          monthly: takeHome.ptPaise,
          negative: true,
          note: "State slab — varies by the state the branch sits in",
        },
        { label: "ESIC", monthly: takeHome.esicPaise, negative: true, note: "0.75% of gross, where ESIC applies" },
        {
          label: "TDS (income tax)",
          monthly: takeHome.incomeTaxPaise ? takeHome.incomeTaxPaise : "As applicable",
          annual: takeHome.incomeTaxPaise ? takeHome.incomeTaxAnnualPaise : "As applicable",
          negative: true,
          note: takeHome.incomeTaxPaise
            ? takeHome.incomeTaxBasis
            : "Depends on their declarations and proofs — deducted once those are in",
        },
      ]
    : [];

  const lwfMonths = takeHome?.lwfMonths ?? [];
  const lwfNote =
    takeHome && (takeHome.lwfPaise ?? 0) > 0 && lwfMonths.length > 0
      ? `Labour welfare fund: ₹${((takeHome.lwfPaise ?? 0) / 100).toFixed(0)} from the employee` +
        ` and ₹${((takeHome.lwfEmployerPaise ?? 0) / 100).toFixed(0)} from the employer,` +
        ` deducted in ${lwfMonths.map((m) => MONTH_NAMES[m - 1]).join(" and ")} only.` +
        " It is left out of the monthly figures above because it is not charged every month."
      : null;

  const employerRows: Row[] = [
    { label: "Gross salary", monthly: ctc.monthlyGrossPaise, annual: ctc.annualGrossPaise },
    { label: "Employer PF", monthly: ctc.employerPfPaise, note: "Employer share on PF wages" },
    {
      label: "Gratuity provision",
      monthly: ctc.gratuityProvisionPaise,
      note: "Approximately 4.81% of basic — 15 days' wages a year, accrued monthly",
    },
    { label: "Employer ESIC", monthly: ctc.employerEsicPaise, note: "Employer share, where ESIC applies" },
    ...(ctc.otherEmployerPaise > 0
      ? [{ label: "Other employer cost", monthly: ctc.otherEmployerPaise, note: "Flat monthly employer cost" }]
      : []),
    {
      label: "Total CTC",
      monthly: ctc.monthlyCtcPaise,
      annual: ctc.annualCtcPaise,
      strong: true,
      note: "Gross plus everything the employer pays on top — not money the employee receives",
    },
  ];

  return (
    <div className="flex flex-col">
      <Section
        heading="Particulars"
        rows={[
          ...earnings,
          {
            label: "Gross salary",
            monthly: ctc.monthlyGrossPaise,
            annual: ctc.annualGrossPaise,
            strong: true,
            note: "What the payslip is built from, before deductions",
          },
          ...employeeRows,
          ...(takeHome
            ? [
                {
                  label: "Net take-home before TDS",
                  monthly: takeHome.takeHomePaise,
                  strong: true,
                  note: "What reaches the bank account, before income tax",
                } satisfies Row,
              ]
            : []),
        ]}
      />

      {lwfNote && (
        <p className="px-4 py-3 text-xs text-ink-2 border-t border-line whitespace-normal">
          {lwfNote}
        </p>
      )}

      <div className="border-t border-line">
        <Section heading="Employer contribution" rows={employerRows} />
      </div>
    </div>
  );
}
