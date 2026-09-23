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
  title: "Security & audit",
  description:
    "Append-only audit logs that record reads as well as writes, enforced segregation of duties, reproducible runs, and data resident in India.",
};

export default function SecurityPage() {
  return (
    <>
      <PageHero
        code="06 · Security"
        title="Four questions, answerable for every rupee."
        lede="For any amount paid to any employee in any period, the system can say what it was, how it was computed, who authorised it, and what it would have been before the last change — without anyone opening a database."
        stats={[
          { value: "Append", unit: "only", label: "Audit log" },
          { value: "15", unit: "min", label: "Recovery point objective" },
          { value: "4", unit: "hrs", label: "Recovery time objective" },
          { value: "India", label: "Data residency" },
        ]}
      />

      <Section bordered={false}>
        <Container>
          <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-10 lg:gap-16">
            <SectionHead
              eyebrow="Audit"
              title="Logging reads, not just writes."
              lede="Payroll is the highest-value data you hold, and the place where an internal fraud or an honest error costs the most. Auditability here is a functional requirement with acceptance criteria, not a logging concern delegated to infrastructure."
            />
            <div>
              <SpecRow code="AUD-1" title="Immutable audit log">
                Every payroll-relevant change — structures, revisions, component
                definitions, statutory configuration, settings, bank details, tax
                declarations and verifications, loans, adjustments, run
                transitions, approvals, unlocks and payslip regeneration. Each entry
                records actor, role, timestamp, source, the record affected, before
                and after values, and the reason where one is required. No role can
                edit or delete an entry, including tenant administrators.
              </SpecRow>
              <SpecRow code="AUD-6" title="Access logging">
                Reads are logged too — who viewed whose salary, when, and through
                which surface, including exports and API calls. Bulk exports record
                the row count and the filter applied.
              </SpecRow>
              <SpecRow code="AUD-2" title="Configuration versioning">
                Every object that affects a calculation is versioned with an
                effective date. A run stores the configuration versions it used, so
                recomputing a period from two years ago returns exactly what was
                paid — not what today&rsquo;s rules would produce.
              </SpecRow>
              <SpecRow code="AUD-3" title="Run version history">
                Each version retains its full output, and a comparison view diffs
                any two at employee and component level, showing which audit entries
                caused the difference. Superseded payslips stay retrievable, because
                an employee may be holding one.
              </SpecRow>
            </div>
          </div>
        </Container>
      </Section>

      <Section>
        <Container>
          <SectionHead
            eyebrow="Controls"
            title="Separations the system enforces."
            lede="Configurable, but on by default. Attempted violations are blocked and logged rather than warned about."
          />
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-10">
            <FeatureCard code="AUD-4" title="Maker is not checker">
              Whoever prepared a payroll run cannot be its sole approver.
            </FeatureCard>
            <FeatureCard code="AUD-4" title="Bank change cooling window">
              The user who changes a bank account cannot approve the run that pays
              into it within a defined window.
            </FeatureCard>
            <FeatureCard code="AUD-4" title="Create is not approve">
              The user who creates an employee cannot approve their salary
              structure.
            </FeatureCard>
            <FeatureCard code="SET-7" title="Compensation visibility">
              Roles carry an explicit scope — none, own team, own company, all —
              plus a masked mode that shows structure without amounts.
            </FeatureCard>
            <FeatureCard code="AUD-7" title="Auditor role">
              Read-only and scoped per company, so an external auditor sees one
              entity without touching anything.
            </FeatureCard>
            <FeatureCard code="AUD-8" title="Retention &amp; legal hold">
              Deletion honoured only where no statutory retention applies, with a
              legal-hold flag that suspends deletion during a dispute.
            </FeatureCard>
          </div>
        </Container>
      </Section>

      <Section>
        <Container>
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-start">
            <div className="flex flex-col gap-6">
              <SectionHead
                eyebrow="Alerting"
                title="The events worth waking someone for."
                lede="Raised to a control owner independently of the approval chain, because the approval chain is exactly what a bad actor would route around."
              />
              <CheckList
                items={[
                  "A bank account changed within a set number of days before disbursement",
                  "A salary revision above a threshold you define",
                  "A payment released from hold",
                  "A run unlocked after approval",
                  "Statutory configuration edited",
                  "A bulk import touching more than a threshold number of employees",
                  "Any change to compensation data made through the API",
                ]}
              />
              <Callout label="The audit pack" tone="teal">
                One click assembles the payroll register, statutory summaries with
                their remittance references, the approval trail, every exception and
                override with its reason, the variance report, and the configuration
                versions in force. Statutory audit, internal audit and due diligence
                all ask for this set — and assembling it by hand is a week of work.
              </Callout>
            </div>

            <div className="flex flex-col gap-6">
              <SectionHead
                eyebrow="Platform"
                title="The boring guarantees."
              />
              <div className="border border-line bg-surface rounded-lg">
                {[
                  { k: "Data residency", v: "All customer data stored in India." },
                  { k: "Encryption", v: "TLS in transit; encrypted at rest, with compensation and bank fields encrypted separately." },
                  { k: "Testing", v: "OWASP Top 10 coverage and annual penetration testing." },
                  { k: "Availability", v: "99.5% overall, with a stricter expectation during month-end processing windows." },
                  { k: "Recovery", v: "RPO 15 minutes, RTO 4 hours, with point-in-time restore across the statutory retention period — rehearsed, not assumed." },
                  { k: "Durability", v: "Audit writes are synchronous with the change they record. A change that cannot be logged does not commit." },
                  { k: "Correctness", v: "A statutory regression suite runs on every release; a failure blocks it." },
                ].map((row, i) => (
                  <div
                    key={row.k}
                    className={`grid sm:grid-cols-[9rem_1fr] gap-x-4 gap-y-1 p-4 ${
                      i > 0 ? "border-t border-line-2" : ""
                    }`}
                  >
                    <span className="label text-brass pt-0.5">{row.k}</span>
                    <span className="text-sm text-ink-2 leading-relaxed pretty">
                      {row.v}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Container>
      </Section>

      <NextPage href="/pricing" label="Pricing — what it costs" />
    </>
  );
}
