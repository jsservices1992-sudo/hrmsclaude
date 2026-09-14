/**
 * The CSV reading every import shares.
 *
 * Columns are matched by name, not position: a spreadsheet that has
 * been through somebody's hands rarely keeps the original order, and a
 * re-uploaded export should still work. Comment lines are skipped so a
 * template can carry its own instructions and still import cleanly
 * whether or not they are deleted.
 */

export type CsvProblem = {
  line: number;
  column: string;
  message: string;
  /** Where to go and fix it, when the fix is elsewhere in the product. */
  fix?: { label: string; href: string };
  /** How many rows share this problem, once collapsed. */
  rows?: number;
};

/** Splits one line, honouring double quotes around commas. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur.trim());
  return out;
}

const normalise = (h: string) => h.toLowerCase().replace(/[\s_-]/g, "");

export type CsvTable = {
  /** A reader per row: `get("empCode")` is null when blank or absent. */
  rows: { line: number; get: (column: string) => string | null }[];
  problems: CsvProblem[];
};

/**
 * Reads a CSV into named rows, or explains why it cannot.
 *
 * `required` names the columns without which the file is not the file
 * it claims to be — their absence is reported once, against the header,
 * rather than as an error on every row.
 */
export function readCsv(text: string, required: readonly string[]): CsvTable {
  const lines = text.split(/\r\n|\r|\n/);
  const firstNonBlank = lines.findIndex((l) => l.trim() !== "" && !l.trimStart().startsWith("#"));
  if (firstNonBlank < 0) {
    return { rows: [], problems: [{ line: 1, column: "", message: "The file is empty." }] };
  }

  const header = splitCsvLine(lines[firstNonBlank]).map(normalise);
  const index = (column: string) => header.indexOf(normalise(column));

  const missing = required.filter((c) => index(c) < 0);
  if (missing.length > 0) {
    return {
      rows: [],
      problems: [
        {
          line: firstNonBlank + 1,
          column: missing.join(", "),
          message:
            header.length <= 1
              ? `The first row must name the columns. It needs at least: ${required.join(", ")}.`
              : `These required columns are missing: ${missing.join(", ")}.`,
        },
      ],
    };
  }

  const rows: CsvTable["rows"] = [];
  for (let i = firstNonBlank + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === "") continue;
    /* A template carries a commented example and a reference block, so
       the file imports whether or not they are deleted. */
    if (raw.trimStart().startsWith("#")) continue;
    const cols = splitCsvLine(raw);
    rows.push({
      line: i + 1,
      get(column: string) {
        const at = index(column);
        const v = at >= 0 ? (cols[at] ?? "").trim() : "";
        return v === "" ? null : v;
      },
    });
  }

  if (rows.length === 0) {
    return { rows, problems: [{ line: 1, column: "", message: "The file has a header but no rows." }] };
  }

  return { rows, problems: [] };
}

/**
 * One problem per cause, not per row.
 *
 * A single wrong code repeated down 82 rows is one thing to fix. Left
 * uncollapsed the list says it 82 times and buries everything else.
 */
export function collapseProblems(problems: CsvProblem[]): CsvProblem[] {
  const seen = new Map<string, CsvProblem & { rows: number }>();
  for (const p of problems) {
    const key = `${p.column}::${p.message}`;
    const hit = seen.get(key);
    if (hit) hit.rows += 1;
    else seen.set(key, { ...p, rows: 1 });
  }
  return [...seen.values()].sort((a, b) => a.line - b.line);
}

/** A rupee figure as people type it: blanks, commas and a stray symbol. */
export function parseRupees(raw: string): { ok: true; paise: number } | { ok: false; error: string } {
  const text = raw.trim().replace(/[₹,\s]/g, "");
  if (text === "") return { ok: false, error: "An amount is required." };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    return { ok: false, error: `"${raw.trim()}" is not an amount in rupees.` };
  }
  const rupees = Number(text);
  if (rupees <= 0) return { ok: false, error: "An amount must be more than zero." };
  if (rupees > 1_000_000_000) return { ok: false, error: "That amount looks like a typo — check it." };
  return { ok: true, paise: Math.round(rupees * 100) };
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
