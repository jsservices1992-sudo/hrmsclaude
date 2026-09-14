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
  title: "Attendance & leave",
  description:
    "Shifts, geofenced mobile punch, biometric integration, regularisation and a leave engine that feeds payroll cleanly.",
};

const CAPTURE = [
  {
    m: "Mobile",
    d: "GPS with geofence per branch or client site, works offline and syncs on reconnect, optional selfie and device binding to stop buddy punching.",
  },
  {
    m: "Web",
    d: "Browser punch for desk staff, with optional IP allowlisting per branch.",
  },
  {
    m: "Biometric",
    d: "Device integration by API or scheduled pull, with duplicate and clock-drift handling on ingest.",
  },
  {
    m: "Bulk & manual",
    d: "Supervisor marking for field teams and CSV upload for sites without connectivity.",
  },
];

export default function AttendancePage() {
  return (
    <>
      <PageHero
        code="03 · Attendance"
        title="Punch data that payroll can trust."
        lede="Attendance is only useful if the number that reaches payroll is defensible. Shifts, capture, the rules that derive a day's status, and the regularisation trail are all one system — and payroll cannot run until the period is locked."
        stats={[
          { value: "<500", unit: "ms", label: "Punch acknowledgement" },
          { value: "4", unit: "methods", label: "Capture modes" },
          { value: "Offline", label: "Mobile capable" },
          { value: "Locked", label: "Before payroll runs" },
        ]}
      />

      <Section bordered={false}>
        <Container>
          <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-10 lg:gap-16">
            <SectionHead
              eyebrow="Capture"
              title="Four ways in, one record out."
              lede="Most workforces in this segment are mixed — desk staff, field teams and a factory or warehouse. All four capture methods write to the same attendance record with the same validation."
            />
            <div className="border border-line bg-surface">
              {CAPTURE.map((c, i) => (
                <div
                  key={c.m}
                  className={`grid grid-cols-[6.5rem_1fr] gap-4 p-5 ${
                    i > 0 ? "border-t border-line-2" : ""
                  }`}
                >
                  <span className="label text-brass pt-1">{c.m}</span>
                  <p className="text-ink-2 leading-relaxed pretty">{c.d}</p>
                </div>
              ))}
            </div>
          </div>
        </Container>
      </Section>

      <Section>
        <Container>
          <SectionHead
            eyebrow="Rules"
            title="A day's status is derived, not typed."
            lede="The rules engine turns raw punches into the statuses payroll consumes — and shows its working, so a disputed absence is a question with an answer."
          />
          <div className="grid lg:grid-cols-2 gap-10 mt-10">
            <div>
              <SpecRow code="ATT-1" title="Shifts &amp; rosters">
                Fixed, rotational, split and flexible shifts with grace periods,
                minimum hours for a full or half day, and week-off patterns.
                Rosters assign by employee, team or branch, with a published
                schedule employees can see in advance.
              </SpecRow>
              <SpecRow code="ATT-2" title="Status derivation">
                Present, absent, half day, weekly off, holiday, on leave, on duty
                and overtime — derived from punches against the assigned shift and
                the attendance policy in force on that date.
              </SpecRow>
              <SpecRow code="ATT-3" title="Overtime">
                Eligibility by grade or employment type, computed against a
                configured threshold, at a rate you set, and routed for approval
                before it can reach payroll as an earning.
              </SpecRow>
            </div>
            <div>
              <SpecRow code="ATT-4" title="Regularisation">
                Missed punches, wrong shifts and on-duty days are corrected through
                a request with a reason, routed to the manager. The original record
                is never overwritten — the correction sits alongside it with its
                approval trail.
              </SpecRow>
              <SpecRow code="ATT-5" title="Holiday calendars">
                Per company and per branch, because a national holiday list is
                wrong the moment you open an office in a second state. Optional and
                restricted holidays supported.
              </SpecRow>
              <SpecRow code="ATT-6" title="Period lock">
                Attendance and leave lock on the cut-off date. After that, changes
                flow to the next period as an adjustment or trigger a retrospective
                recalculation — never a silent edit to a paid month.
              </SpecRow>
            </div>
          </div>
        </Container>
      </Section>

      <Section>
        <Container>
          <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-10 lg:gap-16 items-start">
            <div className="flex flex-col gap-6">
              <SectionHead
                eyebrow="Leave"
                title="Balances that survive an audit."
                lede="Leave is where accrual rounding, carry-forward caps and encashment rules quietly diverge between the policy document and the system. Every one of them is explicit configuration here."
              />
              <CheckList
                items={[
                  "Leave types with accrual frequency, pro-rata on joining, and eligibility after probation",
                  "Carry-forward caps, lapse rules and encashment eligibility per type",
                  "Negative balance permitted or blocked, configured per type",
                  "Holiday and week-off treatment inside a leave span — the sandwich rule, stated explicitly",
                  "Compensatory off earned against approved overtime, with its own expiry",
                  "Approval routing with delegation when a manager is themselves on leave",
                ]}
              />
            </div>
            <div className="flex flex-col gap-5">
              <FeatureCard code="Payroll link" title="Loss of pay">
                Unpaid absence flows to payroll as loss-of-pay days, valued on the
                proration basis you configured — not on an assumption the engine
                made for you.
              </FeatureCard>
              <FeatureCard code="Payroll link" title="Encashment">
                Earned leave encashment computes on your policy&rsquo;s basis, and at
                separation applies the exemption available under section 10(10AA)
                rather than taxing the whole amount.
              </FeatureCard>
              <FeatureCard code="Payroll link" title="Exit interaction">
                Leave applications are blocked beyond a confirmed last working day,
                and the balance at exit feeds the settlement automatically.
              </FeatureCard>
            </div>
          </div>

          <div className="mt-10">
            <Callout label="Mobile is the primary surface" tone="indigo">
              For most of your workforce, attendance and leave <em>are</em> the
              product — they will open little else. Both work offline, sync on
              reconnect, and never lose a punch to a dead network in a basement or
              a client site.
            </Callout>
          </div>
        </Container>
      </Section>

      <NextPage href="/payroll" label="Payroll — the calculation engine" />
    </>
  );
}
