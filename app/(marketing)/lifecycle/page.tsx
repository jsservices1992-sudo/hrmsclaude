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
  title: "Lifecycle",
  description:
    "Onboarding through exit — joiner portal, statutory declarations, probation, notice computation, clearance and settlement.",
};

const DOCS = [
  { g: "Identity & statutory", d: "PAN, Aadhaar or alternate ID, UAN, previous PF member ID, ESIC insurance number" },
  { g: "Banking", d: "Cancelled cheque or statement header, cross-checked against the account and IFSC entered" },
  { g: "Employment", d: "Relieving letter, experience letter, last three payslips, previous Form 16 for TDS continuity" },
  { g: "Education", d: "Highest qualification certificate and marksheet" },
  { g: "Personal", d: "Photograph, address proof, emergency contact, dependants where medical cover applies" },
];

const FORMS = [
  { f: "EPF Form 11", w: "Previous membership declaration — decides whether PF is compulsory and whether a transfer is needed" },
  { f: "EPF Form 2", w: "Provident fund and pension nomination, validated against declared dependants" },
  { f: "Form F", w: "Gratuity nomination under the Payment of Gratuity Act" },
  { f: "ESIC Form 1", w: "Declaration where the employee is within the wage threshold" },
  { f: "Form 12BB", w: "Investment and exemption declarations for tax projection" },
];

