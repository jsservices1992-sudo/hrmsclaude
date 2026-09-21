/**
 * The register most companies actually keep: one line per person saying
 * how many days they worked.
 *
 * The day-by-day import exists for a register kept day by day, and for a
 * punch machine. It asks for a row per person per day — seven hundred
 * lines for two dozen people — and the month it produces depends on
 * something invisible: a day nobody wrote down counts as present here,
 * so a file listing only the days worked pays everybody in full.
 *
 * This is the other shape. "BADAL SINGH: 13" is what the person holding
 * the register knows, and it leaves nothing unsaid — the days not worked
 * are the ones not counted.
 *
 * Weekly offs and holidays are not in the figure and are paid anyway.
 * Somebody who worked every working day of a month with four Sundays and
 * a holiday writes the working days, not 31, and is paid for all 31.
 */

export type DaysWorkedRow = {
  empCode: string;
  daysWorked: number;
  /** Half days, counted as half a day worked. */
  halfDays: number;
};

export type DaysWorkedError = { line: number; message: string };

export type DaysWorkedParse = {
  rows: DaysWorkedRow[];
  errors: DaysWorkedError[];
};

const HEADER = /^\s*emp[_\s]?code\s*,/i;

const norm = (h: string) => h.trim().toLowerCase().replace(/[\s_-]/g, "");

function readNumber(raw: string): number | null {
  const clean = raw.trim();
  if (clean === "") return 0;
  const n = Number(clean);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function parseDaysWorkedCsv(text: string): DaysWorkedParse {
  const rows: DaysWorkedRow[] = [];
  const errors: DaysWorkedError[] = [];
  const seen = new Map<string, number>();

  const lines = text.split(/\r\n|\r|\n/);
  const firstNonBlank = lines.findIndex((l) => l.trim() !== "");
  const hasHeader = firstNonBlank >= 0 && HEADER.test(lines[firstNonBlank]);
  const startAt = hasHeader ? firstNonBlank + 1 : Math.max(firstNonBlank, 0);

  /* Named columns when the file has a header, because the template
     carries a working-days column for the reader — taking "the first
     number on the line" read that as the answer and told everybody they
     had worked more days than the month holds. */
  const header = hasHeader ? lines[firstNonBlank].split(",").map(norm) : [];
  const columnFor = (...names: string[]) => {
    for (const name of names) {
      const at = header.indexOf(norm(name));
      if (at >= 0) return at;
    }
    return -1;
  };
  const daysColumn = hasHeader ? columnFor("daysWorked", "days", "presentDays") : -1;
  const halfColumn = hasHeader ? columnFor("halfDays", "half") : -1;

  for (let i = startAt; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === "") continue;
    if (raw.trimStart().startsWith("#")) continue;
    const lineNo = i + 1;

    const cols = raw.split(",").map((c) => c.trim());
    const empCode = (cols[0] ?? "").toUpperCase();
    if (!empCode) {
      errors.push({ line: lineNo, message: "Missing employee code." });
      continue;
    }

    let daysRaw: string | undefined;
    let halfRaw: string | undefined;
    if (daysColumn >= 0) {
      daysRaw = cols[daysColumn];
      halfRaw = halfColumn >= 0 ? cols[halfColumn] : undefined;
    } else {
      /* No header to go by: a code, perhaps a name, then the numbers. */
      const numeric = cols.slice(1).filter((c) => c !== "" && !Number.isNaN(Number(c)));
      daysRaw = numeric[0];
      halfRaw = numeric[1];
    }

    if (daysRaw === undefined || daysRaw === "") {
      errors.push({
        line: lineNo,
        message: `${empCode} has no number of days on it.`,
      });
      continue;
    }

    const daysWorked = readNumber(daysRaw);
    const halfDays = halfRaw === undefined ? 0 : readNumber(halfRaw);
    if (daysWorked === null || halfDays === null) {
      errors.push({
        line: lineNo,
        message: `${empCode}: days must be a number of zero or more.`,
      });
      continue;
    }

    const earlier = seen.get(empCode);
    if (earlier !== undefined) {
      errors.push({
        line: lineNo,
        message: `${empCode} appears twice — also on line ${earlier}.`,
      });
      continue;
    }
    seen.set(empCode, lineNo);
    rows.push({ empCode, daysWorked, halfDays });
  }

  return { rows, errors };
}

export type DaysWorkedOutcome = {
  lopDays: number;
  paidDays: number;
  /** Set when the figure cannot stand as written. */
  problem: string | null;
};

/**
 * What a count of days worked means for one person's month.
 *
 * Loss of pay is the working days they did not work. Weekly offs and
 * holidays are not working days and stay paid, so they never enter the
 * count and never cost anybody a day.
 */
export function outcomeForDaysWorked(args: {
  /** Working days in the period, inside this person's employment. */
  workingDays: number;
  /** Calendar days the person is employed for in this period. */
  employedDays: number;
  daysWorked: number;
  halfDays: number;
}): DaysWorkedOutcome {
  const worked = args.daysWorked + args.halfDays / 2;

  if (worked > args.workingDays) {
    return {
      lopDays: 0,
      paidDays: args.employedDays,
      problem:
        `${worked} day(s) worked, but the month has only ${args.workingDays} working day(s) ` +
        `for this person — weekly offs and holidays are paid without being counted, so they do not belong in the figure.`,
    };
  }

  const lopDays = Math.round((args.workingDays - worked) * 100) / 100;
  return {
    lopDays,
    paidDays: Math.round((args.employedDays - lopDays) * 100) / 100,
    problem: null,
  };
}
