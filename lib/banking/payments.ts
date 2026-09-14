import type { Paise } from "../payroll/money";

/**
 * Turning an approved run into payment instructions — PRD §3.14,
 * FR-BANK-1 and FR-BANK-2.
 *
 * Two things have to hold absolutely. What is instructed must equal what
 * was computed, to the paise; and an employee paid by cash or cheque must
 * be excluded from the electronic file *and* still accounted for, rather
 * than dropping out of both.
 */

export type PaymentMode = "bank_transfer" | "cash" | "cheque";

export type Allocation =
  | { kind: "remainder" }
  | { kind: "fixed"; amountPaise: Paise }
  | { kind: "percent"; bps: number };

export type EmployeeAccount = {
  accountId: string;
  accountNumber: string;
  ifsc: string;
  accountHolderName: string;
  allocation: Allocation;
  sequence: number;
};

export type Payee = {
  employeeId: string;
  empCode: string;
  name: string;
  netPaise: Paise;
  mode: PaymentMode;
  accounts: EmployeeAccount[];
};

export type PaymentInstruction = {
  employeeId: string;
  empCode: string;
  name: string;
  accountId: string;
  accountNumber: string;
  ifsc: string;
  accountHolderName: string;
  amountPaise: Paise;
  /** True where the employee banks with the disbursing bank itself. */
  sameBank: boolean;
  warnings: string[];
};

export type NonElectronicPayment = {
  employeeId: string;
  empCode: string;
  name: string;
  amountPaise: Paise;
  mode: "cash" | "cheque";
};

export type PaymentRun = {
  instructions: PaymentInstruction[];
  /** Cash and cheque payees — excluded from the file, not from the books. */
  nonElectronic: NonElectronicPayment[];
  electronicTotalPaise: Paise;
  nonElectronicTotalPaise: Paise;
  totalPaise: Paise;
  sameBankCount: number;
  interBankCount: number;
  warnings: string[];
  /** Payees who cannot be paid at all until something is fixed. */
  blocked: { empCode: string; reason: string }[];
};

/** 4 letters for the bank, a zero, then six characters for the branch. */
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export function validateIfsc(ifsc: string | null | undefined): boolean {
  return Boolean(ifsc && IFSC_RE.test(ifsc.trim().toUpperCase()));
}

export function bankCodeOf(ifsc: string): string {
  return ifsc.trim().toUpperCase().slice(0, 4);
}

/**
 * Apportion net pay across an employee's accounts.
 *
 * Fixed amounts are honoured first, then percentages of net, and the
 * remainder account takes whatever is left. The parts always sum to net
 * exactly — an employee whose instructions total a rupee less than their
 * payslip is a support call and a trust problem.
 */
export function splitNetPay(
  netPaise: Paise,
  accounts: EmployeeAccount[],
): { splits: { accountId: string; amountPaise: Paise }[]; warnings: string[] } {
  const warnings: string[] = [];
  if (accounts.length === 0) return { splits: [], warnings };

  const ordered = [...accounts].sort((a, b) => a.sequence - b.sequence);
  const splits: { accountId: string; amountPaise: Paise }[] = [];
  let remaining = netPaise;

  for (const account of ordered) {
    if (account.allocation.kind === "remainder") continue;

    let amount =
      account.allocation.kind === "fixed"
        ? account.allocation.amountPaise
        : Math.round((netPaise * account.allocation.bps) / 10000);

    // Never instruct more than is actually payable.
    if (amount > remaining) {
      warnings.push(
        `The split for ${account.accountNumber.slice(-4)} asks for ₹${(amount / 100).toFixed(2)} but only ₹${(remaining / 100).toFixed(2)} of net pay is left; it has been reduced.`,
      );
      amount = Math.max(0, remaining);
    }

    splits.push({ accountId: account.accountId, amountPaise: amount });
    remaining -= amount;
  }

  const remainderAccounts = ordered.filter(
    (a) => a.allocation.kind === "remainder",
  );

  if (remainderAccounts.length === 0) {
    // Without a remainder account the balance has nowhere to go, so the
    // last account absorbs it rather than the money vanishing.
    if (remaining !== 0 && splits.length > 0) {
      warnings.push(
        `No account is set to take the remainder, so ₹${(remaining / 100).toFixed(2)} has been added to the last account. Nominate a remainder account to make this explicit.`,
      );
      splits[splits.length - 1].amountPaise += remaining;
      remaining = 0;
    }
  } else {
    if (remainderAccounts.length > 1) {
      warnings.push(
        "More than one account is marked as taking the remainder; the first in sequence has been used.",
      );
    }
    splits.push({
      accountId: remainderAccounts[0].accountId,
      amountPaise: remaining,
    });
    remaining = 0;
  }

  return { splits: splits.filter((s) => s.amountPaise !== 0), warnings };
}

