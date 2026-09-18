import type { Paise } from "../payroll/money";

/**
 * General ledger mapping and journal export — PRD §3.14, FR-BANK-5 and
 * FR-BANK-6.
 *
 * One invariant governs everything here: the journal must balance to the
 * paise. It balances by construction when net pay equals gross less
 * deductions, which the payroll engine guarantees — but "guaranteed
 * upstream" is not a reason to skip the check, because an unbalanced
 * journal posted into a customer's ledger is the most expensive defect
 * this product could ship.
 */

export type AccountType = "expense" | "liability" | "asset";

export type GlAccount = {
  code: string;
  name: string;
  type: AccountType;
};

/** How one payroll line reaches the ledger. */
export type GlMapping = {
  /** Payroll line code — BASIC, EPF_ER, PT, TDS, and so on. */
  componentCode: string;
  /** Where the cost or the reduction is recorded. */
  debitAccount: string | null;
  /** Where the obligation is recorded. */
  creditAccount: string | null;
};

export type Dimension = "none" | "branch" | "department" | "cost_centre";

export type JournalInput = {
  employeeId: string;
  empCode: string;
  branchId: string;
  branchName: string;
  departmentId: string | null;
  departmentName: string | null;
  costCentre: string | null;
  netPaise: Paise;
  /** Payroll lines by code, with their kind. */
  lines: {
    code: string;
    kind: "earning" | "deduction" | "employer_contribution" | "info";
    amountPaise: Paise;
  }[];
};

export type JournalLine = {
  accountCode: string;
  accountName: string;
  dimension: string;
  debitPaise: Paise;
  creditPaise: Paise;
  narration: string;
};

export type Journal = {
  lines: JournalLine[];
  totalDebitPaise: Paise;
  totalCreditPaise: Paise;
  balanced: boolean;
  differencePaise: Paise;
  unmapped: string[];
  warnings: string[];
};

/** The account net pay is owed into until the bank file clears. */
export const NET_PAYABLE_ACCOUNT = "NET_PAYABLE";

/**
 * Where net-pay rounding lands. A company that rounds net to the rupee
 * (FR-SET-4) breaks the identity net = gross − deductions by a few paise
 * an employee. That difference is real money and has to be posted
 * somewhere, or the voucher will not balance.
 */
export const ROUNDING_ACCOUNT = "PAYROLL_ROUNDING";

function dimensionValue(row: JournalInput, dimension: Dimension): string {
  switch (dimension) {
    case "branch":
      return row.branchName;
    case "department":
      return row.departmentName ?? "Unassigned";
    case "cost_centre":
      return row.costCentre ?? "Unassigned";
    default:
      return "—";
  }
}

function resolveByPrefix(code: string): GlMapping | undefined {
  if (code.startsWith("LOAN:")) {
    // Recovering a loan reduces an asset; it is not money held for a
    // third party, so it credits the receivable rather than a payable.
    return {
      componentCode: code,
      debitAccount: null,
      creditAccount: "LOAN_RECEIVABLE",
    };
  }
  return undefined;
}

/**
 * Build the journal voucher for a run.
 *
 * Earnings are a cost: debit salary expense. Employee deductions are not
 * a separate cost — they are already inside gross — so they only move an
 * obligation: credit the relevant payable. Employer contributions are an
 * additional cost: debit expense and credit the payable. What is left
 * over is owed to employees: credit net payable.
 */
