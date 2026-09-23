import Link from "next/link";
import {
  Container,
  Section,
  SectionHead,
  Eyebrow,
  Button,
  FeatureCard,
} from "@/components/ui";
import { NAV, PT_COUNT, LWF_COUNT, TOTAL_COUNT } from "@/lib/site";

/* ---------- the product, drawn as it looks ---------- */

const STEPS = [
  { t: "People & salary", d: "486 active, all with salary and bank details", s: "done" },
  { t: "Attendance & leave", d: "11.5 unpaid days across 6 people", s: "done" },
  { t: "Incentives & deductions", d: "38 entries · ₹4,12,500 net", s: "done" },
  { t: "Calculate", d: "Version 2 · 486 employees", s: "done" },
  { t: "Review findings", d: "Nothing blocking", s: "next" },
  { t: "Approve & pay", d: "Bank file and challans from the same run", s: "todo" },
] as const;

function ProductWindow() {
  return (
    <div className="relative mx-auto w-full max-w-5xl">
      <div
        aria-hidden
        className="absolute -inset-x-10 -top-10 -bottom-6 -z-10 rounded-[2.5rem] bg-[radial-gradient(60%_60%_at_50%_30%,color-mix(in_srgb,var(--indigo)_18%,transparent),transparent_70%)]"
      />
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_40px_80px_-30px_rgba(16,38,94,0.35)]">
        {/* window chrome */}
        <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-rust/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-teal/60" />
          <span className="mx-auto hidden rounded-md bg-surface px-3 py-0.5 text-[11px] text-ink-3 sm:block">
            app.lekha.in/console/payroll/run
          </span>
        </div>
        <div className="grid md:grid-cols-[12.5rem_1fr]">
          {/* sidebar */}
          <aside className="hidden border-r border-line bg-surface p-3 md:block">
            <div className="flex items-center gap-2 px-2 py-1.5">
              <span className="grid h-6 w-6 place-items-center rounded-md bg-indigo text-xs font-bold text-on-indigo">ल</span>
              <span className="text-sm font-bold">Lekha</span>
            </div>
            <div className="mt-3 rounded-lg border border-line px-2 py-1.5">
              <p className="truncate text-xs font-semibold">Example Industries</p>
              <p className="text-[10px] text-ink-3">3 companies</p>
            </div>
            <ul className="mt-3 flex flex-col gap-0.5 text-[13px]">
              {["Home", "People", "Attendance", "Payroll", "Compliance", "Reports", "Settings"].map((n) => (
                <li
                  key={n}
                  className={`rounded-md px-2 py-1.5 ${n === "Payroll" ? "font-semibold text-ink" : "text-ink-2"}`}
                >
                  {n}
                  {n === "Payroll" && (
                    <ul className="mt-1 ml-1 border-l border-line pl-2 text-xs font-normal">
                      <li className="rounded bg-indigo-soft px-1.5 py-1 font-semibold text-indigo">Run payroll</li>
                      <li className="px-1.5 py-1 text-ink-2">Bank & accounting</li>
                      <li className="px-1.5 py-1 text-ink-2">Income tax & TDS</li>
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </aside>
          {/* page */}
          <div className="bg-paper p-4 text-left sm:p-6">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-lg font-bold tracking-tight">Run payroll</p>
                <p className="text-xs text-ink-3">Everything between attendance and payslips, in order</p>
              </div>
              <span className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-semibold">‹ March 2026 ›</span>
            </div>
            <div className="mt-4 grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-[1.3fr_1fr]">
              <div>
                <p className="text-xs text-ink-3">March 2026</p>
                <p className="mt-0.5 text-base font-bold">Next: Review findings</p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3">
                  <div className="h-full w-[66%] rounded-full bg-indigo" />
                </div>
                <p className="mt-1.5 text-[11px] text-ink-3">4 of 6 steps done</p>
              </div>
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line-2 text-left">
                {[
                  ["Net to pay", "₹1,13,67,805"],
                  ["Employees", "486"],
                  ["Blocking", "0"],
                  ["Variance", "₹0.00"],
                ].map(([k, v]) => (
                  <div key={k} className="bg-surface px-3 py-2">
                    <dt className="text-[10px] text-ink-3">{k}</dt>
                    <dd className="text-sm font-bold tnum">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <ol className="mt-3 overflow-hidden rounded-xl border border-line bg-surface">
              {STEPS.map((st, i) => (
                <li
                  key={st.t}
                  className={`flex items-center gap-3 px-4 py-2.5 ${i < STEPS.length - 1 ? "border-b border-line-2" : ""} ${
                    st.s === "next" ? "bg-indigo-soft/50" : ""
                  }`}
                >
                  <span
                    className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
                      st.s === "done"
                        ? "bg-teal text-on-indigo"
                        : st.s === "next"
                          ? "bg-indigo text-on-indigo"
                          : "border-2 border-line text-ink-3"
                    }`}
                  >
                    {st.s === "done" ? "✓" : i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{st.t}</span>
                    <span className="block truncate text-[11px] text-ink-3">{st.d}</span>
                  </span>
                  {st.s === "next" && (
                    <span className="rounded-md bg-indigo px-2 py-1 text-[11px] font-semibold text-on-indigo">Open findings</span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- icons for the modules ---------- */

const MODULE_ICON: Record<string, string> = {
  "/platform": "M7.5 7a2.5 2.5 0 1 0 0-.01M2.5 16c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5M13 5.2a2.5 2.5 0 0 1 0 4.6M14.5 15.8c0-1.6-.5-3-1.4-4",
  "/lifecycle": "M4 10h9M10 6l4 4-4 4M16 4v12",
  "/attendance": "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0 3v4l2.5 2",
  "/payroll": "M3 6h14v9H3zM3 9h14M6 12.5h3",
  "/security": "M10 2.5 16 5v5c0 3.6-2.5 6.3-6 7.5-3.5-1.2-6-3.9-6-7.5V5l6-2.5Z",
  "/compliance": "M5 3h7l3 3v11H5zM8 9h5M8 12h5M8 6h2",
  "/pricing": "M3 10.5 10.5 3H17v6.5L9.5 17 3 10.5ZM13.5 6.5h.01",
};

/* ---------- page ---------- */

export default function HomePage() {
  return (
    <>
      {/* HERO */}
      <header className="relative overflow-hidden bg-surface">
        <div aria-hidden className="absolute inset-0 bg-glow" />
        <div aria-hidden className="absolute inset-0 bg-grid opacity-70" />
        <Container className="relative">
          <div className="flex flex-col items-center gap-6 pt-16 pb-14 text-center sm:pt-24">
            <Link
              href="/payroll"
              className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-1.5 py-1 pr-3 text-xs font-semibold text-ink-2 shadow-sm transition-base hover:border-indigo/30"
            >
              <span className="rounded-full bg-indigo px-2 py-0.5 text-on-indigo">New</span>
              The whole payroll month on one screen <span aria-hidden>→</span>
            </Link>
            <h1 className="max-w-[16ch] text-[2.6rem] font-extrabold leading-[1.02] tracking-[-0.04em] text-ink balance sm:text-6xl lg:text-[4.5rem]">
              Payroll that closes <span className="text-indigo">to the rupee.</span>
            </h1>
            <p className="max-w-[58ch] text-lg text-ink-2 leading-relaxed pretty sm:text-xl">
              HR and statutory payroll for Indian companies of 50 to 1,000 people. EPF, ESIC,
              professional tax, LWF and TDS — right in every state, and explainable down to the last
              rupee.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button href="/pricing">Book a demo</Button>
              <Button href="/compliance" variant="secondary">
                Check your states
              </Button>
            </div>
            <ul className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-ink-2">
              {["Live in 14 days", "No implementation fee", "Data stays in India"].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <span aria-hidden className="grid h-4 w-4 place-items-center rounded-full bg-teal-soft text-[9px] font-bold text-teal">
                    ✓
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="pb-20 sm:pb-24">
            <ProductWindow />
          </div>
        </Container>
      </header>

      {/* NUMBERS */}
      <section className="border-y border-line/70 bg-paper py-12">
        <Container>
          <dl className="grid grid-cols-2 gap-6 lg:grid-cols-4">
            {[
              { v: "14", u: "days", l: "To your first live payroll" },
              { v: String(PT_COUNT), u: `of ${TOTAL_COUNT}`, l: "Professional tax jurisdictions" },
              { v: String(LWF_COUNT), u: `of ${TOTAL_COUNT}`, l: "Labour welfare fund jurisdictions" },
              { v: "₹0.00", l: "Reconciliation tolerance" },
            ].map((s) => (
              <div key={s.l} className="text-center lg:text-left">
                <dd className="text-4xl font-extrabold tracking-[-0.03em] text-ink tnum">
                  {s.v}
                  {s.u ? <span className="ml-1.5 text-base font-medium text-ink-3">{s.u}</span> : null}
                </dd>
                <dt className="mt-1 text-sm text-ink-2">{s.l}</dt>
              </div>
            ))}
          </dl>
        </Container>
      </section>

      {/* THE PROBLEM */}
      <Section bordered={false}>
        <Container>
          <SectionHead
            align="center"
            eyebrow="Why this exists"
            title="Indian payroll fails in the details, not the basics."
            lede="Every tool can do gross minus deductions. The failures are one level down — and they arrive as a notice, not a bug report."
          />
          <div className="mt-14 grid gap-4 sm:grid-cols-2">
            {[
              {
                t: "Someone crosses the ESIC threshold in November",
                d: "Coverage runs to the end of the contribution period. Tools that drop them mid-period under-remit for four months.",
              },
              {
                t: "A branch opens in a state with a different PT slab",
                d: "Applicability follows the work location, and the annual cap differs. Most tools hard-code one state.",
              },
              {
                t: "February arrives and nobody warned anyone",
                d: "Unverified proofs collapse into a two-month tax spike. It should have been forecast in January.",
              },
              {
                t: "A bank account changes four days before payday",
                d: "Without segregation of duties and read-level audit logs, nothing catches it until the money has moved.",
              },
            ].map((row, i) => (
              <div key={row.t} className="flex gap-4 rounded-2xl border border-line bg-surface p-6">
                <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-rust-soft text-sm font-bold text-rust">
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-base font-bold tracking-tight text-ink balance">{row.t}</h3>
                  <p className="mt-1 text-sm text-ink-2 leading-relaxed pretty">{row.d}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mx-auto mt-8 max-w-[60ch] text-center text-ink-2">
            None of these are edge cases. Lekha handles each one by default —{" "}
            <span className="font-semibold text-ink">and shows you the working when you ask.</span>
          </p>
        </Container>
      </Section>

      {/* MODULES */}
      <Section tinted>
        <Container>
          <SectionHead
            eyebrow="What’s inside"
            title="One employee record, end to end."
            lede="Attendance feeds payroll, an exit feeds the final settlement, and every figure carries the settings that produced it."
          />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group flex flex-col gap-3 rounded-2xl border border-line bg-surface p-6 transition-base hover:-translate-y-0.5 hover:border-indigo/30 hover:shadow-md"
              >
                <span aria-hidden className="grid h-11 w-11 place-items-center rounded-xl bg-indigo-soft text-indigo transition-base group-hover:bg-indigo group-hover:text-on-indigo">
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                    <path d={MODULE_ICON[item.href] ?? "M4 10h12"} />
                  </svg>
                </span>
                <h3 className="text-lg font-bold tracking-tight text-ink">{item.label}</h3>
                <p className="text-sm text-ink-2 leading-relaxed pretty">{item.blurb}</p>
                <span className="mt-auto pt-2 text-sm font-semibold text-indigo">
                  Learn more <span aria-hidden className="inline-block transition-base group-hover:translate-x-1">→</span>
                </span>
              </Link>
            ))}
            <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-line bg-surface/60 p-6">
              <p className="text-sm font-bold text-ink">Also included</p>
              <ul className="flex flex-col gap-2 text-sm text-ink-2">
                {["Employee & manager self-service", "Approval workflows", "Reports & dashboards", "APIs and webhooks"].map((x) => (
                  <li key={x} className="flex items-center gap-2">
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-indigo" />
                    {x}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Container>
      </Section>

      {/* GO LIVE */}
      <Section>
        <Container>
          <SectionHead
            align="center"
            eyebrow="Implementation"
            title="Fourteen days, and the clock starts at signup."
            lede="Time to first payroll is the number we publish and the one we are judged on — measured to a finalised run."
          />
          <ol className="mt-14 grid gap-4 md:grid-cols-5">
            {[
              { d: "Days 1–2", t: "Companies & branches", b: "Each entity with its PF, ESIC, PT and LWF numbers. Branches carry their state." },
              { d: "Days 3–5", t: "Employee import", b: "Dry-run validation with a per-row report — mid-year YTD and opening balances too." },
              { d: "Days 6–8", t: "Structures & policies", b: "Salary structures, proration, rounding, leave. Sensible defaults, every rule explicit." },
              { d: "Days 9–11", t: "Parallel run", b: "Reconcile last month line by line. Any variance explained to the formula." },
              { d: "Days 12–14", t: "Live", b: "Approve, disburse, file — bank file and challans from the same run." },
            ].map((step, i) => (
              <li key={step.t} className="relative flex flex-col gap-2 rounded-2xl border border-line bg-surface p-5">
                <span className="flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-indigo text-xs font-bold text-on-indigo">{i + 1}</span>
                  <span className="text-xs font-semibold text-indigo">{step.d}</span>
                </span>
                <h3 className="mt-1 text-base font-bold tracking-tight text-ink">{step.t}</h3>
                <p className="text-sm text-ink-2 leading-relaxed pretty">{step.b}</p>
              </li>
            ))}
          </ol>
        </Container>
      </Section>

      {/* DIFFERENTIATORS */}
      <Section tinted>
        <Container>
          <SectionHead
            eyebrow="Where we differ"
            title="Built for the second office, the mid-year switch and the audit."
          />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard code="01" title="Multi-entity from day one">
              Up to five legal entities in one account, each with its own registrations, calendar,
              bank accounts and approvals. Not an enterprise upsell.
            </FeatureCard>
            <FeatureCard code="02" title="Statutory rules are data">
              PT slabs, LWF rates, EPF and ESIC parameters and both tax regimes are effective-dated.
              A rate change is a dated update, not a release.
            </FeatureCard>
            <FeatureCard code="03" title="Every figure is explainable">
              For any person and any component: the formula, the values, the proration basis and the
              day count. Disputes take two minutes.
            </FeatureCard>
            <FeatureCard code="04" title="Reproducible runs">
              A run keeps the rule versions it used. Recomputing a month from two years ago returns
              exactly what was paid.
            </FeatureCard>
            <FeatureCard code="05" title="Exit is a real module">
              Notice, shortfall recovery, multi-department clearance and a settlement that cannot
              release until clearance closes.
            </FeatureCard>
            <FeatureCard code="06" title="Audit as a feature">
              Append-only logs that record reads as well as writes, enforced segregation of duties,
              and a one-click audit pack.
            </FeatureCard>
          </div>
        </Container>
      </Section>

      {/* CTA */}
      <section className="bg-surface py-20 sm:py-24">
        <Container>
          <div className="relative overflow-hidden rounded-3xl bg-indigo px-6 py-14 text-center text-on-indigo sm:px-12">
            <div
              aria-hidden
              className="absolute inset-0 bg-[radial-gradient(50%_80%_at_85%_0%,color-mix(in_srgb,var(--brass)_60%,transparent),transparent_70%)]"
            />
            <div className="relative mx-auto flex max-w-2xl flex-col items-center gap-4">
              <Eyebrow tone="muted">Parallel run</Eyebrow>
              <h2 className="text-3xl font-extrabold leading-[1.1] tracking-[-0.03em] balance sm:text-5xl">
                Bring us your hardest month.
              </h2>
              <p className="text-lg opacity-85 leading-relaxed pretty">
                Send one month of real data and we will reconcile it against your current payroll, line
                by line.
              </p>
              <div className="mt-2 flex flex-wrap justify-center gap-3">
                <Link
                  href="/pricing"
                  className="inline-flex items-center rounded-xl bg-surface px-5 py-3 text-sm font-semibold text-ink transition-base hover:-translate-y-px"
                >
                  Book a demo
                </Link>
                <Link
                  href="/payroll"
                  className="inline-flex items-center rounded-xl border border-white/30 px-5 py-3 text-sm font-semibold transition-base hover:border-white/60"
                >
                  How the engine works
                </Link>
              </div>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