export function buildPaymentRun(args: {
  payees: Payee[];
  /** IFSC of the account the money leaves from. */
  disbursingIfsc: string;
  /** Some formats cap the beneficiary name; 0 means no cap. */
  nameMaxLength?: number;
}): PaymentRun {
  const warnings: string[] = [];
  const blocked: { empCode: string; reason: string }[] = [];
  const instructions: PaymentInstruction[] = [];
  const nonElectronic: NonElectronicPayment[] = [];

  const disbursingBank = bankCodeOf(args.disbursingIfsc);
  const nameCap = args.nameMaxLength ?? 0;

  for (const payee of args.payees) {
    if (payee.netPaise < 0) {
      blocked.push({
        empCode: payee.empCode,
        reason: `Net pay is negative (₹${(payee.netPaise / 100).toFixed(2)}). A run cannot instruct a payment that takes money back.`,
      });
      continue;
    }

    if (payee.netPaise === 0) {
      // Nothing to pay is not an error; it just does not belong in a file.
      continue;
    }

    if (payee.mode !== "bank_transfer") {
      nonElectronic.push({
        employeeId: payee.employeeId,
        empCode: payee.empCode,
        name: payee.name,
        amountPaise: payee.netPaise,
        mode: payee.mode,
      });
      continue;
    }

    if (payee.accounts.length === 0) {
      blocked.push({
        empCode: payee.empCode,
        reason: "No bank account is on record.",
      });
      continue;
    }

    const { splits, warnings: splitWarnings } = splitNetPay(
      payee.netPaise,
      payee.accounts,
    );
    for (const w of splitWarnings) warnings.push(`${payee.empCode}: ${w}`);

    const byId = new Map(payee.accounts.map((a) => [a.accountId, a]));
    let payeeBlocked = false;

    for (const split of splits) {
      const account = byId.get(split.accountId)!;
      const lineWarnings: string[] = [];

      if (!validateIfsc(account.ifsc)) {
        blocked.push({
          empCode: payee.empCode,
          reason: `IFSC "${account.ifsc}" is not a valid code.`,
        });
        payeeBlocked = true;
        break;
      }

      if (!account.accountNumber || !/^\d{5,20}$/.test(account.accountNumber)) {
        blocked.push({
          empCode: payee.empCode,
          reason: `Account number "${account.accountNumber}" does not look like a bank account.`,
        });
        payeeBlocked = true;
        break;
      }

      let holderName = account.accountHolderName.trim();
      if (nameCap > 0 && holderName.length > nameCap) {
        holderName = holderName.slice(0, nameCap);
        lineWarnings.push(
          `Beneficiary name truncated to ${nameCap} characters for this format.`,
        );
      }

      instructions.push({
        employeeId: payee.employeeId,
        empCode: payee.empCode,
        name: payee.name,
        accountId: account.accountId,
        accountNumber: account.accountNumber,
        ifsc: account.ifsc.trim().toUpperCase(),
        accountHolderName: holderName,
        amountPaise: split.amountPaise,
        sameBank: bankCodeOf(account.ifsc) === disbursingBank,
        warnings: lineWarnings,
      });
    }

    if (payeeBlocked) {
      // Remove any partial instructions written for this payee.
      for (let i = instructions.length - 1; i >= 0; i--) {
        if (instructions[i].employeeId === payee.employeeId) {
          instructions.splice(i, 1);
        }
      }
    }
  }

  const electronicTotal = instructions.reduce((a, i) => a + i.amountPaise, 0);
  const nonElectronicTotal = nonElectronic.reduce(
    (a, i) => a + i.amountPaise,
    0,
  );

  if (blocked.length > 0) {
    warnings.push(
      `${blocked.length} employee(s) cannot be paid until their details are corrected. They are excluded from the file and the total below.`,
    );
  }

  return {
    instructions,
    nonElectronic,
    electronicTotalPaise: electronicTotal,
    nonElectronicTotalPaise: nonElectronicTotal,
    totalPaise: electronicTotal + nonElectronicTotal,
    sameBankCount: instructions.filter((i) => i.sameBank).length,
    interBankCount: instructions.filter((i) => !i.sameBank).length,
    warnings,
    blocked,
  };
}

/**
 * The instructed total must equal what the run computed. A file that pays
 * a different amount from the register is the worst possible defect here,
 * so it is checked rather than assumed.
 */
export function reconcilePaymentRun(args: {
  run: PaymentRun;
  registerNetPaise: Paise;
}): { matches: boolean; differencePaise: Paise; note: string } {
  const difference = args.run.totalPaise - args.registerNetPaise;

  if (difference === 0) {
    return {
      matches: true,
      differencePaise: 0,
      note: "Instructed payments equal the net pay on the register.",
    };
  }

  const blockedTotal = args.run.blocked.length;
  return {
    matches: false,
    differencePaise: difference,
    note:
      blockedTotal > 0
        ? `Instructions fall ₹${(Math.abs(difference) / 100).toFixed(2)} short of the register because ${blockedTotal} employee(s) are blocked. Correct their details and regenerate — do not release a partial file as final.`
        : `Instructions differ from the register by ₹${(Math.abs(difference) / 100).toFixed(2)} with nothing blocked. Do not release this file.`,
  };
}

