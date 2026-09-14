import type { Metadata } from "next";
import {
  Container,
  Section,
  SectionHead,
  PageHero,
  SpecRow,
  FeatureCard,
  Callout,
  CheckList,
  NextPage,
} from "@/components/ui";

export const metadata: Metadata = {
  title: "Payroll",
  description:
    "The calculation engine — proration and rounding you control, CTC structures, flexi benefits, loans, run lifecycle with maker–checker, arrears and settlement.",
};

const STATES = [
  { s: "Draft", d: "Period open, inputs still arriving" },
  { s: "Inputs locked", d: "Attendance, leave and adjustments frozen" },
  { s: "Calculated", d: "Engine has run, validations reported" },
  { s: "In review", d: "Variance and exceptions under examination" },
  { s: "Approved", d: "Maker–checker satisfied, version stamped" },
  { s: "Finalised", d: "Payslips, bank file and statutory output issued" },
  { s: "Disbursed", d: "Bank response reconciled against instructions" },
  { s: "Closed", d: "Period locked; reopening creates a new version" },
];

export default function PayrollPage() {
  return (
    <>
      <PageHero
        code="04 · Payroll"
        title="The conventions are yours. The arithmetic is ours."
        lede="Indian payroll differs between companies less in its statutory rules than in its conventions — how a part month is prorated, what a day is worth, how rounding falls. Every one of those is an explicit setting with a stated default, versioned by effective date."
        stats={[
          { value: "4", unit: "bases", label: "Proration options" },
          { value: "10", unit: "min", label: "1,000 employees, 5 entities" },
          { value: "₹0.00", label: "Reconciliation tolerance" },
          { value: "Full", label: "Run versioning" },
        ]}
      />

      {/* SETTINGS */}
      <Section bordered={false}>
        <Container>
          <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-10 lg:gap-16">
            <SectionHead
              eyebrow="Settings"
              title="The settings that lose other vendors the deal."
              lede="These are hard-coded almost everywhere else. Changing one mid-year requires a reason that lands in the audit log."
            />
            <div>
              <SpecRow code="SET-2" title="Proration &amp; per-day value">
                The single most consequential setting in the product. Choose
                calendar days in the month, a fixed 30, working days, or a standard
                figure such as 26. It applies uniformly to joiners, leavers, loss of
                pay and arrears — and the payslip states the basis and day count
                used, so a disputed figure can be reconstructed without a support
                ticket.
              </SpecRow>
              <SpecRow code="SET-3" title="Loss of pay treatment">
                Which components reduce, whether a weekly off or holiday adjacent to
                unpaid absence is itself unpaid — the sandwich rule, stated
                explicitly rather than assumed — and how retrospective loss of pay
                is handled after a period closes.
              </SpecRow>
              <SpecRow code="SET-4" title="Rounding">
                Configurable at component, gross, statutory-deduction and net level,
                with a rule for absorbing the difference so components always sum to
                the stated gross. Statutory figures follow their own prescribed
                rounding, independent of your setting.
              </SpecRow>
              <SpecRow code="SET-1" title="Calendar &amp; cut-offs">
                Attendance cut-off, input freeze, processing window and disbursement
                date. Where your cut-off is not month-end, you decide whether the
                tail is estimated and trued up or lagged — and that choice applies
                consistently, including at exit.
              </SpecRow>
              <SpecRow code="SET-5" title="Statutory configuration">
                EPF wage ceiling or actual basic, whether employer share sits inside
                or outside CTC, EPS applicability, admin and EDLI charges, ESIC
                threshold and rates — all effective-dated, never constants in code.
              </SpecRow>
            </div>
          </div>
        </Container>
      </Section>

      {/* COMPENSATION */}
      <Section>
        <Container>
          <SectionHead
            eyebrow="Compensation"
            title="Structures, revisions and the CTC engine."
          />
          <div className="grid lg:grid-cols-2 gap-10 mt-10">
            <div>
              <SpecRow code="PAY-2" title="Pay components">
                Each component declares its type, calculation method, taxability,
                and applicability to EPF, ESIC, PT, LWF, bonus and gratuity bases —
                plus its proration and arrear behaviour. Formulas evaluate with a
                declared dependency order and cycle detection at save time, not at
                run time.
              </SpecRow>
              <SpecRow code="CMP-2" title="CTC build-up, both directions">
                Give it a target annual CTC and it derives the full break-up
                including employer PF, ESIC, gratuity provision and insurance
                loading. Give it a target take-home and it runs in reverse. This is
                the artefact that goes into the offer letter, so it reproduces
                exactly at any later date.
              </SpecRow>
              <SpecRow code="CMP-3" title="Minimum wage check">
                Validated against the state, skill category and scheduled employment
                from an effective-dated table. Breaches block the run rather than
                appearing in a report afterwards.
              </SpecRow>
            </div>
            <div>
              <SpecRow code="CMP-4" title="Revisions, including bulk">
                Past, present or future effective dates with a reason and approval
                chain. Future-dated revisions apply in the right period; past-dated
                ones generate arrears. Bulk appraisal upload with per-employee
                validation is in scope, because the alternative is a spreadsheet
                edited outside the system.
              </SpecRow>
              <SpecRow code="PAY-4" title="Arrears &amp; retrospective recalculation">
                Any backdated change re-computes each affected closed period on its
                original settings, diffs against what was actually paid, and books
                the difference as itemised lines showing the source month. PF and
                ESIC on arrears follow the month of payment; section 89 relief is
                available as a declared option.
              </SpecRow>
              <SpecRow code="CMP-6" title="Gratuity">
                Fifteen days&rsquo; last-drawn wages per completed year on a 26-day
                divisor, six months or more rounding up, the statutory ceiling
                applied, and the five-year qualifying period waived on death or
                disablement. Monthly provisioning exposes the accrued liability to
                finance.
              </SpecRow>
            </div>
          </div>
        </Container>
      </Section>

      {/* FLEXI + LOANS */}
      <Section>
        <Container>
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-16">
            <div>
              <SectionHead
                eyebrow="Flexible benefits"
                title="A flexi basket that actually saves tax."
                lede="Without one, tax-advantaged components either sit unused or get paid fully taxable. It is a standard expectation in this segment."
              />
              <div className="mt-8">
                <CheckList
                  items={[
                    "Basket defined per company or grade, with per-head minimums and maximums",
                    "Fuel, driver, telephone, books, meals, professional development and LTA",
                    "Declaration window with live tax impact shown as the employee allocates",
                    "Bill-backed claims routed for verification; the outcome decides what is exempt",
                    "LTA on its own terms — block years, journey-based claims, fare-only exemption",
                    "Unclaimed balance paid out as taxable in a month you choose, not as a March surprise",
                  ]}
                />
              </div>
              <div className="mt-6">
                <Callout label="Regime interaction" tone="rust">
                  Most flexi exemptions are unavailable under the new tax regime. If
                  an employee&rsquo;s regime election makes their declaration
                  ineffective, we say so at declaration time rather than quietly
                  computing a worse outcome.
                </Callout>
              </div>
            </div>

            <div>
              <SectionHead
                eyebrow="Loans &amp; recoveries"
                title="Schedules that survive real life."
              />
              <div className="mt-8">
                <SpecRow code="LOAN-1/2" title="Schemes &amp; disbursement">
                  Interest-free, flat or reducing balance, with maximum principal by
                  grade and an amortisation schedule the employee can see.
                </SpecRow>
                <SpecRow code="LOAN-3" title="Life events">
                  Moratorium, hold, part prepayment with schedule rebuild,
                  foreclosure, and the case where loss of pay leaves net pay too
                  small to cover the instalment. Skipped instalments extend the
                  schedule rather than disappearing.
                </SpecRow>
                <SpecRow code="LOAN-4" title="Concessional loan perquisite">
                  Where your rate is below the prescribed benchmark, the perquisite
                  value computes on the outstanding balance and flows into tax
                  automatically. Customers routinely miss this by hand.
                </SpecRow>
                <SpecRow code="LOAN-5" title="Recovery register">
                  Excess payments, unreturned assets, notice shortfall and travel
                  advances — each with its own approval, schedule and settlement
                  behaviour, visible to the employee with a running balance.
                </SpecRow>
              </div>
            </div>
          </div>
        </Container>
      </Section>

      {/* RUN */}
      <Section>
        <Container>
          <SectionHead
            eyebrow="The run"
            title="Eight states, and you can always go back."
            lede="Every transition records who, when, and on what version of the inputs. Backward transitions require a reason and always create a new version rather than mutating the last one."
          />

          <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-px bg-line mt-10 border border-line">
            {STATES.map((s, i) => (
              <li key={s.s} className="bg-surface p-5 flex flex-col gap-1.5">
                <span className="label text-brass tnum">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="font-display text-base font-semibold">{s.s}</span>
                <span className="text-sm text-ink-2 leading-relaxed pretty">
                  {s.d}
                </span>
              </li>
            ))}
          </ol>

          <div className="grid lg:grid-cols-2 gap-10 mt-12">
            <div>
              <SpecRow code="RUN-2" title="Pre-run validation">
                Findings are classified blocking or advisory. Blocking: missing bank
                details, missing PAN where deduction applies, no salary structure,
                negative net pay, a branch with no PT configuration where PT
                applies. Advisory: gross variance beyond a threshold, an unusually
                large arrear, a joiner with no attendance, an employee crossing the
                ESIC threshold. Every finding links to the record that fixes it.
              </SpecRow>
              <SpecRow code="RUN-3" title="Explainability">
                For any employee and any component we show the formula applied, the
                values substituted, the proration basis and day count, and the
                configuration version used.
              </SpecRow>
              <SpecRow code="RUN-4" title="Variance review">
                Month-on-month movement decomposed into its causes — headcount,
                revisions, arrears, loss of pay, variable pay, tax. A reviewer
                should be able to explain the whole delta before approving, rather
                than sampling payslips.
              </SpecRow>
            </div>
            <div>
              <SpecRow code="RUN-5" title="Maker–checker">
                Segregation of duties is enforced, not advisory: whoever prepared a
                run cannot be its sole approver. Approval records the exact version
                approved, per approver.
              </SpecRow>
              <SpecRow code="RUN-7" title="Off-cycle runs">
                Settlements, bonus payouts, arrear-only disbursements and
                corrections, each with its own approval and bank file, folding into
                the same year-to-date figures and tax projection.
              </SpecRow>
              <SpecRow code="RUN-8" title="Hold &amp; stop payment">
                Hold one employee&rsquo;s payment with a reason and approver without
                blocking the run. Held amounts stay a visible liability and release
                through an authorised action.
              </SpecRow>
            </div>
          </div>
        </Container>
      </Section>

      {/* BANKING */}
      <Section>
        <Container>
          <SectionHead
            eyebrow="Money out, books closed"
            title="Banking, GL and settlement."
          />
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-10">
            <FeatureCard code="BANK-1" title="Bank files">
              Formats for the major corporate banks plus generic NEFT and RTGS
              layouts. Generated against an approved run only — regenerating after a
              version change explicitly invalidates the earlier file.
            </FeatureCard>
            <FeatureCard code="BANK-3" title="Payment reconciliation">
              Import the bank response, mark each payment paid, returned or failed.
              Failures raise a task and hold the amount as a liability rather than
              vanishing.
            </FeatureCard>
            <FeatureCard code="BANK-5" title="GL &amp; journal export">
              A balanced journal voucher per run, split by cost centre, department,
              branch or project, with a stated rule for an employee who moves
              mid-period.
            </FeatureCard>
            <FeatureCard code="BANK-6" title="Accounting integrations">
              Tally XML and generic journal CSV, plus an API push for cloud ERPs.
              Every export records what was sent and when.
            </FeatureCard>
            <FeatureCard code="PAY-19" title="Settlement tax">
              Section 10(10AA) on leave encashment, gratuity exemption to the
              ceiling, and notice pay taxed correctly in both directions — the most
              common defect in Indian settlement processing.
            </FeatureCard>
            <FeatureCard code="PAY-20" title="Negative settlements">
              Where recoveries exceed payables, the system issues a demand
              statement, records a receivable, tracks part recovery and supports an
              authorised write-off. It never silently rounds to zero.
            </FeatureCard>
          </div>

          <div className="mt-10">
            <Callout label="Reconciliation tolerance is zero" tone="teal">
              The payroll register, the bank file, the journal export and the
              statutory summaries must agree to the rupee for every run.
              Disagreement is a blocking finalisation error, not a report someone
              reads later.
            </Callout>
          </div>
        </Container>
      </Section>

      <NextPage href="/compliance" label="Compliance — statutory coverage" />
    </>
  );
}
