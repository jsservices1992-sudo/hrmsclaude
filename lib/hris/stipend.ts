/**
 * An intern is paid a stipend, not wages.
 *
 * A bona fide intern is a trainee, not a "worker" or "employee" in the
 * sense the wage and social-security laws use: minimum wages, the Code
 * on Wages' 50% rule, the Payment of Bonus Act, EPF and ESI do not reach
 * a stipend. Income tax does — a stipend is taxable — so TDS still runs.
 * PF and ESI can still be switched on for a particular intern where the
 * company chooses to cover them ("Yes" on the employee record).
 */
export function isStipendiary(employmentType: string | null | undefined): boolean {
  return employmentType === "intern";
}
