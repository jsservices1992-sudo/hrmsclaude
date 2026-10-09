# Payroll audit remediation

Review updated: 10 October 2026. Input: the supplied payroll-audit.md.

## Release status

**Not certified compliant. Do not treat passing tests, verification flags,
or this implementation as legal certification.** This is a first remediation
batch, not closure of the entire audit. Database migrations 0027-0036 are
applied to the configured remote database on 10 October 2026 after an archive
backup. The post-migration schema check passes. Other deployments require the
same backup/migration checks; reconcile historical payroll before acceptance.

## Findings and status

| Finding | Status | Implemented / remaining work |
| --- | --- | --- |
| H1 TDS ledger | Implemented, deployment pending | Approval books payroll TDS transactionally; reopening reverses unallocated entries. Source keys permit payroll and F&F events in one month. Backfill reads saved TDS from authoritative booked runs. Deposit/challan capture, allocation and reconciliation implemented; actual portal acceptance remains. |
| H2 F&F net and payout | Implemented, integration pending | TDS reduces stored net. Separate NEFT payout uses that net. Recording actual payment books settlement TDS. Legacy calculations must be recomputed; cross-tax-year payments require review. Bank-format and authenticated UI checks remain. |
| H3 duplicate final salary | Implemented, integration pending | Final salary is paid only in Payroll. F&F requires an approved final-month summary, excludes salary from its payout, and both exit loaders share the calculation. Reconcile already paid settlements manually. |
| H4 payment deadline | Implemented, integration pending | Default two working days with company/branch holidays and weekly offs. Gratuity retains its separate clock. This does not itself arrange a timely bank payment. |
| H5 mid-month PF | Partial | Dated ceiling segments and saved EPS/EDLI bases implemented. September examples tested. LOP allocation and take-home solver integration are unresolved and block affected approvals. Authenticate the mirrored EPFO FAQ before relying on it for filing. |
| H6 EPS membership | Partial, historical acceptance pending | Separate EPS membership, joining wage and revision-date wage evidence with employee settings, transition report and reviewed evidence register implemented. UAN alone is not EPS proof. Missing/changed evidence blocks approval. Reconcile actual EPFO history before acceptance. |
| M1 minimum wage | Partial | Statutory wage shortfalls block approval; floors are prorated; zone/company selection shared. Delhi original April 2025 order authenticated: erroneous April 2026 seed date corrected in source and only matching unverified global DB rows. Reviewed/company overrides preserved. Other state original records, including Karnataka paise/category applicability, remain. |
| M2 bonus | Partial | Reviewed annual workflow implements minimum-wage ceiling, actual/deemed days, statutory wages, floor, set-on/off, deadline and posting. Monthly advisory no longer uses Basic flags, 365 assumed days, missing-floor Rs 7,000 fallback or employer accrual as payment; it uses statutory wage rate, applicable state floor and attendance evidence. Final annual applicability/accounts/carry require review; leaver supplemental payments remain. |
| M3 gratuity exemption | Review workflow implemented; legal acceptance pending | Explicit documented Sl. 5/6 basis, supported separate ten-month average, prior exemptions, no last-salary fallback. Generic entitlement no longer auto-grants exemption. Missing/stale review blocks preparation/release. Code/tax transition classification must be reviewed, not inferred. |
| M4 leave exemption | Tax workflow implemented; evidence pending | Separate eligible Basic/DA historical average, earned leave, leave used and other exemption usage required; rounding fixed; statement/tax aligned. No gross-salary shortcut. Legal entitlement/history must be supported by reviewer evidence. |
| M5 TDS projection | Partial | Actual earlier booked salary and PF/EPS/NPS history, remaining employed months, higher/capped PF membership and excess-retiral detection without NPS implemented. HRA/deduction salary separated from PF wage. F&F reviewed YTD allowances/PT and regime-allowed deductions replace zero/projected guesses; previous employer data retained. Current-period extras/LOP, dated future PT and full perquisite accrual valuation remain unresolved. |
| M6 incentive/arrears | Partial | Explicit not_remuneration treatment excludes annual performance incentives from numerator and denominator, preserved on saved lines. Classification needs human review. Arrear attribution to original periods remains open. |
| M7 overtime | Partial | Reviewed coverage and attendance-derived double-rate daily/weekly/off-day OT registers and posting implemented; prevents duplicate legacy off-day earnings. Take-home contracts, mid-month salary changes and establishment-specific policy require review. |
| M8 worker leave | Partial | Reviewed covered-worker identification, qualification, accrual, protected refused leave and year-end carry/encashment implemented; preserves more favourable benefits. Separation entitlement and historical balance evidence remain. |
| M9 ESI | Partial | PwD ceiling with certificate reference and separate statutory coverage wage/freeze implemented. Validate contribution-period continuation, OT eligibility treatment and rate-versus-earned-wage interpretation against ESIC guidance. |
| L1 EDLI floor | Implemented | Removed default Rs 200 EDLI floor. Verify employer-level administrative minima separately. |
| L2 tax forms | Partial | Calendar names Form 138 with legacy alias. Salary-tax document explicitly a working statement, not a valid certificate; Form 130 must come from TRACES and be signed. Same-month payroll/F&F deductions are summed. Official Form 124/130 capture and remaining accepted filing layouts remain. |
| L3 citations/docs | Partial | README no longer equates configured verified flags with readiness. WB final-notification citation and remaining EPS seed commentary still need correction against originals. |
| L4 LWF | Open | Verify rates and eligibility under each state's own Act. Do not import another statute's supervisor threshold. |
| L5 PT/LWF base | Partial | Additional earnings included in monthly base; PT YTD loaded from authoritative earlier FY runs. State-specific earnings exclusions and annual-income assessments remain. |
| L6 caps/notice policy | Hooks/review implemented; policy evidence pending | F&F and banking use shared effective-dated gratuity parameters; no duplicated hardcoded provision cap. Notice days require contractual review, not a 60-day guess. Absent gratuity parameters retain explicit defaults; reviewers must establish applicable notification/policy. |

