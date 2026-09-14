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
  title: "Platform",
  description:
    "One employee record across every legal entity — plus custom fields, org structure, document management and a no-code workflow engine.",
};

export default function PlatformPage() {
  return (
    <>
      <PageHero
        code="01 · Platform"
        title="One record, every entity."
        lede="A single employee master across all your companies and branches, with a schema you can extend, an audit trail on everything sensitive, and a workflow engine that automates the processes around it."
        stats={[
          { value: "5", unit: "entities", label: "Per tenant" },
          { value: "36", unit: "jurisdictions", label: "State-aware" },
          { value: "∞", label: "Custom fields" },
          { value: "100%", label: "Field-level audit" },
        ]}
      />

      <Section bordered={false}>
        <Container>
          <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-10 lg:gap-16">
            <SectionHead
              eyebrow="Employee master"
              title="The single source of truth."
              lede="Everything downstream — attendance, payroll, statutory applicability, settlement — reads from here. Change it once and it propagates with an effective date."
            />
            <div>
              <SpecRow code="HRIS-1" title="Employee profile">
                Personal, employment, payroll and contact data, with every employee
                linked to a company, a primary branch, a department, a grade and a
                reporting manager. That mapping is what drives professional tax,
                labour welfare fund and payroll-run membership.
              </SpecRow>
              <SpecRow code="HRIS-2" title="Custom fields">
                Define your own fields with types and validation. They appear in
                profiles, reports and workflow conditions immediately — no
                engineering ticket, no schema migration.
              </SpecRow>
              <SpecRow code="HRIS-3" title="Org structure &amp; chart">
                Department and location hierarchies, with reporting relationships
                generating the org chart automatically. Changing a manager rewires
                every approval chain that depends on it.
              </SpecRow>
              <SpecRow code="HRIS-4" title="Document management">
                Employee documents with expiry tracking and role-based access.
                Expiring documents raise tasks rather than sitting silently until
                someone notices.
              </SpecRow>
              <SpecRow code="HRIS-5" title="Field-level audit trail">
                Change history on everything sensitive — role, salary, bank details,
                statutory identifiers — recording who, when, from what, to what, and
                through which surface.
              </SpecRow>
            </div>
          </div>
        </Container>
      </Section>

      <Section>
        <Container>
          <SectionHead
            eyebrow="Multi-company"
            title="The second office should not be a migration."
            lede="Most platforms in this segment model one company and bolt on the rest. Lekha treats multiple legal entities as the normal case, because a group of 400 people across three entities is our median customer."
          />
          <div className="grid lg:grid-cols-2 gap-10 mt-10">
            <div>
              <SpecRow code="MC-1" title="Company master">
                Each legal entity carries its own PAN, TAN, PF establishment code,
                ESIC code, state-wise PT registrations and LWF registrations. One
                can be flagged default so a single-entity customer never sees the
                complexity.
              </SpecRow>
              <SpecRow code="MC-2" title="Branch &amp; location master">
                Branches carry a state or UT code, which derives PT and LWF
                applicability from the statutory tables — overridable by an admin
                when a law changes before we ship the update.
              </SpecRow>
            </div>
            <div>
              <SpecRow code="MC-3" title="Employee mapping">
                Every employee belongs to exactly one company and one primary
                branch. That single relationship drives statutory applicability,
                payroll membership and reporting scope.
              </SpecRow>
              <SpecRow code="MC-4" title="Company-level runs">
                A payroll run is always scoped to one company and one period. Run
                each entity separately, produce company-wise bank files and
                statutory returns, and consolidate for reporting.
              </SpecRow>
            </div>
          </div>

          <div className="mt-10">
            <Callout label="Permissions follow entities" tone="indigo">
              Roles are scoped per company, and compensation carries its own
              visibility scope on top. One entity&rsquo;s HR team can be fully blind to
              another&rsquo;s payroll — and every unmasked view of someone else&rsquo;s salary
              is logged as an access event, not merely permitted.
            </Callout>
          </div>
        </Container>
      </Section>

      <Section>
        <Container>
          <div className="grid lg:grid-cols-[1fr_1fr] gap-10 lg:gap-16 items-start">
            <div className="flex flex-col gap-6">
              <SectionHead
                eyebrow="Workflow engine"
                title="No-code, and load-bearing."
                lede="The workflow builder is not a notifications add-on. It is the engine that runs onboarding, exit, clearance, confirmation and every approval in the product — which means it has to be good enough for us to build on."
              />
              <CheckList
                items={[
                  "Visual builder with triggers, conditional branching, forms and parallel approval paths",
                  "Actions that write back to the employee record, raise tasks or call a webhook",
                  "Templates per company, department or employment type",
                  "Full execution logs — what fired, when, on whose action, and what it changed",
                  "SLA tracking per step, with escalation when a step goes overdue",
                ]}
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-5">
              <FeatureCard title="Onboarding">
                Document collection, statutory declarations, provisioning fan-out
                and induction, running as one instance per joiner.
              </FeatureCard>
              <FeatureCard title="Exit &amp; clearance">
                Manager, IT, admin, finance and HR clearance in parallel, gating
                settlement release.
              </FeatureCard>
              <FeatureCard title="Confirmation">
                Raised before probation ends, with confirm, extend, terminate or
                convert as outcomes.
              </FeatureCard>
              <FeatureCard title="Salary change">
                Approval chain with the before-and-after break-up, feeding arrears
                automatically when back-dated.
              </FeatureCard>
            </div>
          </div>
        </Container>
      </Section>

      <Section>
        <Container>
          <SectionHead
            eyebrow="Self-service"
            title="Most people should never need to ask HR."
          />
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-10">
            <FeatureCard code="Employee" title="What they get">
              Profile, attendance, leave balance and applications, payslips and
              year-to-date figures, tax worksheet and declarations, reimbursement
              claims, loan balances, and every document ever issued to them.
            </FeatureCard>
            <FeatureCard code="Manager" title="What they get">
              Team attendance and regularisation, leave approvals with coverage
              visibility, confirmation and exit sign-offs, and compensation
              visibility only where you enable it.
            </FeatureCard>
            <FeatureCard code="Admin" title="What they get">
              Configuration with effective dates, the run console, the compliance
              calendar, the audit pack, and role management scoped per entity.
            </FeatureCard>
          </div>
        </Container>
      </Section>

      <NextPage href="/lifecycle" label="Lifecycle — onboarding through exit" />
    </>
  );
}