export default function LifecyclePage() {
  return (
    <>
      <PageHero
        code="02 · Lifecycle"
        title="From offer to settlement, without a spreadsheet."
        lede="Onboarding and exit are the two processes where HR loses the most time and makes the most expensive mistakes. Both are governed workflows here, with statutory data captured at the right moment rather than chased later."
        stats={[
          { value: "30", unit: "req", label: "Onboarding + exit specs" },
          { value: "5", unit: "forms", label: "Statutory, pre-filled" },
          { value: "8", unit: "types", label: "Exit scenarios" },
          { value: "0", label: "Re-keying by HR" },
        ]}
      />

      {/* ONBOARDING */}
      <Section bordered={false}>
        <Container>
          <SectionHead
            eyebrow="Onboarding"
            title="The joiner does the data entry. HR verifies."
            lede="A tokenised portal — no login required — where the accepted candidate completes their own profile, uploads documents and enters bank and statutory details before day one. Progress saves per section, so it can be finished across several sittings on a phone."
          />

          <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 mt-10">
            <div>
              <SpecRow code="ONB-1/2" title="Offer &amp; e-sign">
                Template-driven offer and appointment letters per company, merging
                the salary break-up from the CTC engine. Tracked issue, acceptance,
                decline or lapse against a validity window, with e-sign where you
                have a provider and audited click-accept where you do not.
              </SpecRow>
              <SpecRow code="ONB-3" title="Joiner portal">
                Mobile-first and login-free. HR sees live completion percentage per
                joiner rather than chasing by email.
              </SpecRow>
              <SpecRow code="ONB-6" title="Background verification">
                Trigger a vendor case by webhook and hold the returned status
                against the joiner. Gate day-one access or confirmation on it.
              </SpecRow>
              <SpecRow code="ONB-7/8" title="Conversion to employee">
                On the date of joining the joiner record becomes an employee record
                in one transaction — profile, mappings, salary structure, leave
                policy with pro-rated opening balances, shift and documents. Nothing
                is re-keyed.
              </SpecRow>
            </div>

            <div className="flex flex-col gap-8">
              <div>
                <p className="label text-brass mb-4">Document checklist — India default</p>
                <div className="border border-line bg-surface">
                  {DOCS.map((d, i) => (
                    <div
                      key={d.g}
                      className={`p-4 ${i > 0 ? "border-t border-line-2" : ""}`}
                    >
                      <p className="font-display text-base font-semibold mb-0.5">
                        {d.g}
                      </p>
                      <p className="text-sm text-ink-2 leading-relaxed pretty">{d.d}</p>
                    </div>
                  ))}
                </div>
                <p className="text-sm text-ink-3 mt-3 pretty">
                  Configurable per employment type. A rejected upload returns a
                  reason and reopens that single item, not the whole checklist.
                </p>
              </div>

              <div>
                <p className="label text-brass mb-4">Statutory forms, pre-filled</p>
                <div className="border border-line bg-surface">
                  {FORMS.map((f, i) => (
                    <div
                      key={f.f}
                      className={`grid grid-cols-[8rem_1fr] gap-4 p-4 ${
                        i > 0 ? "border-t border-line-2" : ""
                      }`}
                    >
                      <span className="font-mono text-xs text-indigo pt-0.5">
                        {f.f}
                      </span>
                      <span className="text-sm text-ink-2 leading-relaxed pretty">
                        {f.w}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <FeatureCard code="ONB-9" title="Statutory enrolment">
              PF applicability including the excluded-employee case, UAN generation
              or linking, transfer indication, ESIC threshold and implemented-area
              check, PT and LWF applicability — each stored with its reason.
            </FeatureCard>
            <FeatureCard code="ONB-10" title="Day-one provisioning">
              IT accounts, hardware from the asset register, access cards, licences
              and payroll verification, fanned out with owners and SLAs.
            </FeatureCard>
            <FeatureCard code="ONB-12" title="Probation &amp; confirmation">
              Raised before probation ends with four outcomes, and a confirmation
              salary revision that generates arrears if processed late.
            </FeatureCard>
            <FeatureCard code="ONB-14" title="Bulk import">
              Mid-year go-live with YTD earnings, tax deducted, leave balances and
              loan balances — because you cannot restate the year.
            </FeatureCard>
          </div>

          <div className="mt-8">
            <Callout label="Why the importer matters" tone="brass">
              The bulk importer is the single largest determinant of whether a
              customer goes live in fourteen days. We treat it as a first-class
              product surface with dry-run validation and per-row error reporting,
              not as an implementation utility.
            </Callout>
          </div>
        </Container>
      </Section>

      {/* EXIT */}
      <Section>
        <Container>
          <SectionHead
            eyebrow="Exit"
            title="Where most HR software stops caring."
            lede="Competitors typically treat exit as a status change followed by a spreadsheet. Here it is a computed last working day, a parallel clearance gate, statutory close-out, and a settlement that cannot release until clearance closes."
          />

          <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 mt-10">
            <div>
              <SpecRow code="EXIT-1" title="Eight exit types">
                Resignation, termination, termination for cause, probation
                termination, abscondment, retirement, contract completion and death
                in service — each with its own notice rules, approval routing,
                document set and settlement treatment. Death in service routes to
                the nominee, waives the five-year gratuity qualifying period, and
                suppresses routine employee notifications.
              </SpecRow>
              <SpecRow code="EXIT-3" title="Notice period engine">
                Notice resolves by precedence — employee override, then grade, then
                employment type, then company default — and computes the earliest
                permissible last working day. Whether leave taken during notice
                extends that date is an explicit setting, because it is a routine
                source of dispute.
              </SpecRow>
              <SpecRow code="EXIT-4" title="Shortfall, buyout &amp; waiver">
                Shortfall is valued on your configured basis and resolves as
                recovery, buyout or waiver — every waiver an audited approval with a
                reason. The same engine computes notice pay in the opposite
                direction when you terminate.
              </SpecRow>
            </div>
            <div>
              <SpecRow code="EXIT-6" title="Clearance, in parallel">
                IT, admin, finance, manager and HR clear simultaneously rather than
                in series. Each item resolves as cleared, cleared with a recovery
                amount that carries into settlement, or waived with a reason.
              </SpecRow>
              <SpecRow code="EXIT-11" title="Documents on condition">
                Acceptance letter on approval, relieving letter on clearance
                closure, experience or service certificate, and a no-dues
                certificate — with the option to withhold until settlement is paid,
                since practice varies and the sequencing is contractual.
              </SpecRow>
              <SpecRow code="EXIT-12" title="Statutory close-out">
                Final part-year tax computation and Form 16, PF date-of-exit in the
                ECR with withdrawal and transfer guidance, ESIC closure, gratuity
                Form I and the 30-day payment obligation, and the final PT and LWF
                deduction landing on the correct side of the contribution period.
              </SpecRow>
            </div>
          </div>

          <div className="mt-12 grid lg:grid-cols-[1fr_1fr] gap-10">
            <div className="flex flex-col gap-5">
              <h3 className="font-display text-2xl font-semibold">
                What clearance actually covers
              </h3>
              <CheckList
                items={[
                  "IT — device return, account and VPN revocation, licence reclaim, mailbox delegation",
                  "Admin — access card, keys, seat, parking, uniform",
                  "Finance — travel advances, corporate card, pending claims, outstanding loans",
                  "Manager — knowledge transfer signed off by the receiving party, not just the leaver",
                  "HR — document collection, exit interview, policy confirmations",
                ]}
              />
            </div>
            <div className="flex flex-col gap-5">
              <h3 className="font-display text-2xl font-semibold">
                Attrition analytics that mean something
              </h3>
              <CheckList
                items={[
                  "Attrition by company, branch, department, grade, manager and tenure band",
                  "Voluntary versus involuntary, regrettable versus non-regrettable",
                  "Early attrition inside 90 and 180 days — a direct read on onboarding quality",
                  "Exit-reason distribution from structured interview responses",
                  "Average days from resignation to settlement — the number HR heads are judged on",
                ]}
              />
            </div>
          </div>

          <div className="mt-10">
            <Callout label="Access after exit" tone="teal">
              Product access is revoked at the end of the last working day, but
              self-service stays open in a restricted mode for a retention window
              you configure — so a former employee can still reach payslips, Form 16
              and their settlement statement without emailing your HR team.
            </Callout>
          </div>
        </Container>
      </Section>

      <NextPage href="/attendance" label="Attendance — shifts, punch and leave" />
    </>
  );
}
