import type { Form16PartB } from "@/lib/tax/form16";

/**
 * Form 16 Part B as a document.
 *
 * Deliberately not dressed up as the whole certificate. Part A — the
 * deductor's TAN, the challan identification numbers, the amounts the
 * department has actually matched — comes from TRACES and nowhere else.
 * Handing somebody a convincing-looking "Form 16" built entirely from
 * the employer's own books is how people file returns against credit
 * that was never deposited. So the masthead says what this is, the
 * quarterly table says where its figures come from, and the footer says
 * what still has to be collected from TRACES.
 */

const RULE = "border-line";
const CELL = `border ${RULE} px-2 py-[3px] align-top`;
const NUM = `${CELL} text-right font-mono tnum whitespace-nowrap`;
const KEY = `border ${RULE} px-2 py-[3px] text-left font-medium text-ink-2 whitespace-nowrap bg-surface-2/60`;
const BAND = `border ${RULE} bg-surface-2 font-semibold text-center py-[5px] tracking-wide`;

function rs(paise: number): string {
  return (paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const QUARTER_LABEL: Record<number, string> = {
  1: "Q1 · Apr–Jun",
  2: "Q2 · Jul–Sep",
  3: "Q3 · Oct–Dec",
  4: "Q4 · Jan–Mar",
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <>
      <th scope="row" className={KEY}>{label}</th>
      <td className={`${CELL} font-mono`}>{value || "—"}</td>
    </>
  );
}

export function Form16Document({
  form,
  employee,
  company,
}: {
  form: Form16PartB;
  employee: { name: string; empCode: string; pan: string; designation: string };
  company: { name: string; addressLines: string[]; tan?: string | null };
}) {
  return (
    <article
      data-print="page"
      className={`border ${RULE} bg-surface text-[11px] leading-[1.35] text-ink mx-auto w-full max-w-[52rem] break-after-page last:break-after-auto`}
    >
      <header className={`flex items-center gap-3 px-3 py-2.5 border-b ${RULE}`}>
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold leading-tight">{company.name}</h2>
          <p className="text-ink-3 leading-tight">{company.addressLines.join(" · ")}</p>
        </div>
      </header>

      <p className={`${BAND} border-x-0`}>
        FORM 16 · PART B — ANNEXURE · FINANCIAL YEAR {form.financialYear}-
        {String((form.financialYear + 1) % 100).padStart(2, "0")} · ASSESSMENT YEAR{" "}
        {form.assessmentYear}
      </p>

      <table className="w-full border-collapse table-fixed">
        <colgroup>
          <col className="w-[13%]" /><col className="w-[20%]" />
          <col className="w-[13%]" /><col className="w-[20%]" />
          <col className="w-[13%]" /><col className="w-[21%]" />
        </colgroup>
        <tbody>
          <tr>
            <Field label="Employee" value={employee.name} />
            <Field label="Employee ID" value={employee.empCode} />
            <Field label="PAN" value={employee.pan} />
          </tr>
          <tr>
            <Field label="Designation" value={employee.designation} />
            <Field label="Deductor TAN" value={company.tan ?? "Not on record"} />
            <Field label="Tax regime" value={form.regime === "old" ? "Old" : "New"} />
          </tr>
        </tbody>
      </table>

      {/* ---- the Part B computation ---- */}
      <p className={`${BAND} border-x-0 border-t-0 text-[10px]`}>
        DETAILS OF SALARY PAID AND ANY OTHER INCOME, AND TAX DEDUCTED
      </p>
      <table className="w-full border-collapse table-fixed">
        <colgroup>
          <col className="w-[8%]" /><col /><col className="w-[22%]" />
        </colgroup>
        <tbody>
          {form.rows.map((row) => (
            <tr key={row.no} className={row.emphasis ? "bg-surface-2/40 font-semibold" : ""}>
              <td className={`${CELL} font-mono text-ink-3`}>{row.no}</td>
              <td className={`${CELL} ${row.sub ? "pl-5" : ""}`}>
                {row.label}
                {row.note && <span className="block text-ink-3 italic">{row.note}</span>}
              </td>
              <td className={NUM}>{rs(row.amountPaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ---- Chapter VI-A annexure ---- */}
      {form.chapterViA.length > 0 && (
        <>
          <p className={`${BAND} border-x-0 border-t-0 text-[10px]`}>
            DEDUCTIONS UNDER CHAPTER VI-A
          </p>
          <table className="w-full border-collapse table-fixed">
            <colgroup>
              <col className="w-[16%]" /><col /><col className="w-[17%]" /><col className="w-[17%]" />
            </colgroup>
            <thead>
              <tr className="bg-surface-2/60">
                <th className={KEY}>Section</th>
                <th className={KEY}>Basis</th>
                <th className={`${KEY} text-right`}>Gross amount</th>
                <th className={`${KEY} text-right`}>Deductible amount</th>
              </tr>
            </thead>
            <tbody>
              {form.chapterViA.map((line) => (
                <tr key={line.section}>
                  <td className={`${CELL} font-mono`}>{line.section}</td>
                  <td className={`${CELL} text-ink-2`}>{line.note || "As declared and verified"}</td>
                  <td className={NUM}>{rs(line.claimedPaise)}</td>
                  <td className={NUM}>{rs(line.allowedPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* ---- quarterly deductions ---- */}
      <p className={`${BAND} border-x-0 border-t-0 text-[10px]`}>
        TAX DEDUCTED — EMPLOYER&rsquo;S RECORD
      </p>
      <table className="w-full border-collapse table-fixed">
        <colgroup>
          <col className="w-[30%]" /><col /><col className="w-[22%]" />
        </colgroup>
        <tbody>
          {form.quarters.map((q) => (
            <tr key={q.quarter}>
              <td className={CELL}>{QUARTER_LABEL[q.quarter]}</td>
              <td className={`${CELL} text-ink-3 italic`}>
                Challan identification to be taken from the TRACES Part A
              </td>
              <td className={NUM}>{rs(q.deductedPaise)}</td>
            </tr>
          ))}
          <tr className="bg-surface-2/40 font-semibold">
            <td className={CELL} colSpan={2}>Total deducted during the year</td>
            <td className={NUM}>{rs(form.totalDeductedPaise)}</td>
          </tr>
          <tr>
            <td className={CELL} colSpan={2}>
              {form.balancePaise > 0
                ? "Still to be deducted before the year closes"
                : form.balancePaise < 0
                  ? "Deducted in excess of the year's liability"
                  : "Fully deducted"}
            </td>
            <td className={NUM}>{rs(Math.abs(form.balancePaise))}</td>
          </tr>
        </tbody>
      </table>

      <footer className={`px-3 py-2.5 border-t ${RULE} text-ink-3 flex flex-col gap-1`}>
        {!form.complete && (
          <p className="text-brass font-medium">
            Provisional — the financial year is not complete, so these figures
            are the position to date and will move with the remaining payrolls.
          </p>
        )}
        <p>
          This is Part B, generated from payroll records. It is not a complete
          Form 16: Part A, carrying the deductor&rsquo;s challan details and the
          tax credit actually matched by the department, is issued through
          TRACES and must be obtained from your employer separately. File your
          return against the credit shown in your Form 26AS or AIS, not against
          this statement alone.
        </p>
      </footer>
    </article>
  );
}
