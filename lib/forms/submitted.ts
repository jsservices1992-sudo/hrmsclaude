/**
 * Every text field as it was submitted, for handing back on a refusal.
 *
 * A form that clears itself on the first mistake makes the mistake
 * expensive: twenty fields typed, one PAN mistyped, and all twenty have
 * to be typed again. People learn from that to fill in as little as they
 * can get away with, which is the opposite of what a setup screen is for.
 *
 * Files are left out — a file input cannot be repopulated from script,
 * and pretending otherwise would show a filename that will not be sent.
 */
export function submitted(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of fd.entries()) {
    // React's own action plumbing, not anybody's answer to a question.
    if (typeof value === "string" && !key.startsWith("$ACTION")) {
      out[key] = value;
    }
  }
  return out;
}