## Workflow implementation update

The six requested workflow families are implemented at
`/console/statutory/operations`. See `COMPLIANCE-WORKFLOWS.md` for scope and
acceptance limits. This supersedes the missing-workflow list, not every open
legal finding in the table above.

- Deposit capture, TDS allocation and reconciliation; externally validated
  Form 138 artifact capture/review/download with source-digest checks.
- EPS transition report and independently reviewed historical evidence.
- Annual bonus awards, dated opening carry, set-on/set-off and payroll posting;
  attendance-derived reviewed overtime registers and dated exports.
- Reviewed worker coverage and year-end carry/encashment processing.
- Versioned state notification evidence and effective-date tracker.
- Effective reviewed national-floor hook, with no invented notified rate.

Remaining acceptance includes live historical evidence, certified bonus
accounts/applicability, exited-employee supplemental payments, separation leave
entitlements and official validation of other statutory filing formats.

## Deployment and acceptance checklist

1. The configured remote database was backed up and migrated on 10 October 2026. Confirm the target and backup before migrating any other environment.
2. Back up the database, rehearse migrations and verify source-key uniqueness/backfill totals on staging.
3. Reconcile payroll TDS ledger to saved deductions and payments; distinguish accrual from actual withholding/deposit dates.
4. Compare September PF/EPS/EDLI to authenticated EPFO examples, including excluded employees, joiners, leavers, LOP and take-home contracts. A blocking review is not a completed calculation.
5. Exercise employee EPS/PwD settings, payroll approval/reopen and F&F prepare/release/download/payment with real role separation on staging.
6. Resolve all open/partial legal findings before authorising affected production payroll or filing. Obtain payroll/legal review of current central and applicable state notifications.
7. Run tests, type-check, lint and production build after the final changes; record results separately from legal sign-off.

