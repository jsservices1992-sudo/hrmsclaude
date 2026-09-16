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

/**
 * Which figure a salary is pinned to, and which ones therefore move.
 *
 * Only take-home pins the bottom line: the gross and the CTC above it are
 * re-solved every period against that period's statutory rates, so the net
 * in hand holds. Every other mode pins a figure above the deductions, and
 * the net is whatever is left after them — so it moves when they do.
 */
export function payModeSummary(mode: PayMode | null): {
  label: string;
  holds: "net" | "gross" | "ctc" | null;
  note: string;
} {
  switch (mode) {
    case "take_home":
      return {
        label: "Net in hand",
        holds: "net",
        note: "The net in hand is held. Gross and CTC are re-solved each period against that period's PF, ESIC, professional tax and labour welfare fund, so the amount that reaches the bank does not drift.",
      };
    case "ctc":
      return {
        label: "Annual CTC",
        holds: "ctc",
        note: "The CTC is held. The net in hand moves with PF, ESIC, professional tax and labour welfare fund as those change.",
      };
    case "annual_gross":
      return {
        label: "Annual gross",
        holds: "gross",
        note: "The gross is held. The net in hand moves with PF, ESIC, professional tax and labour welfare fund as those change.",
      };
    case "gross":
      return {
        label: "Monthly gross",
        holds: "gross",
        note: "The gross is held. The net in hand moves with PF, ESIC, professional tax and labour welfare fund as those change.",
      };
    default:
      return {
        label: "—",
        holds: null,
        note: "This salary was recorded before the basis was kept, so it behaves as a held gross. Revising it records the basis.",
      };
  }
}
