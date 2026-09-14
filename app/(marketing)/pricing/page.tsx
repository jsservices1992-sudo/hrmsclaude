import type { Metadata } from "next";
import Link from "next/link";
import {
  Container,
  Section,
  SectionHead,
  PageHero,
  Callout,
  CheckList,
} from "@/components/ui";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Transparent per-employee pricing. Every compliance feature is in the base plan — nothing statutory is held back for enterprise.",
};

const PLANS = [
  {
    name: "Core",
    price: "₹65",
    unit: "per employee / month",
    min: "Minimum 50 employees",
    blurb: "HR, attendance and leave for a single legal entity.",
    features: [
      "Employee master with custom fields",
      "Attendance — web, mobile, geofence and biometric",
      "Leave with accrual, carry-forward and encashment",
      "Employee and manager self-service",
      "No-code workflow engine",
      "Onboarding and exit lifecycle",
      "Standard reports and dashboards",
      "One legal entity, unlimited branches",
    ],
    cta: "Start here",
    featured: false,
  },
  {
    name: "Payroll",
    price: "₹115",
    unit: "per employee / month",
    min: "Minimum 50 employees",
    blurb: "Everything in Core, plus the full statutory payroll engine.",
    features: [
      "Payroll engine with your proration and rounding conventions",
      "EPF, ESIC, PT and LWF across all 36 states and UTs",
      "Income tax and TDS — both regimes, Form 24Q and Form 16",
      "Flexible benefits, reimbursement claims and LTA",
      "Loans, advances and the recovery register",
      "Arrears and retrospective recalculation",
      "Bank files, GL export and Tally integration",
      "Full-and-final settlement",
      "Up to 5 legal entities",
    ],
    cta: "Book a demo",
    featured: true,
  },
  {
    name: "Governed",
    price: "₹165",
    unit: "per employee / month",
    min: "Minimum 200 employees",
    blurb: "Everything in Payroll, plus the controls an audit committee asks for.",
    features: [
      "Enforced segregation of duties",
      "Read-level access logging on compensation",
      "Sensitive-change alerting to a control owner",
      "Read-only auditor role, scoped per entity",
      "One-click audit pack for any period",
      "Legal hold and retention policy management",
      "SSO with SAML or OIDC",
      "Priority support with a named contact",
    ],
    cta: "Talk to us",
    featured: false,
  },
];

