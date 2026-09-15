/**
 * India's public holidays, split by how certain their dates are.
 *
 * Three national holidays are fixed by statute and never move. A few
 * more are computable — Christmas is a date, Good Friday follows Easter,
 * which is arithmetic. Everything else in the gazette moves with the
 * lunar calendar or a state notification: Diwali, Holi, both Eids,
 * Dussehra, Janmashtami, Guru Nanak Jayanti, Muharram. Those are listed
 * by name with no date, because a holiday on the wrong day is not a
 * cosmetic error — attendance treats the real one as an ordinary working
 * day and cuts the pay of everybody who took it.
 */

export type SeededHoliday = {
  date: string;
  name: string;
  /** Restricted holidays are opted into by the employee, not automatic. */
  restricted: boolean;
};

/**
 * Easter Sunday by the anonymous Gregorian computus. Good Friday is the
 * Friday before it, and is a gazetted holiday across India.
 */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function goodFriday(year: number): string {
  const easter = easterSunday(year);
  return iso(new Date(easter.getTime() - 2 * 86_400_000));
}

/**
 * The holidays whose dates this can state without guessing.
 *
 * Republic Day, Independence Day and Gandhi Jayanti are the three
 * national holidays every establishment in India closes for. Christmas
 * and Good Friday are gazetted and datable. Nothing else is here.
 */
export function certainHolidays(year: number): SeededHoliday[] {
  return [
    { date: `${year}-01-26`, name: "Republic Day", restricted: false },
    { date: goodFriday(year), name: "Good Friday", restricted: false },
    { date: `${year}-08-15`, name: "Independence Day", restricted: false },
    { date: `${year}-10-02`, name: "Gandhi Jayanti", restricted: false },
    { date: `${year}-12-25`, name: "Christmas Day", restricted: false },
  ];
}

/**
 * The rest of the usual Indian calendar, by name only.
 *
 * These follow the lunar calendar or a state notification and move every
 * year, so the date has to come from this year's gazette rather than
 * from here. Offered as a checklist so nobody has to remember the list.
 */
export const MOVABLE_HOLIDAYS = [
  "Holi",
  "Ram Navami",
  "Mahavir Jayanti",
  "Buddha Purnima",
  "Eid-ul-Fitr",
  "Bakrid (Eid-ul-Adha)",
  "Muharram",
  "Janmashtami",
  "Ganesh Chaturthi",
  "Dussehra (Vijaya Dashami)",
  "Diwali (Deepavali)",
  "Guru Nanak Jayanti",
] as const;
