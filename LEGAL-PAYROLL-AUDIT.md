# Payroll Legal Review - 3 October 2026

Status: NOT legally certified. This is a code review and an evidence register,
not approval to file statutory returns. Passing tests establishes the behavior
of tested inputs, not the correctness of every legal assumption or employer fact.

## Corrections Implemented

- Removed the owner-requested assumption that every non-basic allowance is an
  exclusion. Regular special allowance defaults to included contractual wages;
  named HRA, conveyance and commission exclusions use the 50% add-back treatment.
  Explicit component settings still take precedence and must be reviewed.
- Gratuity projections and bank-line calculations now retain included pay in
  the wage base, rather than counting only components marked Basic/DA.
- Exit and F&F evaluation use the last working day's wage regime. Bank provisions
  use their reporting date. Earlier-period gratuity retains the legacy base.
- F&F selects the latest salary effective on or before exit, excluding future
  increments. Exit preview also selects the historical salary instead of requiring
  the currently open salary row.
- Existing unverified PT/LWF/minimum-wage reference checks block payroll approval.
  This is a reference-data safeguard, not verification of the wage engine.

## Material Open Items

1. **Remuneration denominator - implemented:** employer EPF plus EPS and separately
   accrued statutory bonus now enter both remuneration and specified exclusions.
   Payroll and projections solve the wage/contribution dependency using rounded
   employer contributions. CTC, reverse take-home, F&F and exit gratuity use the
   same calculation. Bank provisions and saved-run checks use stored EPF/EPS and
   statutory-bonus lines. Employee PF/VPF, EDLI, administration charges, ESI and
   gratuity provisions are not added. Existing saved runs are not recalculated.
   Other component classification and historical snapshot issues below remain open.
2. **Component evidence:** explicit overrides, legacy `esicBase=false`, custom
   component codes, reimbursements, benefits in kind, arrears and variable pay
   require classification by payment substance and employment terms. Category
   `incentive` alone does not distinguish annual performance incentives from
   contractual pay. Do not bulk migrate these classifications by label.
3. **Historical reproducibility:** bank provisions read current component master
   settings against stored earning lines. Historical salary selection does not
   version component definitions or department assignments. Stored run snapshots
   and calculation-version handling still need review.
4. **Transition periods and scheme rules:** month-end regime selection is not
   proof of correct treatment for a mid-month commencement or ceiling change.
   Verify notified PF/EPS/EDLI ceilings separately, membership exceptions, and
   ESI contribution-period continuation. A ceiling is not a minimum PF base.
5. **State and establishment applicability:** PT, LWF, minimum wage schedule,
   zone, skill category and effective dates require actual notification evidence
   for every operating establishment. Existing seed values are not certification.
6. **Other app workflows:** this pass does not certify tax, bonus eligibility and
   minimum-wage-linked bonus ceilings, fixed-term gratuity, continuous service,
   forfeiture, leave, overtime, filing formats, payment deadlines or access controls.
   End-to-end browser/database tests and actual filing reconciliation remain open.

## Official Evidence Consulted

- Ministry of Labour, Code on Social Security text, section 2(88):
  https://labour.gov.in/sites/default/files/ss_code_as_passed_by_lok_sabha.pdf
  Search-index text was available; direct retrieval failed. Obtain the enacted
  Gazette and retain it with the final legal sign-off.
- Ministry of Labour, Additional FAQs dated 16 March 2026:
  https://www.labour.gov.in/static/uploads/2026/03/a4ccf4c6d97c4f1f36a6d83f8c64213d.pdf
  Reviewed remuneration, incentive, commencement, ESI and gratuity clarifications.
- PIB/EPFO Goa advisory dated 23 September 2026:
  https://www.pib.gov.in/PressReleasePage.aspx?PRID=2313790&lang=2&reg=48
  Reports EPF ceiling revision effective 17 September 2026. Underlying notification
  and EPS/EDLI treatment still require separate verification.

## Evidence Needed for Final Review

The company's payroll/legal reviewer must confirm establishment registrations,
states and industry, employee categories, employment terms, component exclusions,
applicable notifications and transition treatment. Reconcile representative payroll,
F&F and statutory returns with independently calculated expected amounts. Record
the reviewer, date, notification and affected period for each approved rule.

No saved payroll, employee salary or statutory database record was migrated by
this code correction. Saved runs need an impact review before recalculation.

## Verification

Full automated suite: 1,584 passed, zero failures. Production build passed.
Lint completed with zero errors and 58 existing warnings.

The employer-contribution regression suite covers capped and uncapped PF,
rupee rounding, exclusion/coverage boundaries, legacy periods, custom statutory
bonus, stored contribution lines, forward/reverse CTC and take-home, and agreement
between payroll, projections and gratuity. No browser or live database workflow
verification was performed in this pass; salary-query fixes were type/build checked.

Example with monthly basic 10,000 and HRA 20,000: at a capped employer EPF/EPS
share of 1,800, remuneration is 31,800 and statutory wage is 15,900. With uncapped
12% employer contribution, rounded employer share converges to 1,915 and the wage
is 15,957.50. These examples intentionally use HRA, a specified exclusion, rather
than treating regular special allowance as excluded.
