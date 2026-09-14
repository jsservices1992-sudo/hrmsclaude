import type { Paise } from "./money";

/**
 * Rupees in words, Indian style — lakh and crore rather than million.
 *
 * Payslips and cheques carry the amount in words as the human check on
 * the figure, so this reads the way an Indian payslip reads: "Rupees One
 * Lakh Eight Thousand Two Hundred Twenty Nine and Sixty Five Paise Only".
 */

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];

const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
];

/** 0–99 in words. */
function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  const o = ONES[n % 10];
  return o ? `${t} ${o}` : t;
}

/** 0–999 in words. */
function threeDigits(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts = [];
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(" ");
}

/**
 * A whole number in words on the Indian scale: the last three digits
 * stand alone, then every two digits above that is a new place — thousand,
 * lakh, crore, and so on upward.
 */
export function numberToIndianWords(value: number): string {
  if (!Number.isFinite(value)) return "";
  const n = Math.floor(Math.abs(value));
  if (n === 0) return "Zero";

  const parts: string[] = [];
  const last3 = n % 1000;
  let rest = Math.floor(n / 1000);

  // Places above the first three digits go in pairs of two digits.
  const scales = ["Thousand", "Lakh", "Crore", "Arab", "Kharab"];
  const groups: number[] = [];
  while (rest > 0) {
    groups.push(rest % 100);
    rest = Math.floor(rest / 100);
  }

  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue;
    const scale = scales[i];
    // Beyond the named scales, fall back to plain digits rather than
    // inventing a word nobody would recognise.
    parts.push(`${twoDigits(groups[i])}${scale ? ` ${scale}` : ""}`);
  }

  if (last3) parts.push(threeDigits(last3));

  const words = parts.join(" ");
  return value < 0 ? `Minus ${words}` : words;
}

/**
 * A paise amount as the words printed on a payslip, including the
 * "Rupees"/"Paise"/"Only" wrapper.
 */
export function rupeesInWords(paise: Paise): string {
  const negative = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const remainder = abs % 100;

  const parts = [`Rupees ${numberToIndianWords(rupees)}`];
  if (remainder > 0) parts.push(`and ${twoDigits(remainder)} Paise`);
  parts.push("Only");

  const words = parts.join(" ");
  return negative ? `Minus ${words}` : words;
}
