export type ActionState = {
  ok?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
};

/**
 * What the last submission did, and — where it was refused — which fields
 * are the reason.
 *
 * "Fix the highlighted fields" is only useful on a form short enough to
 * take in at a glance. On a company record of twenty fields across four
 * cards, naming them here is the difference between one scroll and four.
 */
export function FormFeedback({
  state,
  labels,
}: {
  state: ActionState;
  /** Field name to what the form calls it, for the summary. */
  labels?: Record<string, string>;
}) {
  const fields = Object.entries(state.fieldErrors ?? {});

  if (state.error) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-xs text-rust max-w-[60ch]">{state.error}</p>
        {fields.length > 0 && (
          <ul className="text-xs text-rust flex flex-wrap gap-x-4 gap-y-0.5 max-w-[70ch]">
            {fields.map(([name, message]) => (
              <li key={name}>
                <span className="font-medium">{labels?.[name] ?? name}</span>
                {" — "}
                {message}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (state.ok) return <p className="text-xs text-teal max-w-[60ch]">{state.ok}</p>;
  return null;
}
