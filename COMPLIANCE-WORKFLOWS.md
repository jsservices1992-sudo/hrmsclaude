# Statutory operations

Open `/console/statutory/operations` from Statutory. Choose the company and
period before preparing or reviewing a record. This implements operational
controls, not legal certification or automatic portal submission.

## Available workflows

- Deposits: capture scheme, period, principal, payment reference, original
  evidence, and TDS BSR/challan serial. Allocate TDS deposits to ledger entries
  without exceeding either balance. Reconciliation compares booked liabilities
  to captured principal; capturing a receipt does not itself make a bank payment.
- Filing: prepare a quarter reconciliation packet and upload the actual
  externally validated FVU plus validation report/version/reference. A second
  reviewer posts the evidence. Download is bound to the current ledger,
  allocations, deposits and employee identity digest. The CSV packet is working
  input, not an official portal file. Other statutory export formats still need
  their own official validation; no generic certification is implied.
- EPS: report employee transition flags and capture reviewed historical
  enrolment/joining/revision evidence. Missing or changed evidence blocks payroll
  approval rather than assuming UAN proves EPS membership.
- Annual bonus: prepare an April-March register using approved payroll,
  attendance, applicable minimum wage and reviewed applicability/accounts.
  Minimum/maximum awards and four-year FIFO set-on/set-off are retained in the
  register. Opening carry is entered as dated structured rows. Posting creates
  source-keyed payroll adjustments with a payment-deadline check.
- Overtime: prepare attendance-derived daily/weekly/off-day double-rate pay,
  retain dated calculation detail, and post reviewed adjustments. Legacy
  off-day pay is suppressed when the statutory OT adjustment is present.
- Worker leave: record reviewed worker coverage; prepare closed calendar-year
  qualification, accrual, protected refused leave, more-favourable benefits,
  carry and encashment; post against a checked opening balance and explicit
  earning classification.
- Notifications: retain effective dates, government document URL, SHA-256,
  notification reference and reviewer evidence. National floor configuration
  uses only an effective, reviewed, notified positive monthly equivalent.
  There is no invented or seeded national floor rate.

Preparation and posting are separate. Company access and reviewer separation
are enforced server-side. Changed source data invalidates prepared evidence.
Posting a register queues an adjustment; payroll approval and actual payment
remain separate steps. Compliance-sourced adjustments cannot be manually edited
through Attendance.

## Explicit boundaries

Certified surplus, statutory applicability/exemptions, opening bonus carry,
worker classification, deemed qualifying leave days and original notifications
require responsible human review. Exited-employee supplemental payouts are not
automated: positive awards cannot be queued for employees absent from the
payout payroll. Worker year-end processing does not replace separation/F&F
entitlement. Mid-month salary changes and take-home OT contracts require manual
review. The wider audit still contains unresolved tax exemption, state-specific
and historical-evidence findings; see `PAYROLL-AUDIT-REMEDIATION.md`.

## Deployment

On 10 October 2026, migrations through 0034 were applied to the configured
remote database after a restricted-permission local PostgreSQL archive backup.
`npm run db:check` confirms that all mapped application columns are present.
Other environments must still be backed up and migrated before deploying this
application version. Migration 0034
makes minimum-wage version uniqueness company/zone-aware. Use durable production
document storage and preserve evidence permissions. Reconcile historical
bookings and balances before authorising production payroll.

The health endpoint now checks every mapped column, including the compliance
tables, rather than declaring an old populated database schema healthy. Run
`npm run db:check` as a read-only rollout check. Document-store configuration
and legal/historical evidence acceptance remain independent requirements.

The isolated integration scripts intentionally require PostgreSQL on
`127.0.0.1:55439` and `COMPLIANCE_TEST_FIXTURES=yes`; the browser test targets
`localhost:3017`. They create synthetic local fixtures and must not be repointed
to live payroll. Session values are generated at runtime and are not committed.

## Sources and acceptance

- [Code on Wages](https://www.labour.gov.in/static/uploads/2025/06/c328da14bbb15fc4ad571dc33e7a4ab3.pdf), including bonus and set-on/set-off provisions.
- [MoLE additional FAQs](https://www.labour.gov.in/static/uploads/2026/03/a4ccf4c6d97c4f1f36a6d83f8c64213d.pdf), including worker leave and remuneration treatment.
- [Income Tax Form 138 user manual](https://www.incometax.gov.in/iec/foportal/newformpage/forms/form138-um), including external utility validation and filing.

Unit tests, local database and browser checks are engineering evidence, not
government acceptance, bank acceptance or a legal opinion. Complete staging
reconciliation and applicable central/state legal review before real filing.