## Primary references reviewed

- [MoLE additional FAQs, March 2026](https://www.labour.gov.in/static/uploads/2026/03/a4ccf4c6d97c4f1f36a6d83f8c64213d.pdf): remuneration exclusions, annual performance incentives, employer contributions, overtime and worker leave.
- [PIB EPF ceiling announcement](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2311536&lang=2&reg=48).
- [CBDT Form 138](https://www.incometaxindia.gov.in/documents/d/guest/fn-138): salary TDS statement and filing particulars.
- [ESIC SPREE implementation circular](https://roap.esic.gov.in/attachments/circularfile/Implementation_of_SPREE_2025_1752563525.pdf): standard and disability coverage ceilings.
- September split calculations also reference a [third-party mirror of an EPFO FAQ](https://egazette.labourcodesadvisor.com/state-notifications/central-faq-on-revision-of-epfo-statutory-wage-ceiling-from-rs-15-000-per-month-to-rs-25-000-per-month.pdf). The original EPFO-hosted copy was not authenticated in this review; this limitation remains open.

## Verification of this batch

- `npm test`: 1,631 passed, zero failures (including separation review, bonus advisory, date, storage-provider and tax regressions).
- `npx tsc --noEmit`: passed.
- `npm run lint`: zero errors, 58 warnings.
- `npm run build`: passed.
- Build reports six existing dynamic-filesystem tracing warnings; lint reports
  58 warnings, not a warning-free release.
- `git diff --check`: passed.
- Migrations rehearsed and rerun on isolated local PostgreSQL; service fixtures
  and authenticated desktop/mobile browser workflows exercised locally:
  deposits/allocation bounds, second-reviewer controls, OT/bonus/leave/EPS
  posting, structured opening carry and company-scoped exports.
  Configured remote database migration and read-only schema verification are
  complete. Bank acceptance and actual government validator/portal acceptance
  have not been performed.
- Tax register now uses the existing shared worksheet batch loader instead of
  querying every employee independently. Isolated integration verifies identical
  worksheet arithmetic and 22 batch queries versus 40 repeated queries for the
  two-employee fixture.
- Post-migration authenticated HTTP smoke checks passed for 15 main pages and
  statutory operation tabs, using a local production build against the
  configured remote database. The public deployed URL was not supplied, so
  these checks do not assert that its environment/storage settings match.

## Separation review update

See SEPARATION-REVIEW.md. Guarded PostgreSQL integration verifies missing/stale
review gates, statement/tax agreement, append-only evidence and excess employer
PF perquisite without NPS. Authenticated local desktop/mobile browser checks
exercise review, prepare, independent release, payment and payout safety. No live
employee evidence/approval/payment is fabricated. Migration 0035 adds only the
review table; 0036 corrects narrowly matched unverified Delhi seed dates/sources.
Backup before this batch: `data/backups/pre-fnf-review-20261010-1791574181020.dump`.

Still open engineering: September split PF LOP/take-home integration, leaver
supplemental awards, original-period arrears, covered-worker separation leave,
current-period TDS extras/LOP, establishment-specific overtime, applicable-state
LWF/PT classification, complete official filing/certificate artifact workflows,
and deployment document-storage configuration. Reviewed source/history records
and actual bank/government acceptance are separate acceptance requirements.

## Selected document storage

Vercel Blob is the selected provider. Set `STORAGE_PROVIDER=vercel-blob` and
connect a private store's `BLOB_READ_WRITE_TOKEN` in deployment environment
settings. Explicit selection cannot fall back to another store or ephemeral
disk when the token is missing. Existing uploads/downloads use private Blob
access and authenticated application routes. The local environment has no Blob
token; live upload/download and permission acceptance are not yet verified.
Never send the token in chat or commit it. See README.md for deployment steps.
