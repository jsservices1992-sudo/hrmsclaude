/**
 * What a salary figure is denominated in.
 *
 * Kept apart from `pay-resolution`, which reads the database to do the
 * conversion. These four names are the vocabulary — an importer needs
 * to validate against them without pulling a database connection into a
 * pure parser, and something that cannot be tested in isolation tends
 * not to be tested at all.
 */
export type PayMode = "gross" | "annual_gross" | "ctc" | "take_home";

export const PAY_MODES: PayMode[] = ["gross", "annual_gross", "ctc", "take_home"];

export function isPayMode(v: string): v is PayMode {
  return (PAY_MODES as string[]).includes(v);
}
