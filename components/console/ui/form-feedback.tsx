export type ActionState = { ok?: string; error?: string };

export function FormFeedback({ state }: { state: ActionState }) {
  if (state.error) return <p className="text-xs text-rust max-w-[60ch]">{state.error}</p>;
  if (state.ok) return <p className="text-xs text-teal max-w-[60ch]">{state.ok}</p>;
  return null;
}
