/**
 * Self-serve company registration.
 *
 * Someone arrives with no account and leaves with a company and an
 * administrator of it. That makes this the one unauthenticated path in
 * the product that creates privileged access, so the rules are here,
 * pure and tested, rather than scattered through a form handler.
 *
 * Two things it deliberately cannot do. It never joins an existing
 * company — "sign up with a company name that already exists" is how
 * one tenant walks into another's payroll. And the administrator it
 * creates is scoped to the company it just made, never tenant-wide:
 * `companyId === null` means "every company in this instance", which is
 * right for a self-hosted install bootstrapped from the command line
 * and catastrophic for a shared one.
 */

export type SignupDraft = {
  companyName: string;
  adminName: string;
  email: string;
  password: string;
  confirmPassword: string;
};

export type SignupIssue = { field: keyof SignupDraft; message: string };

/** Long enough to resist guessing; nothing else, because arbitrary
    character classes push people towards Passw0rd! and a sticky note. */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Passwords that are long but worthless. Not a substitute for a real
 * breach list — it catches the handful that a payroll administrator
 * should never be allowed to choose.
 */
const OBVIOUS_PASSWORDS = new Set([
  "password1234",
  "passwordpassword",
  "123456789012",
  "qwertyuiop12",
  "administrator",
  "letmeinplease",
  "welcome123456",
  "companyname12",
]);

export function checkPassword(password: string, context: { email?: string; companyName?: string } = {}): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters. Length is what protects a password, not punctuation.`;
  }
  if (password.length > 200) return "That password is too long.";

  const lower = password.toLowerCase();
  if (OBVIOUS_PASSWORDS.has(lower)) {
    return "That is one of the first passwords anyone would try.";
  }
  if (/^(.)\1+$/.test(password)) {
    return "That is the same character repeated.";
  }

  const local = context.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) {
    return "Your password should not contain your email address.";
  }
  const company = context.companyName?.toLowerCase().replace(/[^a-z0-9]/g, "");
  const squashed = lower.replace(/[^a-z0-9]/g, "");
  if (company && company.length >= 5 && squashed.includes(company)) {
    return "Your password should not contain your company's name.";
  }
  return null;
}

/** Normalised once, so the same address cannot register twice in two cases. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normaliseCompanyName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function checkSignup(draft: SignupDraft): SignupIssue[] {
  const issues: SignupIssue[] = [];

  const companyName = normaliseCompanyName(draft.companyName);
  if (companyName.length < 2) {
    issues.push({ field: "companyName", message: "Enter your company's name." });
  } else if (companyName.length > 160) {
    issues.push({ field: "companyName", message: "That company name is too long." });
  }

  if (!draft.adminName.trim()) {
    issues.push({ field: "adminName", message: "Enter your name." });
  }

  const email = normaliseEmail(draft.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    issues.push({ field: "email", message: "That is not an email address." });
  }

  const passwordProblem = checkPassword(draft.password, { email, companyName });
  if (passwordProblem) {
    issues.push({ field: "password", message: passwordProblem });
  } else if (draft.password !== draft.confirmPassword) {
    issues.push({ field: "confirmPassword", message: "The two passwords do not match." });
  }

  return issues;
}

/**
 * Whether self-serve registration is open on this instance.
 *
 * A shared deployment wants it open — that is the product. A company
 * running Lekha for itself wants it shut, because an open door that
 * mints administrators is not a feature there. Enabled unless switched
 * off, and the switch is explicit in the environment.
 */
export function signupEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const value = (env.SIGNUP_ENABLED ?? "").trim().toLowerCase();
  return value !== "false" && value !== "0" && value !== "off";
}
