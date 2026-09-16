import type { PayslipData } from "@/lib/payroll/payslip";
import type { TaxWorksheet } from "@/lib/tax/load";

/**
 * The payslip as a document rather than a console screen: the layout
 * Indian payroll has settled on — masthead, identity grid, then rate /
 * earning / deduction panels side by side, the net in words, and the
 * annual tax position underneath. Sized to sit on one A4 sheet.
 */

/** Rupee figures without the symbol — column headers already say (Rs). */
function rs(paise: number): string {
  return (paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Whole rupees, for the annual block where paise are noise. */
function rsWhole(paise: number): string {
  return Math.round(paise / 100).toLocaleString("en-IN");
}

/** Initials for the fallback mark, at most two letters. */
function monogram(name: string): string {
  const words = name.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
  return words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}

const RULE = "border-line";
const CELL = `border ${RULE} px-2 py-[3px] align-top`;
const NUM = `${CELL} text-right font-mono tnum whitespace-nowrap`;
const KEY = `border ${RULE} px-2 py-[3px] text-left font-medium text-ink-2 whitespace-nowrap bg-surface-2/60`;
const BAND = `border ${RULE} bg-surface-2 font-semibold text-center py-[5px] tracking-wide`;

function Field({ label, value }: { label: string; value: string }) {
  return (
    <>
      <th scope="row" className={KEY}>{label}</th>
      <td className={`${CELL} font-mono`}>{value || "—"}</td>
    </>
  );
}

/** A label/amount list inside one annual panel. */
function AnnualPanel({
  title,
  rows,
  emptyNote,
}: {
  title: string;
  rows: { label: string; value: string; strong?: boolean }[];
  emptyNote: string;
}) {
  return (
    <section data-print="keep" className={`border ${RULE} flex flex-col min-w-0`}>
      <h3 className={`${BAND} border-0 border-b text-[10px]`}>{title}</h3>
      {rows.length === 0 ? (
        <p className="px-2 py-1.5 text-ink-3 italic">{emptyNote}</p>
      ) : (
        <dl className="divide-y divide-line-2">
          {rows.map((r, i) => (
            <div
              key={`${r.label}-${i}`}
              className={`flex items-baseline justify-between gap-2 px-2 py-[3px] ${r.strong ? "font-semibold bg-surface-2/40" : ""}`}
            >
              <dt className="min-w-0 hyphens-none">{r.label}</dt>
              <dd className="font-mono tnum whitespace-nowrap shrink-0">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

export function PayslipDocument({
  slip,
  worksheet,
}: {
  slip: PayslipData;
  worksheet?: TaxWorksheet | null;
}) {
  const { header: h } = slip;

  // The three panels differ in length; pad so their borders line up.
  const bodyRows = Math.max(slip.rates.length, slip.earnings.length, slip.deductions.length, 1);
  const showRates = slip.rates.length > 0;

  const annual = worksheet?.annual;
  const tax = annual?.tax;

  const earningsPanel = worksheet
    ? [
        { label: "Projected basic", value: rsWhole(worksheet.annualBasicPaise) },
        { label: "Projected HRA", value: rsWhole(worksheet.annualHraPaise) },
        {
          label: "Projected other",
          value: rsWhole(
            Math.max(0, worksheet.annualGrossPaise - worksheet.annualBasicPaise - worksheet.annualHraPaise),
          ),
        },
        { label: "Annual salary earning", value: rsWhole(worksheet.annualGrossPaise) },
        { label: "Perquisites", value: rsWhole(worksheet.perquisites.totalPaise) },
        { label: "Previous employer", value: rsWhole(annual?.previousEmployerSalaryPaise ?? 0) },
        { label: "Total salary income", value: rsWhole(annual?.grossSalaryPaise ?? 0), strong: true },
        { label: "Less: deduction u/s 16", value: rsWhole(annual?.standardDeductionPaise ?? 0) },
        { label: "Less: exemption u/s 10", value: rsWhole(annual?.exemptAllowancesPaise ?? 0) },
        { label: "Less: professional tax", value: rsWhole(annual?.professionalTaxPaise ?? 0) },
        { label: "Less: chapter VI-A", value: rsWhole(annual?.chapterViAPaise ?? 0) },
        { label: "Total taxable income", value: rsWhole(annual?.taxableIncomePaise ?? 0), strong: true },
      ]
    : [];

  const taxPanel = worksheet
    ? [
        { label: "Tax on taxable income", value: rsWhole(tax?.taxBeforeRebatePaise ?? 0) },
        { label: "Rebate u/s 87A", value: rsWhole(tax?.rebatePaise ?? 0) },
        { label: "Tax after rebate", value: rsWhole(tax?.taxAfterRebatePaise ?? 0) },
        { label: "Surcharge", value: rsWhole(tax?.surchargePaise ?? 0) },
        { label: "Health & education cess", value: rsWhole(tax?.cessPaise ?? 0) },
        { label: "Net tax payable", value: rsWhole(tax?.totalTaxPaise ?? 0), strong: true },
        { label: "Tax deducted YTD", value: rsWhole(worksheet.tdsToDatePaise) },
        // Still to come out of the remaining months — the year's deductions
        // so far are already credited against it.
        { label: "Balance tax", value: rsWhole(worksheet.projection.remainingTaxPaise), strong: true },
        { label: "Monthly TDS", value: rsWhole(worksheet.projection.monthlyTdsPaise) },
      ]
    : [];

  const investmentPanel = worksheet
    ? worksheet.deductions.lines.map((l) => ({
        label: l.section,
        value: rsWhole(l.allowedPaise),
      }))
    : [];

  const exemptionPanel = worksheet
    ? [
        ...(worksheet.hra?.workings ?? []).map((w) => ({
          label: w.label,
          value: rsWhole(w.amountPaise),
        })),
        { label: "HRA exemption", value: rsWhole(worksheet.hra?.exemptPaise ?? 0), strong: true },
        { label: "HRA taxable", value: rsWhole(worksheet.hra?.taxablePaise ?? 0) },
        ...(worksheet.perquisites.lines.map((l) => ({
          label: l.label,
          value: rsWhole(l.valuePaise),
        })) ?? []),
      ]
    : [];

  return (
    <article
      data-print="page"
      className={`border ${RULE} bg-surface text-[10.5px] leading-[1.45] text-ink`}
    >
      {/* Masthead */}
      <header className={`flex items-start gap-3 px-3 py-2.5 border-b ${RULE}`}>
        {h.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a company
          // logo is arbitrary remote or data-URI content, not a build asset.
          <img
            src={h.logoUrl}
            alt=""
            className="h-11 w-auto max-w-[9rem] object-contain shrink-0"
          />
        ) : (
          <span
            aria-hidden
            className={`h-11 w-11 shrink-0 border ${RULE} bg-surface-2 grid place-items-center font-display text-base font-semibold text-ink-2`}
          >
            {monogram(h.companyName)}
          </span>
        )}
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold leading-tight">{h.companyName}</h2>
          <p className="text-ink-3 leading-tight">{h.companyAddressLines.join(" · ")}</p>
        </div>
      </header>

      <p className={`${BAND} border-x-0`}>PAYSLIP FOR THE MONTH OF {slip.periodLabel}</p>

      {/* Identity — three label/value pairs to a row */}
      <table className="w-full border-collapse table-fixed">
        <colgroup>
          <col className="w-[11%]" /><col className="w-[22%]" />
          <col className="w-[11%]" /><col className="w-[22%]" />
          <col className="w-[11%]" /><col className="w-[23%]" />
        </colgroup>
        <tbody>
          <tr>
            <Field label="Name" value={h.name} />
            <Field label="Employee ID" value={h.employeeId} />
            <Field label="Joining date" value={h.joiningDate} />
          </tr>
          <tr>
            {/* The employee's own numbers. The establishment's PF code
                used to sit here labelled "PF number", which is the
                company's, identical on everybody's slip, and not what a
                person checking their PF account needs — that is the UAN. */}
            <Field label="UAN" value={h.uanNo} />
            <Field label="PAN" value={h.panNo} />
            <Field label="ESIC IP" value={h.esicIp} />
          </tr>
          <tr>
            <Field label="Bank" value={h.bankName} />
            <Field label="Account no" value={h.accountNo} />
            <Field label="IFSC" value={h.ifsc} />
          </tr>
          <tr>
            <Field label="Department" value={h.department} />
            <Field label="Designation" value={h.designation} />
            <Field label="Days paid" value={h.daysPaid} />
          </tr>
          <tr>
            <Field label="Days LWP" value={h.daysLwp} />
            <Field label="Arrear days" value={h.arrearDays} />
            <Field label="Location" value={h.location} />
          </tr>
          <tr>
            {/* The company's, so it sits apart from the person's. */}
            <Field label="PF estd. code" value={h.pfNumber} />
            <Field label="" value="" />
            <Field label="" value="" />
          </tr>
        </tbody>
      </table>

      {/* Rates | earnings | deductions. The rates column appears only in a
          month where it differs from what was earned — otherwise it repeats
          the earnings column line for line and reads as a duplicate. */}
      <table className="w-full border-collapse table-fixed">
        {/* Amount columns are sized for the widest figure a payroll of this
            size produces; too narrow and a bold total wraps mid-number. */}
        <colgroup>
          {showRates && <><col className="w-[17%]" /><col className="w-[13%]" /></>}
          <col className={showRates ? "w-[17%]" : "w-[26%]"} />
          <col className="w-[8%]" />
          <col className={showRates ? "w-[13%]" : "w-[20%]"} />
          <col className={showRates ? "w-[19%]" : "w-[28%]"} />
          <col className={showRates ? "w-[13%]" : "w-[18%]"} />
        </colgroup>
        <thead>
          <tr>
            {showRates && <th colSpan={2} className={BAND}>Salary rates (Rs)</th>}
            <th colSpan={3} className={BAND}>Earnings this month (Rs)</th>
            <th colSpan={2} className={BAND}>Deductions (Rs)</th>
          </tr>
          <tr className="text-ink-3">
            {showRates && (
              <>
                <th className={`${KEY} font-normal`}>Component</th>
                <th className={`${KEY} font-normal text-right`}>Monthly</th>
              </>
            )}
            <th className={`${KEY} font-normal`}>Component</th>
            <th className={`${KEY} font-normal text-right`}>Arrear</th>
            <th className={`${KEY} font-normal text-right`}>Total</th>
            <th className={`${KEY} font-normal`}>Particulars</th>
            <th className={`${KEY} font-normal text-right`}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: bodyRows }).map((_, i) => {
            const rate = slip.rates[i];
            const earn = slip.earnings[i];
            const ded = slip.deductions[i];
            return (
              <tr key={i}>
                {showRates && (
                  <>
                    <td className={CELL}>{rate?.label ?? ""}</td>
                    <td className={NUM}>{rate ? rs(rate.amountPaise) : ""}</td>
                  </>
                )}
                <td className={CELL}>{earn?.label ?? ""}</td>
                <td className={NUM}>{earn ? rs(earn.arrearPaise) : ""}</td>
                <td className={NUM}>{earn ? rs(earn.amountPaise) : ""}</td>
                <td className={CELL}>{ded?.label ?? ""}</td>
                <td className={NUM}>{ded ? rs(ded.amountPaise) : ""}</td>
              </tr>
            );
          })}
          <tr className="font-semibold bg-surface-2/60">
            {showRates && (
              <>
                <td className={CELL}>Total</td>
                <td className={NUM}>{rs(slip.ratesTotalPaise)}</td>
              </>
            )}
            <td className={CELL}>Gross salary</td>
            <td className={NUM}>{rs(slip.arrearTotalPaise)}</td>
            <td className={NUM}>{rs(slip.grossPaise)}</td>
            <td className={CELL}>Total deductions</td>
            <td className={NUM}>{rs(slip.deductionsTotalPaise)}</td>
          </tr>
        </tbody>
      </table>

      {/* Net pay */}
      <div
        data-print="keep"
        className={`border-x border-b ${RULE} px-3 py-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1`}
      >
        <span className="font-display text-[13px] font-semibold">
          Net pay <span className="font-mono tnum">{rs(slip.netPaise)}</span>
        </span>
        <span className="text-ink-2 italic min-w-0">{slip.netInWords}</span>
      </div>

      {/* What the employer pays on top. Never deducted from the employee —
          but leaving it off makes their own PF look like it has no
          counterpart, and it is the difference between a salary and what
          the employee actually costs. */}
      {slip.employerContributions.length > 0 && (
        <table className="w-full border-collapse table-fixed">
          <colgroup>
            <col className="w-[54%]" />
            <col className="w-[23%]" />
            <col className="w-[23%]" />
          </colgroup>
          <thead>
            <tr>
              <th colSpan={3} className={BAND}>
                Employer contributions (Rs) — paid on top, not deducted from pay
              </th>
            </tr>
          </thead>
          <tbody>
            {slip.employerContributions.map((l, i) => (
              <tr key={l.label}>
                <td className={CELL}>{l.label}</td>
                <td className={NUM}>{rs(l.amountPaise)}</td>
                {i === 0 && (
                  <td
                    className={`${CELL} text-ink-2 align-middle`}
                    rowSpan={slip.employerContributions.length + (slip.monthlyCtcPaise > 0 ? 3 : 1)}
                  >
                    The contributions are this month&apos;s. Cost to company is
                    stated at the full monthly rate and includes the gratuity
                    provision, so unpaid leave in one month does not read as a
                    cut in the package.
                  </td>
                )}
              </tr>
            ))}
            <tr className="font-semibold bg-surface-2/60">
              <td className={CELL}>Total employer contributions</td>
              <td className={NUM}>{rs(slip.employerTotalPaise)}</td>
            </tr>
            {slip.monthlyCtcPaise > 0 && (
              <>
                <tr>
                  <td className={CELL}>Monthly CTC</td>
                  <td className={NUM}>{rs(slip.monthlyCtcPaise)}</td>
                </tr>
                <tr className="font-semibold bg-surface-2/60">
                  <td className={CELL}>Annual CTC</td>
                  <td className={NUM}>{rs(slip.annualCtcPaise)}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      )}

      {worksheet && (
        <>
          <p className={`${BAND} border-x-0`}>Annual salary &amp; tax details</p>
          <div data-print="cols-4" className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-line">
            <AnnualPanel title="Annual earnings" rows={earningsPanel} emptyNote="—" />
            <AnnualPanel title="Tax computation" rows={taxPanel} emptyNote="—" />
            <AnnualPanel
              title="Investment declared"
              rows={investmentPanel}
              emptyNote="No declaration on record"
            />
            <AnnualPanel
              title="Exemptions & perquisites"
              rows={exemptionPanel}
              emptyNote="None claimed"
            />
          </div>
        </>
      )}

      {slip.warnings.length > 0 && (
        <p data-print="hide" className={`border-x border-b ${RULE} px-3 py-1.5 text-brass`}>
          {slip.warnings.join(" · ")}
        </p>
      )}

      <p className={`${BAND} border-x-0 border-b-0 font-normal text-ink-3 text-[10px]`}>
        This is a computer generated payslip and does not require a signature.
      </p>
    </article>
  );
}
