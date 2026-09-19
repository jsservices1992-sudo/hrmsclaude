import "server-only";

/**
 * Outbound email, or an honest report that there is none.
 *
 * No SDK and no SMTP client: one HTTPS call to a provider that speaks
 * JSON. A mail library is a large dependency and a background queue to
 * carry three transactional messages, and the failure it hides — a
 * provider that quietly stops accepting mail — is the one that matters.
 *
 * Unconfigured is a first-class outcome, not an error. An instance with
 * no provider still has to be able to create accounts; it just says the
 * link has to be passed on by hand, which is exactly what happens today.
 */

export type MailResult =
  | { sent: true }
  | { sent: false; reason: "unconfigured" | "failed"; detail?: string };

export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

export async function sendMail(args: {
  to: string;
  subject: string;
  /** Plain text. These messages carry a link and a sentence; that is all. */
  text: string;
}): Promise<MailResult> {
  if (!mailConfigured()) return { sent: false, reason: "unconfigured" };

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM,
        to: [args.to],
        subject: args.subject,
        text: args.text,
      }),
    });

    if (!response.ok) {
      /* The provider's message names the fault — an unverified sending
         domain, usually — and carries no credential of ours. */
      const detail = (await response.text()).slice(0, 300);
      return { sent: false, reason: "failed", detail };
    }
    return { sent: true };
  } catch (error) {
    return { sent: false, reason: "failed", detail: (error as Error).message };
  }
}

/** A password reset link. Says nothing that would matter if it were sent to the wrong inbox by mistake. */
export function resetEmail(args: { name: string; url: string; expiresInMinutes: number }) {
  return {
    subject: "Reset your Lekha password",
    text: [
      `Hello ${args.name},`,
      "",
      "Someone asked to reset the password on this account. If that was you, choose a new one here:",
      "",
      args.url,
      "",
      `The link works once and expires in ${args.expiresInMinutes} minutes.`,
      "",
      "If you did not ask for this, you can ignore this email — your password has not changed.",
    ].join("\n"),
  };
}

/** The invitation itself. Deliberately short: a link and why it arrived. */
export function inviteEmail(args: {
  name: string;
  companyName: string;
  url: string;
  expiresInDays: number;
}) {
  return {
    subject: `Set up your ${args.companyName} payslip account`,
    text: [
      `Hello ${args.name},`,
      "",
      `${args.companyName} has set up your account for payslips, leave and attendance.`,
      "Choose your own password here:",
      "",
      args.url,
      "",
      `The link works once and expires in ${args.expiresInDays} days.`,
      "Nobody else knows your password, including your HR team.",
      "",
      "If you were not expecting this, tell your HR team.",
    ].join("\n"),
  };
}