/* ==================================================================
   File formats — FR-BANK-1
   ================================================================== */

export type BankFormat = "generic_csv" | "neft" | "rtgs" | "hdfc" | "icici";

export const FORMAT_LABELS: Record<BankFormat, string> = {
  generic_csv: "Generic CSV",
  neft: "NEFT",
  rtgs: "RTGS",
  hdfc: "HDFC Bank",
  icici: "ICICI Bank",
};

/**
 * RTGS has a floor — below it the transfer must go by NEFT. Filing a
 * sub-threshold payment as RTGS gets the line rejected.
 */
export const RTGS_MINIMUM_PAISE = 20_000_00;

function csvField(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rupees(paise: Paise): string {
  return (paise / 100).toFixed(2);
}

export type FormattedFile = {
  format: BankFormat;
  filename: string;
  content: string;
  lineCount: number;
  totalPaise: Paise;
  warnings: string[];
};

export function formatBankFile(args: {
  format: BankFormat;
  instructions: PaymentInstruction[];
  companyName: string;
  debitAccountNumber: string;
  valueDate: string;
  reference: string;
}): FormattedFile {
  const warnings: string[] = [];
  const { instructions } = args;

  if (args.format === "rtgs") {
    const belowFloor = instructions.filter(
      (i) => i.amountPaise < RTGS_MINIMUM_PAISE,
    );
    if (belowFloor.length > 0) {
      warnings.push(
        `${belowFloor.length} payment(s) are below the ₹${RTGS_MINIMUM_PAISE / 100} RTGS floor and will be rejected. Send those by NEFT instead: ${belowFloor.map((i) => i.empCode).join(", ")}.`,
      );
    }
  }

  const rows: string[] = [];
  let headers: string[];

  switch (args.format) {
    case "hdfc":
      // Fixed column order the bank's bulk-upload template expects.
      headers = [
        "Transaction Type",
        "Beneficiary Code",
        "Beneficiary Account Number",
        "Beneficiary Name",
        "Amount",
        "Debit Account Number",
        "IFSC",
        "Value Date",
        "Remarks",
      ];
      for (const i of instructions) {
        rows.push(
          [
            i.sameBank ? "I" : "N",
            i.empCode,
            i.accountNumber,
            i.accountHolderName,
            rupees(i.amountPaise),
            args.debitAccountNumber,
            i.ifsc,
            args.valueDate,
            args.reference,
          ]
            .map(csvField)
            .join(","),
        );
      }
      break;

    case "icici":
      headers = [
        "PYMT_MODE",
        "DEBIT_ACC_NO",
        "BNF_NAME",
        "BENE_ACC_NO",
        "BENE_IFSC",
        "AMOUNT",
        "DEBIT_NARR",
        "CREDIT_NARR",
        "PYMT_DATE",
      ];
      for (const i of instructions) {
        rows.push(
          [
            i.sameBank ? "I" : "N",
            args.debitAccountNumber,
            i.accountHolderName,
            i.accountNumber,
            i.ifsc,
            rupees(i.amountPaise),
            args.reference,
            `Salary ${args.reference}`,
            args.valueDate,
          ]
            .map(csvField)
            .join(","),
        );
      }
      break;

    case "neft":
    case "rtgs":
      headers = [
        "Payment Mode",
        "Beneficiary Name",
        "Beneficiary Account Number",
        "IFSC",
        "Amount",
        "Value Date",
        "Reference",
      ];
      for (const i of instructions) {
        rows.push(
          [
            args.format.toUpperCase(),
            i.accountHolderName,
            i.accountNumber,
            i.ifsc,
            rupees(i.amountPaise),
            args.valueDate,
            args.reference,
          ]
            .map(csvField)
            .join(","),
        );
      }
      break;

    default:
      headers = [
        "Employee Code",
        "Beneficiary Name",
        "Account Number",
        "IFSC",
        "Amount",
        "Transfer Type",
        "Value Date",
        "Reference",
      ];
      for (const i of instructions) {
        rows.push(
          [
            i.empCode,
            i.accountHolderName,
            i.accountNumber,
            i.ifsc,
            rupees(i.amountPaise),
            i.sameBank ? "INTERNAL" : "NEFT",
            args.valueDate,
            args.reference,
          ]
            .map(csvField)
            .join(","),
        );
      }
  }

  const total = instructions.reduce((a, i) => a + i.amountPaise, 0);

  return {
    format: args.format,
    filename: `${args.format}-${args.reference}.csv`,
    content: [headers.join(","), ...rows].join("\n") + "\n",
    lineCount: rows.length,
    totalPaise: total,
    warnings,
  };
}
