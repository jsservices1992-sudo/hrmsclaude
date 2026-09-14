/**
 * Restricted holidays — the optional ones.
 *
 * An Indian holiday calendar has two halves. The closed holidays apply
 * to everybody and the office shuts. The restricted ones are a list —
 * often a long one, covering several faiths and regions — from which
 * each employee picks a small number. `deriveMonth` deliberately
 * ignores restricted holidays when working out which days the company
 * was closed, which is right: they are not company holidays, they are
 * an allowance.
 *
 * The allowance rides on an ordinary leave type flagged
 * `restrictedHoliday`, so balance, approval, loss-of-pay and payroll
 * all behave exactly as they do for any other paid leave. What is
 * particular to a restricted holiday is only *which dates qualify* and
 * *how many you get* — and that is what lives here.
 */

export type RestrictedHolidayDef = {
  id: string;
  date: string;
  name: string;
  /** Null means it applies to every branch in the company. */
  branchId: string | null;
  restricted: boolean;
};

export type RestrictedHolidayOption = {
  id: string;
  date: string;
  name: string;
  /** Already applied for, whether decided or still pending. */
  taken: boolean;
  /** Has been and gone. */
  past: boolean;
};

/**
 * The list to show an employee: every restricted holiday for their
 * branch this year, with what they have already claimed marked.
 */
export function restrictedHolidayOptions(args: {
  holidays: RestrictedHolidayDef[];
  branchId: string;
  year: number;
  /** Dates the employee already has an RH request against. */
  claimedDates: string[];
  today: string;
}): RestrictedHolidayOption[] {
  const claimed = new Set(args.claimedDates);
  return args.holidays
    .filter(
      (h) =>
        h.restricted &&
        (h.branchId === null || h.branchId === args.branchId) &&
        h.date.startsWith(String(args.year)),
    )
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((h) => ({
      id: h.id,
      date: h.date,
      name: h.name,
      taken: claimed.has(h.date),
      past: h.date < args.today,
    }));
}

export type RestrictedCheck = { ok: true; holidayName: string } | { ok: false; error: string };

/**
 * Whether this particular day may be taken as a restricted holiday.
 *
 * Deliberately strict about the date being on the published list: the
 * whole point of the allowance is that it is spent on one of the
 * company's own optional holidays, and a free-text date would make it
 * an extra two days of casual leave under another name.
 */
export function validateRestrictedHoliday(args: {
  fromDate: string;
  toDate: string;
  halfDay: boolean;
  options: RestrictedHolidayOption[];
  /** How many the employee has already claimed this year. */
  claimedCount: number;
  /** From the leave type's annualDays. */
  quota: number;
}): RestrictedCheck {
  if (args.fromDate !== args.toDate) {
    return {
      ok: false,
      error: "A restricted holiday is a single day — apply for one date at a time.",
    };
  }
  if (args.halfDay) {
    return { ok: false, error: "A restricted holiday is taken as a whole day." };
  }

  const match = args.options.find((o) => o.date === args.fromDate);
  if (!match) {
    return {
      ok: false,
      error:
        "That day is not on your branch's restricted-holiday list. Pick one of the published dates, or apply for ordinary leave instead.",
    };
  }
  if (match.taken) {
    return { ok: false, error: `You have already claimed ${match.name}.` };
  }
  if (match.past) {
    return {
      ok: false,
      error: `${match.name} has already passed — a restricted holiday is chosen in advance.`,
    };
  }
  if (args.claimedCount >= args.quota) {
    return {
      ok: false,
      error:
        args.quota === 0
          ? "Your company has not allowed any restricted holidays this year."
          : `You have used all ${args.quota} of your restricted holidays for the year.`,
    };
  }

  return { ok: true, holidayName: match.name };
}
