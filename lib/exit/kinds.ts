/**
 * How an employment ends.
 *
 * A plain module rather than a constant exported from the server action
 * beside it: a "use server" file may only export async functions, so a
 * list of options living there compiles cleanly and then fails when the
 * form that needs it is rendered.
 */
export const EXIT_TYPES = [
  { id: "resignation", label: "Resignation" },
  { id: "termination", label: "Termination" },
  { id: "termination_cause", label: "Termination for cause" },
  { id: "probation_termination", label: "Termination during probation" },
  { id: "abscondment", label: "Abscondment" },
  { id: "retirement", label: "Retirement" },
  { id: "contract_end", label: "End of contract" },
  { id: "death_in_service", label: "Death in service" },
] as const;

export type ExitType = (typeof EXIT_TYPES)[number]["id"];

export function isExitType(value: string): value is ExitType {
  return EXIT_TYPES.some((t) => t.id === value);
}
