# Separation review and release

Engineering update: 10 October 2026. This workflow is not legal certification.

## Location and sequence

Open an employee's exit case, then its Full & final settlement page. The
Separation tax & notice review section is available to company-authorised
payroll users with compensation access while the settlement is unsaved/draft.

1. Record the documented salary history, earned-leave record, exemptions used
   at earlier/other employers, actual YTD tax facts and contractual notice days.
2. Provide references to the original supporting documents and reviewed legal
   basis, including eligible DA terms and employee/establishment applicability.
3. Compute and save. An independent person releases the saved snapshot unless
   the company's audited segregation-of-duties policy explicitly permits otherwise.
4. Download the payout file after bank configuration; record the actual payment
   date/reference only after transfer. This does not execute a bank transfer.

The schema migration is 0035. Review rows are append-only at database level.
Changed salary, structure, wage calculation, loan/leave/clearance, statutory
configuration or relevant tax facts invalidate the review. Preparation/release
also checks the latest review and saved tax/line snapshot under settlement locks.
This does not lock every upstream payroll/HR table against concurrent edits.

## Tax facts and evidence

- Monetary form inputs are rupees; stored/calculated amounts are integer paise.
- Gratuity Sl. 6 uses eligible Basic + DA averaged over the ten months preceding
  the event month, completed service years, amount received and remaining notified
  limit. Last drawn salary is not substituted for missing history.
- Sl. 5 is an explicit documented legal-basis selection, not an automatic conclusion
  that every Code on Social Security gratuity qualifies under the 1972 Act wording.
  Have the Code/tax transition reviewed for the actual employee and payment.
- Leave average salary uses the separate ten-month period preceding retirement,
  eligible Basic + DA, credited earned leave, the tax entitlement after leave used,
  the ten-month cap, amount received and remaining notified lifetime limit.
- Other-employer exemption usage must include relevant payments in the current
  tax year as well as prior lifetime usage. Zero is a reviewed fact, not a default.
- Confirm leave-encashment eligibility and qualifying earned-leave categories;
  the application does not infer eligibility from a generic leave balance label.
- Old-regime allowed deductions and deductions specifically allowed under the new
  regime are separate reviewed amounts. Historical employer NPS/perquisites or
  other taxable remuneration must not be represented as additional settlement cash.
- YTD allowances/PT must be actual and legally allowed, not a full-year projection.
  Previous-employer salary/TDS remains sourced from the employee's tax declaration.

The UI accepts supported reviewed averages, not an automatically certified
ten-month salary-history import. Retain both averaging worksheets and employee
declarations; legal/payroll review must establish the figures and entitlement.

## Other corrections

- Generic gratuity/leave entitlement helpers no longer grant tax exemptions merely
  because the payment is below a ceiling. F&F applies the reviewed tax computation
  to both statement lines and tax totals.
- Notice payouts are included once. Recovery does not default to a salary-tax
  deduction. Notice period is explicitly reviewed rather than assumed to be 60 days.
- Central parameters `gratuity.qualifying_years`, `gratuity.fixed_term_qualifying_years`,
  `gratuity.days_per_year`, `gratuity.month_divisor`, `gratuity.ceiling_paise` can be
  effective-dated in Compliance settings. F&F/provisions read the same parameters;
  absent rows retain explicit defaults, not a new inferred notified rate.
- Regular gratuity rounds a part year only when it exceeds six calendar months.
- Payment dates/deadline defaults use IST; server UTC midnight is not India's date.
- Version-2 and older unpaid settlements require reopening/review/recomputation
  before payout export or payment recording. Already paid snapshots are preserved.
- Excess TDS is a separate adjustment, not an automatic F&F cash refund.
- Salary-tax working statements sum multiple ledger sources within one month and
  are not statutory certificates. Valid Form 130 must come from TRACES and be signed.

## Sources and acceptance limits

- [Income-tax Act 2025, section 19](https://www.incometaxindia.gov.in/w/section-19-199).
- [CBDT note on Forms 130-133](https://www.incometaxindia.gov.in/documents/d/guest/fn-130-131-132-133).
- [MoLE Code on Social Security text](https://labour.gov.in/sites/default/files/ss_code_as_passed_by_lok_sabha.pdf), section 53.

No production settlement was approved or paid by these tests. Browser/service
fixtures run only against the guarded local cluster. Live historical evidence,
original notified ceilings/applicability, statutory portal acceptance and bank
acceptance still require review. See PAYROLL-AUDIT-REMEDIATION.md for unresolved
engineering items; passing this workflow does not close the entire audit.