export default function PricingPage() {
  return (
    <>
      <PageHero
        code="07 · Pricing"
        title="Compliance is not an upsell."
        lede="Every statutory feature sits in the payroll plan. We do not gate professional tax behind an enterprise tier or charge per state, because a company with offices in three states is our ordinary customer, not an edge case."
      />

      <Section bordered={false}>
        <Container>
          <div className="grid lg:grid-cols-3 gap-5">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`flex flex-col border bg-surface ${
                  plan.featured
                    ? "border-indigo border-2 shadow-[0_0_0_4px_var(--indigo-soft)]"
                    : "border-line"
                }`}
              >
                <div className="p-6 border-b border-line">
                  <div className="flex items-baseline justify-between gap-3 mb-3">
                    <h2 className="font-display text-2xl font-semibold">
                      {plan.name}
                    </h2>
                    {plan.featured ? (
                      <span className="label px-2 py-1 bg-indigo text-on-indigo shrink-0">
                        Most chosen
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm text-ink-2 leading-relaxed pretty mb-5 min-h-[2.75rem]">
                    {plan.blurb}
                  </p>
                  <div className="flex items-baseline gap-2">
                    <span className="font-display text-4xl font-semibold tnum tracking-[-0.02em]">
                      {plan.price}
                    </span>
                    <span className="text-sm text-ink-2">{plan.unit}</span>
                  </div>
                  <p className="label text-ink-3 mt-2">{plan.min}</p>
                </div>

                <div className="p-6 flex-1">
                  <CheckList items={plan.features} />
                </div>

                <div className="p-6 pt-0">
                  <Link
                    href="/pricing"
                    className={`w-full inline-flex items-center justify-center px-5 py-3 text-sm font-medium transition-colors ${
                      plan.featured
                        ? "bg-indigo text-on-indigo border border-indigo hover:bg-indigo-2"
                        : "border border-line bg-surface text-ink hover:border-ink-3 hover:bg-surface-2"
                    }`}
                  >
                    {plan.cta}
                  </Link>
                </div>
              </div>
            ))}
          </div>

          <p className="label text-ink-3 mt-6 text-center">
            Prices exclude GST · Billed annually · Minimum commitments apply
          </p>
        </Container>
      </Section>

      <Section>
        <Container>
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-16">
            <div className="flex flex-col gap-6">
              <SectionHead
                eyebrow="What is never extra"
                title="Included at every tier."
              />
              <CheckList
                items={[
                  "Implementation — no setup fee, no mandatory consultant",
                  "Data migration, including mid-year year-to-date figures",
                  "Every state's professional tax and labour welfare fund rules",
                  "Statutory rate updates when the law changes",
                  "Payslip, letter and report templates",
                  "REST and GraphQL API access with webhooks",
                  "Unlimited branches, departments and workflow definitions",
                ]}
              />
            </div>
            <div className="flex flex-col gap-6">
              <SectionHead
                eyebrow="How to evaluate this"
                title="Ask for a parallel run."
                lede="Demos are easy to pass. A parallel run against a real month of your own payroll is not."
              />
              <Callout label="What we propose" tone="brass">
                Send one month of real data. We configure your structures and
                conventions, run it alongside your existing payroll, and reconcile
                line by line. Any variance gets explained down to the formula and
                the values substituted — or we fix it before you sign anything.
              </Callout>
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/payroll"
                  className="inline-flex items-center px-5 py-3 text-sm font-medium bg-indigo text-on-indigo border border-indigo hover:bg-indigo-2 transition-colors"
                >
                  How the engine works
                </Link>
                <Link
                  href="/compliance"
                  className="inline-flex items-center px-5 py-3 text-sm font-medium border border-line bg-surface hover:border-ink-3 transition-colors"
                >
                  Check your states
                </Link>
              </div>
            </div>
          </div>
        </Container>
      </Section>

      <Section>
        <Container>
          <SectionHead
            eyebrow="Questions we get"
            title="The awkward ones, answered."
          />
          <div className="mt-10 max-w-[70ch]">
            {[
              {
                q: "What happens when a state changes its professional tax slab?",
                a: "We update the effective-dated configuration and it applies from the correct month, including retrospectively if the notification is backdated. You do not wait for a release, and you are notified that a rate you depend on has changed.",
              },
              {
                q: "Can we switch mid-financial-year?",
                a: "Yes — that is the normal case, and the importer is built for it. It takes year-to-date earnings, tax deducted, leave balances and loan balances, so the annual tax projection is right from your first run rather than restating the year.",
              },
              {
                q: "Who is accountable if a calculation is wrong?",
                a: "We are, for the arithmetic and the statutory rules as configured. The audit trail exists partly so that when something is wrong, it takes minutes to establish what happened rather than weeks. Statutory filing itself remains yours.",
              },
              {
                q: "What if we outgrow five legal entities?",
                a: "Talk to us before you sign. Five is the tested ceiling for the current architecture, not a commercial limit, and we would rather tell you that now than after implementation.",
              },
              {
                q: "Is there a free trial?",
                a: "No. A trial on synthetic data would tell you nothing useful about payroll. The parallel run is the trial, and it does not cost you anything.",
              },
            ].map((item) => (
              <div key={item.q} className="py-5 border-t border-line">
                <h3 className="font-display text-lg font-semibold mb-2 balance">
                  {item.q}
                </h3>
                <p className="text-ink-2 leading-relaxed pretty">{item.a}</p>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      <Section>
        <Container>
          <div className="bg-indigo text-on-indigo p-8 sm:p-12 flex flex-col lg:flex-row lg:items-center gap-8 justify-between">
            <div className="max-w-xl flex flex-col gap-3">
              <h2 className="font-display text-3xl sm:text-4xl font-semibold leading-[1.1] tracking-[-0.02em] balance">
                One month of real data.
              </h2>
              <p className="opacity-80 leading-relaxed pretty">
                That is all we need to show you whether this works. Reconciled line
                by line, with every variance explained.
              </p>
            </div>
            <Link
              href="/"
              className="inline-flex items-center px-5 py-3 text-sm font-medium bg-paper text-ink hover:bg-surface-2 transition-colors shrink-0"
            >
              Book a demo
            </Link>
          </div>
        </Container>
      </Section>
    </>
  );
}