export function buildJournal(args: {
  rows: JournalInput[];
  accounts: GlAccount[];
  mappings: GlMapping[];
  dimension: Dimension;
  /** Where an unmapped earning lands, so nothing silently disappears. */
  suspenseAccount?: string;
}): Journal {
  const warnings: string[] = [];
  const unmapped = new Set<string>();

  const accountByCode = new Map(args.accounts.map((a) => [a.code, a]));
  const mappingByCode = new Map(args.mappings.map((m) => [m.componentCode, m]));

  // Key: account + dimension. Postings are aggregated, because a ledger
  // wants one line per account per cost centre, not one per employee.
  const buckets = new Map<
    string,
    { accountCode: string; dimension: string; debit: Paise; credit: Paise }
  >();

  const post = (
    accountCode: string,
    dimension: string,
    debit: Paise,
    credit: Paise,
  ) => {
    const key = `${accountCode}::${dimension}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.debit += debit;
      existing.credit += credit;
    } else {
      buckets.set(key, { accountCode, dimension, debit, credit });
    }
  };

  for (const row of args.rows) {
    const dim = dimensionValue(row, args.dimension);

    for (const line of row.lines) {
      // Informational lines carry no accounting effect by definition.
      if (line.kind === "info") continue;
      if (line.amountPaise === 0) continue;

      // Loan codes carry the loan id, so they resolve by prefix rather
      // than by an exact match that could never be configured.
      const mapping =
        mappingByCode.get(line.code) ?? resolveByPrefix(line.code);

      if (!mapping) {
        unmapped.add(line.code);
        // An unmapped line still has to go somewhere or the journal will
        // not balance. Suspense is visible; silence is not.
        const suspense = args.suspenseAccount ?? "SUSPENSE";
        if (line.kind === "earning" || line.kind === "employer_contribution") {
          post(suspense, dim, line.amountPaise, 0);
        } else {
          post(suspense, dim, 0, line.amountPaise);
        }
        continue;
      }

      if (line.kind === "earning") {
        if (mapping.debitAccount) post(mapping.debitAccount, dim, line.amountPaise, 0);
      } else if (line.kind === "employer_contribution") {
        if (mapping.debitAccount) post(mapping.debitAccount, dim, line.amountPaise, 0);
        if (mapping.creditAccount) post(mapping.creditAccount, dim, 0, line.amountPaise);
      } else {
        // A deduction moves an obligation; it is not a fresh cost.
        if (mapping.creditAccount) post(mapping.creditAccount, dim, 0, line.amountPaise);
      }
    }

    if (row.netPaise !== 0) {
      post(NET_PAYABLE_ACCOUNT, dim, 0, row.netPaise);
    }

    // Net rounding: whatever the payslip's net does not account for.
    const earnings = row.lines
      .filter((l) => l.kind === "earning")
      .reduce((a, l) => a + l.amountPaise, 0);
    const deductions = row.lines
      .filter((l) => l.kind === "deduction")
      .reduce((a, l) => a + l.amountPaise, 0);
    const rounding = row.netPaise - (earnings - deductions);

    if (rounding > 0) {
      // Net was rounded up, so the company is a few paise out of pocket.
      post(ROUNDING_ACCOUNT, dim, rounding, 0);
    } else if (rounding < 0) {
      post(ROUNDING_ACCOUNT, dim, 0, -rounding);
    }
  }

  const lines: JournalLine[] = [...buckets.values()]
    .map((b) => {
      const account = accountByCode.get(b.accountCode);
      if (!account) {
        warnings.push(
          `Account ${b.accountCode} is posted to but not defined in the chart of accounts.`,
        );
      }
      // An account that took both debits and credits shows its net
      // position; a line reading "40 / 40" is noise on a voucher.
      const net = b.debit - b.credit;
      return {
        accountCode: b.accountCode,
        accountName: account?.name ?? b.accountCode,
        dimension: b.dimension,
        debitPaise: net > 0 ? net : 0,
        creditPaise: net < 0 ? -net : 0,
        narration: account?.name ?? b.accountCode,
      };
    })
    .filter((l) => l.debitPaise !== 0 || l.creditPaise !== 0)
    .sort(
      (a, b) =>
        b.debitPaise - a.debitPaise ||
        b.creditPaise - a.creditPaise ||
        a.accountCode.localeCompare(b.accountCode),
    );

  const totalDebit = lines.reduce((a, l) => a + l.debitPaise, 0);
  const totalCredit = lines.reduce((a, l) => a + l.creditPaise, 0);
  const difference = totalDebit - totalCredit;

  if (difference !== 0) {
    warnings.push(
      `The journal does not balance: debits exceed credits by ₹${(difference / 100).toFixed(2)}. This must not be posted. Net-pay rounding is handled through ${ROUNDING_ACCOUNT}, so a remaining difference means a payroll line is genuinely inconsistent.`,
    );
  }

  // Rounding is paise per employee. Anything larger is not rounding, and
  // the journal balancing is then hiding a real inconsistency.
  const roundingLine = lines.find((l) => l.accountCode === ROUNDING_ACCOUNT);
  const roundingTotal = roundingLine
    ? roundingLine.debitPaise + roundingLine.creditPaise
    : 0;
  const plausibleRounding = Math.max(100, args.rows.length * 100);

  if (roundingTotal > plausibleRounding) {
    warnings.push(
      `₹${(roundingTotal / 100).toFixed(2)} has been posted to payroll rounding across ${args.rows.length} employee(s). Rounding should be paise, not rupees — this is a payroll line where net does not equal gross less deductions, and the journal only balances because rounding absorbed it.`,
    );
  }

  if (unmapped.size > 0) {
    warnings.push(
      `${unmapped.size} payroll component(s) have no ledger mapping and have been posted to suspense: ${[...unmapped].join(", ")}. Map them before posting.`,
    );
  }

  return {
    lines,
    totalDebitPaise: totalDebit,
    totalCreditPaise: totalCredit,
    balanced: difference === 0,
    differencePaise: difference,
    unmapped: [...unmapped],
    warnings,
  };
}

/* ==================================================================
   Mid-period movers — FR-BANK-5
   ================================================================== */

export type MoverRule = "full_to_new" | "full_to_old" | "prorate";

export type Mover = {
  employeeId: string;
  empCode: string;
  fromDimension: string;
  toDimension: string;
  /** Day of the month the move took effect. */
  effectiveDay: number;
  daysInMonth: number;
};

/**
 * How an employee's cost is allocated when they move cost centre partway
 * through a period. The PRD asks for a *stated* rule, because leaving it
 * implicit is how two departments both believe they were charged wrongly.
 */
export function allocateMover(args: {
  mover: Mover;
  amountPaise: Paise;
  rule: MoverRule;
}): { dimension: string; amountPaise: Paise; basis: string }[] {
  const { mover, amountPaise, rule } = args;

  if (rule === "full_to_new") {
    return [
      {
        dimension: mover.toDimension,
        amountPaise,
        basis: `Whole month charged to ${mover.toDimension}, the cost centre at period end`,
      },
    ];
  }

  if (rule === "full_to_old") {
    return [
      {
        dimension: mover.fromDimension,
        amountPaise,
        basis: `Whole month charged to ${mover.fromDimension}, the cost centre at period start`,
      },
    ];
  }

  // Prorate by days, with the old centre bearing the days before the move.
  const daysBefore = Math.max(0, Math.min(mover.effectiveDay - 1, mover.daysInMonth));
  const oldShare = Math.round((amountPaise * daysBefore) / mover.daysInMonth);
  const newShare = amountPaise - oldShare;

  return [
    {
      dimension: mover.fromDimension,
      amountPaise: oldShare,
      basis: `${daysBefore} of ${mover.daysInMonth} days`,
    },
    {
      dimension: mover.toDimension,
      amountPaise: newShare,
      basis: `${mover.daysInMonth - daysBefore} of ${mover.daysInMonth} days`,
    },
  ].filter((x) => x.amountPaise !== 0);
}

/* ==================================================================
   Exports — FR-BANK-6
   ================================================================== */

function csvField(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function journalToCsv(journal: Journal, reference: string): string {
  const headers = [
    "Voucher",
    "Account Code",
    "Account Name",
    "Dimension",
    "Debit",
    "Credit",
    "Narration",
  ];
  const rows = journal.lines.map((l) =>
    [
      reference,
      l.accountCode,
      l.accountName,
      l.dimension,
      (l.debitPaise / 100).toFixed(2),
      (l.creditPaise / 100).toFixed(2),
      l.narration,
    ]
      .map(csvField)
      .join(","),
  );
  return [headers.join(","), ...rows].join("\n") + "\n";
}

/** XML text has to be escaped, or a name with an ampersand breaks the import. */
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Tally expects DD-MMM-YYYY, not ISO. */
export function tallyDate(isoDate: string): string {
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const [y, m, d] = isoDate.split("-");
  return `${d}-${months[Number(m) - 1]}-${y}`;
}

/**
 * Tally XML. A journal that does not balance is refused rather than
 * exported: Tally would reject it anyway, and a rejected import at the
 * customer's end is a worse way to find out.
 */
export function journalToTallyXml(args: {
  journal: Journal;
  companyName: string;
  voucherDate: string;
  narration: string;
}): { xml: string; refused: boolean; reason: string | null } {
  if (!args.journal.balanced) {
    return {
      xml: "",
      refused: true,
      reason: `The journal is out by ₹${(args.journal.differencePaise / 100).toFixed(2)} and has not been exported.`,
    };
  }

  const entries = args.journal.lines
    .map((l) => {
      // Tally's sign convention: debits negative, credits positive.
      const amount =
        l.debitPaise > 0
          ? -(l.debitPaise / 100)
          : l.creditPaise / 100;
      return `        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${xmlEscape(l.accountName)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>${l.debitPaise > 0 ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
          <AMOUNT>${amount.toFixed(2)}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>`;
    })
    .join("\n");

  const xml = `<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${xmlEscape(args.companyName)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE>
          <VOUCHER VCHTYPE="Journal" ACTION="Create">
            <DATE>${tallyDate(args.voucherDate)}</DATE>
            <NARRATION>${xmlEscape(args.narration)}</NARRATION>
            <VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>
${entries}
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>
`;

  return { xml, refused: false, reason: null };
}

/* ==================================================================
   Default chart — a starting point, not a prescription
   ================================================================== */

export const DEFAULT_ACCOUNTS: GlAccount[] = [
  { code: "SALARY_EXPENSE", name: "Salaries and wages", type: "expense" },
  { code: "EMPLOYER_PF", name: "Employer provident fund", type: "expense" },
  { code: "EMPLOYER_ESIC", name: "Employer ESIC", type: "expense" },
  { code: "EMPLOYER_LWF", name: "Employer labour welfare fund", type: "expense" },
  { code: "PF_PAYABLE", name: "Provident fund payable", type: "liability" },
  { code: "ESIC_PAYABLE", name: "ESIC payable", type: "liability" },
  { code: "PT_PAYABLE", name: "Professional tax payable", type: "liability" },
  { code: "LWF_PAYABLE", name: "Labour welfare fund payable", type: "liability" },
  { code: "TDS_PAYABLE", name: "TDS payable", type: "liability" },
  { code: NET_PAYABLE_ACCOUNT, name: "Salaries payable", type: "liability" },
  { code: "LOAN_RECEIVABLE", name: "Employee loans receivable", type: "asset" },
  { code: ROUNDING_ACCOUNT, name: "Payroll rounding", type: "expense" },
  { code: "SUSPENSE", name: "Payroll suspense", type: "liability" },
];

export const DEFAULT_MAPPINGS: GlMapping[] = [
  { componentCode: "BASIC", debitAccount: "SALARY_EXPENSE", creditAccount: null },
  { componentCode: "HRA", debitAccount: "SALARY_EXPENSE", creditAccount: null },
  { componentCode: "CONV", debitAccount: "SALARY_EXPENSE", creditAccount: null },
  { componentCode: "MED", debitAccount: "SALARY_EXPENSE", creditAccount: null },
  { componentCode: "SPL", debitAccount: "SALARY_EXPENSE", creditAccount: null },

  { componentCode: "EPF_EE", debitAccount: null, creditAccount: "PF_PAYABLE" },
  { componentCode: "VPF", debitAccount: null, creditAccount: "PF_PAYABLE" },
  { componentCode: "ESIC_EE", debitAccount: null, creditAccount: "ESIC_PAYABLE" },
  { componentCode: "PT", debitAccount: null, creditAccount: "PT_PAYABLE" },
  { componentCode: "LWF_EE", debitAccount: null, creditAccount: "LWF_PAYABLE" },
  { componentCode: "TDS", debitAccount: null, creditAccount: "TDS_PAYABLE" },

  { componentCode: "EPF_ER", debitAccount: "EMPLOYER_PF", creditAccount: "PF_PAYABLE" },
  { componentCode: "EPS_ER", debitAccount: "EMPLOYER_PF", creditAccount: "PF_PAYABLE" },
  { componentCode: "ESIC_ER", debitAccount: "EMPLOYER_ESIC", creditAccount: "ESIC_PAYABLE" },
  { componentCode: "LWF_ER", debitAccount: "EMPLOYER_LWF", creditAccount: "LWF_PAYABLE" },

  /*
   * Net-pay rounding. The account existed and nothing pointed at it, so
   * every run of every company reported ROUND_OFF as unmapped and put a
   * few paise in suspense — a "map this before posting" on a journal
   * that was already correct.
   *
   * The reconciliation below that also posts to this account finds
   * nothing to do once this mapping exists: it measures net against
   * earnings less deductions, and the ROUND_OFF line is one of those
   * deductions, so the difference is already zero. The two were never
   * meant to both fire.
   *
   * The amount is signed — a credit of a negative number is a debit — so
   * one mapping covers a net rounded up and a net rounded down.
   */
  { componentCode: "ROUND_OFF", debitAccount: null, creditAccount: ROUNDING_ACCOUNT },
];

