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

/**
 * What to do about a notice period that was not fully served.
 *
 * Here rather than beside the action that saves it, for the same reason
 * the exit types are: a "use server" module may only export async
 * functions, so a list of options living there builds cleanly and fails
 * when the form importing it renders.
 */
export const NOTICE_TREATMENTS = [
  {
    id: "recover",
    label: "Recover the shortfall",
    hint: "The default. Days short of the required notice are deducted from the settlement.",
  },
  {
    id: "waive",
    label: "Waive it — recover nothing",
    hint: "The company is letting the shortfall go. Needs a reason, and who approved it is recorded.",
  },
  {
    id: "employer_pays",
    label: "Employer pays in lieu",
    hint: "The company ended the employment and is paying the notice instead of asking them to serve it.",
  },
] as const;

export type NoticeTreatment = (typeof NOTICE_TREATMENTS)[number]["id"];

export function isNoticeTreatment(value: string): value is NoticeTreatment {
  return NOTICE_TREATMENTS.some((t) => t.id === value);
}
