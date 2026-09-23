import Link from "next/link";
import {
  Container,
  Section,
  SectionHead,
  Eyebrow,
  Button,
  FeatureCard,
  Callout,
} from "@/components/ui";
import { NAV, PT_COUNT, LWF_COUNT, TOTAL_COUNT } from "@/lib/site";

/* ---------- hero artifact: a real run summary ---------- */

const RUN_LINES = [
  { label: "Gross earnings", value: "1,42,86,400", tone: "" },
  { label: "Employee PF", value: "−6,48,000", tone: "text-ink-2" },
  { label: "ESIC — employee", value: "−41,325", tone: "text-ink-2" },
  { label: "Professional tax", value: "−1,08,600", tone: "text-ink-2" },
  { label: "Labour welfare fund", value: "−9,450", tone: "text-ink-2" },
  { label: "Income tax (TDS)", value: "−18,94,220", tone: "text-ink-2" },
  { label: "Loans & recoveries", value: "−2,17,000", tone: "text-ink-2" },
];

function RunSummary() {
  return (
    <div className="bg-surface border border-line shadow-[0_1px_0_0_var(--line-2)] rounded-lg">
      <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-line bg-surface-2">
        <div className="flex flex-col">
          <span className="label text-ink-3">Payroll run</span>
          <span className="font-display text-base font-semibold">
            Example Industries Pvt Ltd
          </span>
        </div>
        <span className="label px-2 py-1 bg-teal-soft text-teal shrink-0 rounded-lg">
          Approved
        </span>
      </div>

      <dl className="px-5 py-2">
        {RUN_LINES.map((line) => (
          <div
            key={line.label}
            className="flex items-baseline justify-between gap-6 py-2.5 border-b border-line-2"
          >
            <dt className="text-sm text-ink-2">{line.label}</dt>
            <dd className={`font-mono text-sm tnum ${line.tone}`}>
              ₹{line.value}
            </dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-6 pt-4 pb-3">
          <dt className="font-display text-base font-semibold">Net disbursement</dt>
          <dd className="font-mono text-lg font-medium tnum">₹1,13,67,805</dd>
        </div>
      </dl>

      <div className="grid grid-cols-3 border-t border-line">
        {[
          { k: "Period", v: "Mar 2026" },
          { k: "Employees", v: "486" },
          { k: "States", v: "7" },
        ].map((x, i) => (
          <div
            key={x.k}
            className={`px-5 py-3 ${i < 2 ? "border-r border-line" : ""}`}
          >
            <div className="label text-ink-3">{x.k}</div>
            <div className="font-mono text-sm tnum mt-0.5">{x.v}</div>
          </div>
        ))}
      </div>

      <div className="px-5 py-3 border-t border-line bg-surface-2 flex items-center gap-2">
        <span aria-hidden className="h-1.5 w-1.5 bg-teal shrink-0" />
        <span className="text-xs text-ink-2">
          Register, bank file and statutory summaries reconcile to ₹0.00 variance
        </span>
      </div>
    </div>
  );
}

/* ---------- page ---------- */

export default function HomePage() {
  return (
    <>
      {/* HERO */}
      <header className="border-b border-line bg-surface ledger-rule">
        <Container>
          <div className="grid lg:grid-cols-[1.05fr_0.95fr] gap-12 lg:gap-16 items-center py-16 sm:py-20 lg:py-24">
            <div className="flex flex-col gap-6">
              <Eyebrow>HR &amp; payroll software for India</Eyebrow>
              <h1 className="font-display text-4xl sm:text-5xl lg:text-[3.75rem] font-semibold leading-[1.03] tracking-[-0.03em] balance">
                Payroll that closes to the rupee.
              </h1>
              <p className="text-lg sm:text-xl text-ink-2 leading-relaxed pretty max-w-[54ch]">
                Run HR and statutory payroll for 50 to 1,000 people across up to
                five legal entities. EPF, ESIC, professional tax, labour welfare
                fund and TDS — correct in every state you operate in, and
                explainable down to the last rupee.
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button href="/pricing">Book a demo</Button>
                <Button href="/compliance" variant="secondary">
                  Check your states
                </Button>
              </div>
              <p className="text-sm text-ink-3 pretty max-w-[52ch]">
                Live in under fourteen days · No implementation fee · Your data
                stays in India
              </p>
            </div>

            <div className="lg:pl-4">
              <RunSummary />
            </div>
          </div>
        </Container>
      </header>

      {/* STAT STRIP */}
      <div className="border-b border-line bg-paper">
        <Container>
          <dl className="grid grid-cols-2 lg:grid-cols-4">
            {[
              { v: "14", u: "days", l: "To first live payroll" },
              { v: String(PT_COUNT), u: `of ${TOTAL_COUNT}`, l: "PT jurisdictions" },
              { v: String(LWF_COUNT), u: `of ${TOTAL_COUNT}`, l: "LWF jurisdictions" },
              { v: "₹0.00", l: "Reconciliation tolerance" },
            ].map((s, i) => (
              <div
                key={s.l}
                className={`py-6 pr-5 border-line ${
                  i % 2 === 0 ? "border-r" : ""
                } ${i < 2 ? "border-b lg:border-b-0" : ""} ${
                  i === 1 ? "lg:border-r" : ""
                } ${i === 2 ? "lg:border-r" : ""}`}
              >
                <dd className="font-display text-3xl sm:text-4xl font-semibold tnum tracking-[-0.02em]">
                  {s.v}
                  {s.u ? (
                    <span className="font-sans text-sm font-normal text-ink-2 ml-1.5">
                      {s.u}
                    </span>
                  ) : null}
                </dd>
                <dt className="label text-ink-3 mt-1.5">{s.l}</dt>
              </div>
            ))}
          </dl>
        </Container>
      </div>

      {/* THE PROBLEM */}
      <Section bordered={false}>
        <Container>
          <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-10 lg:gap-16">
            <SectionHead
              eyebrow="Why this exists"
              title="Indian payroll fails in the details, not the basics."
            />
            <div className="flex flex-col gap-6">
              <p className="text-lg text-ink-2 leading-relaxed pretty">
                Every platform computes gross minus deductions. The failures happen
                one level down — and they surface as a notice, not a bug report.
              </p>
              <div className="flex flex-col">
                {[
                  {
                    t: "An employee crosses the ESIC wage threshold in November",
                    d: "Coverage continues to the end of the contribution period. Systems that drop them mid-period under-remit for four months.",
                  },
                  {
                    t: "A branch opens in a state with a different PT slab",
                    d: "Applicability follows the work location, and the annual cap differs. Most tools hard-code one state and lose the deal at the second office.",
                  },
                  {
                    t: "February arrives and nobody warned anyone",
                    d: "Unverified investment proofs collapse into a two-month deduction spike. It should have been forecast in January.",
                  },
                  {
                    t: "Someone changes a bank account four days before disbursement",
                    d: "Without segregation of duties and read-level audit logging, nothing catches it until the money has moved.",
                  },
                ].map((row) => (
                  <div key={row.t} className="py-4 border-t border-line">
                    <h3 className="font-display text-base font-semibold mb-1 balance">
                      {row.t}
                    </h3>
                    <p className="text-sm text-ink-2 leading-relaxed pretty">
                      {row.d}
                    </p>
                  </div>
                ))}
              </div>
              <Callout label="Why it matters" tone="brass">
                None of these are edge cases — they happen every year, to
                ordinary companies. Lekha handles each one by default, and shows
                you the working when you ask.
              </Callout>
            </div>
          </div>
        </Container>
      </Section>

      {/* MODULE MAP */}
      <Section>
        <Container>
          <SectionHead
            eyebrow="What&rsquo;s inside"
            title="One employee record, end to end."
            lede="Everything shares one source of truth. Attendance feeds payroll, an exit feeds the final settlement, and every figure carries the settings that produced it."
          />
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-line mt-10 border border-line rounded-lg">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group flex flex-col gap-2 p-6 bg-surface hover:bg-surface-2 transition-colors"
              >
                <h3 className="font-display text-xl font-semibold group-hover:text-indigo transition-colors">
                  {item.label}
                </h3>
                <p className="text-sm text-ink-2 leading-relaxed pretty">
                  {item.blurb}
                </p>
                <span className="label text-ink-3 mt-auto pt-3 group-hover:text-brass transition-colors">
                  Read more →
                </span>
              </Link>
            ))}
            <div className="flex flex-col gap-3 p-6 bg-surface-2">
              <span className="label text-ink-3">Also included</span>
              <ul className="text-sm text-ink-2 flex flex-col gap-1.5">
                <li>Employee &amp; manager self-service</li>
                <li>Approval workflows</li>
                <li>Reports &amp; dashboards</li>
                <li>APIs and webhooks</li>
              </ul>
            </div>
          </div>
        </Container>
      </Section>

      {/* GO LIVE */}
      <Section>
        <Container>
          <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-10 lg:gap-16">
            <SectionHead
              eyebrow="Implementation"
              title="Fourteen days, and the clock starts at signup."
              lede="Time to first payroll is the number we publish and the one we are judged on. It is measured to a finalised run, not to account creation."
            />
            <ol className="flex flex-col">
              {[
                {
                  d: "Days 1–2",
                  t: "Companies and branches",
                  b: "Register each legal entity with its PF, ESIC, PT and LWF numbers. Branches carry their state, which drives applicability from then on.",
                },
                {
                  d: "Days 3–5",
                  t: "Employee import",
                  b: "Bulk import with dry-run validation and a per-row error report — including mid-year YTD earnings, tax deducted and opening leave balances, so you can switch in October without restating April.",
                },
                {
                  d: "Days 6–8",
                  t: "Structures and policies",
                  b: "Salary structures, the proration basis, rounding rules, leave and attendance policies. Defaults are sensible; every convention is explicit.",
                },
                {
                  d: "Days 9–11",
                  t: "Parallel run",
                  b: "Run against last month's actuals and reconcile to your existing output line by line. Any variance is explainable down to the formula and the values substituted.",
                },
                {
                  d: "Days 12–14",
                  t: "Live",
                  b: "Approve, disburse, file. Statutory summaries and bank files generate from the same approved run.",
                },
              ].map((step, i, arr) => (
                <li
                  key={step.t}
                  className={`grid grid-cols-[5.5rem_1fr] gap-x-5 py-5 border-t border-line ${
                    i === arr.length - 1 ? "border-b" : ""
                  }`}
                >
                  <span className="label text-brass pt-1 tnum">{step.d}</span>
                  <div>
                    <h3 className="font-display text-lg font-semibold mb-1">
                      {step.t}
                    </h3>
                    <p className="text-sm text-ink-2 leading-relaxed pretty">
                      {step.b}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </Container>
      </Section>

      {/* DIFFERENTIATORS */}
      <Section>
        <Container>
          <SectionHead
            eyebrow="Where we differ"
            title="Built for the second office, the mid-year switch and the audit."
          />
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-10">
            <FeatureCard code="01" title="Multi-entity from day one">
              Up to five legal entities in one tenant, each with its own
              registrations, payroll calendar, bank accounts and approval chain.
              Not an enterprise upsell.
            </FeatureCard>
            <FeatureCard code="02" title="Statutory rules are data">
              PT slabs, LWF rates, EPF and ESIC parameters and both tax regimes are
              effective-dated configuration. A rate change is a dated update, not a
              release.
            </FeatureCard>
            <FeatureCard code="03" title="Every figure is explainable">
              For any employee and any component we show the formula applied, the
              values substituted, the proration basis and the day count. Disputes
              take two minutes.
            </FeatureCard>
            <FeatureCard code="04" title="Reproducible runs">
              A run stores the configuration versions it used. Recomputing a period
              from two years ago returns exactly what was paid, not what today&rsquo;s
              rules would produce.
            </FeatureCard>
            <FeatureCard code="05" title="Exit is a real module">
              Notice computation, shortfall recovery, multi-department clearance,
              statutory close-out and a settlement that cannot release until
              clearance closes.
            </FeatureCard>
            <FeatureCard code="06" title="Audit as a feature">
              Append-only logs that record reads as well as writes, enforced
              segregation of duties, and a one-click audit pack for any period.
            </FeatureCard>
          </div>
        </Container>
      </Section>

      {/* CTA */}
      <Section>
        <Container>
          <div className="bg-indigo text-on-indigo p-8 sm:p-12 flex flex-col lg:flex-row lg:items-center gap-8 justify-between rounded-lg">
            <div className="max-w-xl flex flex-col gap-3">
              <h2 className="font-display text-3xl sm:text-4xl font-semibold leading-[1.1] tracking-[-0.02em] balance">
                Bring us your hardest month.
              </h2>
              <p className="opacity-80 leading-relaxed pretty">
                A parallel run against your existing payroll is the fastest way to
                judge this. Send one month of real data and we will reconcile it
                line by line.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 shrink-0">
              <Link
                href="/pricing"
                className="inline-flex items-center px-5 py-3 text-sm font-medium bg-paper text-ink hover:bg-surface-2 transition-colors"
              >
                Book a demo
              </Link>
              <Link
                href="/payroll"
                className="inline-flex items-center px-5 py-3 text-sm font-medium border border-white/30 hover:border-white/60 transition-colors rounded-lg"
              >
                How the engine works
              </Link>
            </div>
          </div>
        </Container>
      </Section>
    </>
  );
}
