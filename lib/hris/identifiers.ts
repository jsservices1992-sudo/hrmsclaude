/**
 * The identifiers that have one correct shape: mobile, PAN, UAN, IFSC
 * and a bank account number.
 *
 * Every one of these is copied off a passbook, a cheque leaf or a card,
 * and it arrives with the spacing that was printed on it — "9876 543210",
 * "HDFC 0000123", "+91 98765-43210". None of that is a mistake anybody
 * made; it is how the number is written down. Rejecting it and asking
 * for the same digits again teaches nothing, so the separators are
 * removed and the result is judged on its digits alone.
 *
 * What is not forgiven is a wrong number. An IFSC that is not eleven
 * characters in the one shape the RBI issues, or an account number with
 * a letter in it, will fail at the bank with a file full of other
 * people's salaries — and by then it is a returned payment, not a
 * validation message.
 *
 * Both the console forms and the CSV import go through here, so a
 * number typed in is held to exactly the standard of one uploaded.
 */

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const MOBILE_RE = /^[6-9][0-9]{9}$/;
export const UAN_RE = /^[0-9]{12}$/;
export const BANK_ACCOUNT_RE = /^[0-9]{9,18}$/;

export const IDENTIFIER_MESSAGES = {
  mobile: "Mobile must be 10 digits starting 6, 7, 8 or 9.",
  pan: "PAN must look like ABCDE1234F.",
  uan: "UAN must be 12 digits.",
  ifsc: "IFSC must look like HDFC0000123 — four letters, a zero, then six more.",
  bankAccount: "A bank account number is 9 to 18 digits.",
  ifscMissing: "An account number without an IFSC cannot be paid into.",
} as const;

const blank = (v: string | null | undefined) => v === null || v === undefined || v.trim() === "";

/**
 * Strips the separators a number is printed with: spaces of every kind,
 * hyphens and the dots some passbooks use.
 */
function strip(value: string): string {
  return value.replace(/[\s   .\-]/g, "");
}

/**
 * A ten-digit Indian mobile. The country code is removed whether it
 * arrives as +91, 0091 or 91, and a leading trunk 0 goes too — all four
 * are the same number, and only one of them fits in the column.
 */
export function normaliseMobile(value: string | null | undefined): string | null {
  if (blank(value)) return null;
  let digits = strip(value!).replace(/^\+/, "");
  if (digits.startsWith("0091")) digits = digits.slice(4);
  else if (digits.length > 10 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return digits;
}

export function normalisePan(value: string | null | undefined): string | null {
  return blank(value) ? null : strip(value!).toUpperCase();
}

export function normaliseUan(value: string | null | undefined): string | null {
  return blank(value) ? null : strip(value!);
}

export function normaliseIfsc(value: string | null | undefined): string | null {
  return blank(value) ? null : strip(value!).toUpperCase();
}

export function normaliseBankAccount(value: string | null | undefined): string | null {
  return blank(value) ? null : strip(value!);
}

/**
 * Input attributes for these fields, so the keyboard, the casing and
 * the length behave before anything is submitted. Pure, and imported by
 * client components as well as server actions.
 *
 * These help the typing; they do not do the validating. Anything pasted
 * is still normalised and checked on the server, because an attribute
 * is a suggestion to a browser and not a rule about data.
 */
export const IDENTIFIER_INPUT = {
  mobile: {
    inputMode: "numeric" as const,
    autoComplete: "tel-national",
    maxLength: 10,
    placeholder: "9876543210",
  },
  pan: {
    autoCapitalize: "characters" as const,
    spellCheck: false,
    maxLength: 10,
    placeholder: "ABCDE1234F",
    style: { textTransform: "uppercase" as const },
  },
  uan: {
    inputMode: "numeric" as const,
    maxLength: 12,
    placeholder: "123456789012",
  },
  ifsc: {
    autoCapitalize: "characters" as const,
    spellCheck: false,
    maxLength: 11,
    placeholder: "HDFC0000123",
    style: { textTransform: "uppercase" as const },
  },
  bankAccount: {
    inputMode: "numeric" as const,
    autoComplete: "off",
    maxLength: 18,
    placeholder: "9 to 18 digits",
  },
} as const;
