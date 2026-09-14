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
import CoverageMatrix from "@/components/coverage-matrix";
import { PT_COUNT, LWF_COUNT, TOTAL_COUNT } from "@/lib/site";

export const metadata: Metadata = {
  title: "Compliance",
  description:
    "EPF, ESIC, professional tax, labour welfare fund and TDS across all 28 states and 8 union territories — as effective-dated configuration, not hard-coded rules.",
};

export default function CompliancePage() {
  return (
    <>
      <PageHero
        code="05 · Compliance"
        title="Every state you operate in, and the ones you don&rsquo;t yet."
        lede="Statutory rules are data, not code. Slabs, rates, thresholds and frequencies are effective-dated configuration, so a gazette notification becomes a dated update rather than a release you wait for."
        stats={[
          { value: String(TOTAL_COUNT), label: "States & UTs mapped" },
          { value: String(PT_COUNT), label: "Levy professional tax" },
          { value: String(LWF_COUNT), label: "Levy labour welfare fund" },
          { value: "Dated", label: "Every rule versioned" },
        ]}
      />

      {/* MATRIX */}
      <Section bordered={false}>
        <Container>
          <SectionHead
            eyebrow="Coverage"
            title="The whole map, including the blanks."
            lede="A jurisdiction that levies nothing still needs a rule — one that enforces a zero deduction rather than leaving applicability undefined. Both halves of this table are configuration we ship."
          />
          <div className="mt-8">
            <CoverageMatrix />
          </div>
          <div className="mt-8 grid lg:grid-cols-2 gap-6">
            <Callout label="How to read this" tone="indigo">
              Applicability follows the employee&rsquo;s branch state. Open an office in
              a new state and the correct professional tax slab and labour welfare
              fund frequency apply from the month the branch goes live — you
              configure the registration number, not the arithmetic.
            </Callout>
            <Callout label="Where we are still verifying" tone="brass">
              Two entries are flagged pending verification against the state Acts
              themselves rather than a third-party aggregator. We would rather show
              you an open question than a confident wrong answer that under-deducts
              for a year.
            </Callout>
          </div>
        </Container>
      </Section>

      {/* PT & LWF DETAIL */}
      <Section>
        <Container>
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-16">
            <div>
              <SectionHead
                eyebrow="Professional tax"
                title="Slabs, caps and the February problem."
              />
              <div className="mt-8">
                <SpecRow code="PAY-8" title="Calculation">
                  Applicability determined from the branch state, the state-specific
                  slab applied against that state&rsquo;s defined base, and the annual
                  cap enforced — within the constitutional ceiling of ₹2,500 a year,
                  or ₹2,400 in Punjab.
                </SpecRow>
                <SpecRow code="PAY-8" title="Special months">
                  States like Maharashtra deduct a different amount in February. The
                  slab table carries that as data with its own effective dates, so
                  it applies in the right month without a code path.
                </SpecRow>
                <SpecRow code="PAY-9" title="Reporting">
                  Company-wise summary by state and branch showing what to deduct
                  and remit, tied to the compliance calendar item it settles.
                </SpecRow>
              </div>
            </div>

            <div>
              <SectionHead
                eyebrow="Labour welfare fund"
                title="Three frequencies, sixteen jurisdictions."
              />
              <div className="mt-8">
                <SpecRow code="PAY-11" title="Employee and employer share">
                  Both computed at the configured rates. Maharashtra deducts ₹25
                  from the employee and ₹75 from the employer, half-yearly. Haryana
                  is ₹34 and ₹68, monthly. Delhi is ₹0.75 and ₹2.25, half-yearly.
                </SpecRow>
                <SpecRow code="PAY-11" title="Variable frequency">
                  Monthly, half-yearly and annual cycles all supported. A
                  half-yearly cycle makes a mid-period rate change harder to apply
                  than a monthly one, which is why LWF carries the same
                  effective-date versioning as everything else.
                </SpecRow>
                <SpecRow code="EXIT-12" title="At exit">
                  The final deduction has to land on the correct side of the
                  contribution period. The exit process checks this rather than
                  leaving it to whoever runs the settlement.
                </SpecRow>
              </div>
            </div>
          </div>
        </Container>
      </Section>

      {/* EPF ESIC */}
      <Section>
        <Container>
          <SectionHead
            eyebrow="Central statutes"
            title="EPF and ESIC, including the rules people get wrong."
          />
          <div className="grid lg:grid-cols-2 gap-10 mt-10">
            <div>
              <SpecRow code="STAT-1" title="EPF computation">
                Employee and employer shares on your configured wage base, with the
                employer share split between pension and provident fund under its
                own ceiling. Handles the wage-ceiling-versus-actual-basic choice,
                voluntary provident fund at an employee-declared rate, the
                excluded-employee case for a new joiner above the ceiling with no
                prior membership, and international workers, for whom the ceiling
                does not apply.
              </SpecRow>
              <SpecRow code="STAT-2" title="ECR file">
                Electronic challan-cum-return in the format the EPFO portal accepts
                — joiners, leavers with date and reason of exit, non-contributory
                period days, and admin and insurance charges, with a reconciliation
                summary against the payroll register.
              </SpecRow>
            </div>
            <div>
              <SpecRow code="STAT-3" title="ESIC contribution periods">
                An employee covered at the start of a contribution period — April to
                September, October to March — stays covered until that period ends
                even if wages later cross the threshold. An employee crossing
                mid-period continues contributing on actual wages until period end.
                Coverage also depends on the branch sitting in an implemented area.
                This is a named acceptance criterion with its own regression test,
                because it is the most common India-payroll defect there is.
              </SpecRow>
              <SpecRow code="STAT-4" title="ESIC returns">
                Monthly contribution file in the portal&rsquo;s format, the half-yearly
                return summary, IP number mapping, and a report of employees still
                awaiting IP allocation.
              </SpecRow>
            </div>
          </div>
        </Container>
      </Section>

      {/* TAX */}
      <Section>
        <Container>
          <div className="grid lg:grid-cols-[1fr_1fr] gap-10 lg:gap-16 items-start">
            <div className="flex flex-col gap-6">
              <SectionHead
                eyebrow="Income tax"
                title="TDS as a module, not a summary line."
                lede="You cannot go live on payroll without this, so it is specified as a full sub-module rather than a report."
              />
              <CheckList
                items={[
                  "Regime election per employee per financial year, with a side-by-side comparison from their own declarations",
                  "Investment declarations across 80C, 80D, 80CCD(1B) and (2), 80E, 80G, 80TTA/TTB and section 24(b)",
                  "HRA exemption from declared rent, city classification and landlord PAN where required",
                  "Proof window with a verification queue — approve, partially approve with an amount, or reject",
                  "Previous employer income from Form 12B or Form 16, so mid-year joiners are not under-deducted",
                  "Perquisites — company car, accommodation, concessional loans, employer PF excess and ESOP at exercise",
                  "Monthly projection that recomputes on every event and spreads the balance across remaining months",
                  "Form 24Q with Annexure I and II, challan mapping, and Form 16 Part B merged with Part A",
                ]}
              />
            </div>
            <div className="flex flex-col gap-5">
              <FeatureCard code="TAX-4" title="The February spike, forecast in January">
                When the proof window closes, unverified declarations drop from the
                projection and the shortfall recovers across remaining months. We
                show that coming in January rather than revealing it in February.
              </FeatureCard>
              <FeatureCard code="TAX-8" title="The employee tax worksheet">
                Gross, exemptions, deductions verified and pending, taxable income,
                tax computed, deducted to date, and the projected monthly figure for
                the rest of the year. One screen that removes the largest category
                of payroll support tickets.
              </FeatureCard>
              <FeatureCard code="TAX-10" title="PAN validation">
                Format-checked on capture and verified against the tax database
                where an API is configured. A missing or invalid PAN triggers the
                higher deduction rate and a prominent flag, because that liability
                lands on you, not the employee.
              </FeatureCard>
            </div>
          </div>
        </Container>
      </Section>

      {/* CALENDAR */}
      <Section>
        <Container>
          <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-10 lg:gap-16">
            <SectionHead
              eyebrow="Compliance calendar"
              title="Multi-state compliance as a work queue."
              lede="The applicable set is derived from your registrations and your branches&rsquo; states — so the calendar changes by itself when you open an office, rather than depending on someone remembering."
            />
            <div className="flex flex-col gap-5">
              <div className="border border-line bg-surface">
                {[
                  { d: "By the 15th", t: "EPF remittance and ECR filing" },
                  { d: "By the 15th", t: "ESIC contribution payment" },
                  { d: "By the 7th", t: "TDS deposit for the previous month" },
                  { d: "Quarterly", t: "Form 24Q return, with Annexure II in Q4" },
                  { d: "State-wise", t: "Professional tax returns on each state's own cycle" },
                  { d: "State-wise", t: "Labour welfare fund, monthly to annual by state" },
                ].map((row, i) => (
                  <div
                    key={row.t}
                    className={`grid grid-cols-[6.5rem_1fr] gap-4 px-4 py-3 ${
                      i > 0 ? "border-t border-line-2" : ""
                    }`}
                  >
                    <span className="label text-brass">{row.d}</span>
                    <span className="text-sm text-ink-2 leading-relaxed">{row.t}</span>
                  </div>
                ))}
              </div>
              <p className="text-sm text-ink-3 pretty">
                Each item tracks status, owner and the filing reference once lodged.
                Registers for inspection — wage, attendance, employee, leave and
                bonus, plus the Shops and Establishments forms for your states —
                generate from the same data.
              </p>
            </div>
          </div>
        </Container>
      </Section>

      <NextPage href="/security" label="Security — audit, controls and residency" />
    </>
  );
}
