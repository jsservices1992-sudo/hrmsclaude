import Link from "next/link";

/**
 * What a payroll run produces, in one place.
 *
 * Every one of these surfaces existed already and nothing linked to them,
 * so finishing a run left you at a dead end. An output that is only
 * reachable by knowing its URL is, for most users, not shipped.
 */

export type RunOutput = {
  href: string;
  label: string;
  description: string;
  /** Gated outputs say why they are not available yet. */
  blockedReason?: string;
  external?: boolean;
};

const APPROVED = new Set(["approved", "finalised", "disbursed", "closed"]);

export function outputsFor(args: {
  companyId: string;
  year: number;
  month: number;
  status: string;
  canSeeCompensation: boolean;
}): RunOutput[] {
  const q = `company=${args.companyId}&year=${args.year}&month=${args.month}`;
  const approved = APPROVED.has(args.status);
  const notApprovedYet =
    args.status === "not calculated"
      ? "No run has been saved for this period yet. Calculate and approve one first."
      : `The run is ${args.status.replace(/_/g, " ")}, not approved. Money may only move against figures a second person has signed off.`;

  const outputs: RunOutput[] = [
    {
      href: `/console/payroll?${q}`,
      label: "Payroll register",
      description: "Every employee, component by component, with the derivation of each figure.",
    },
    {
      href: `/console/payroll/payslips?${q}`,
      label: "All payslips",
      description: "One page per employee, laid out for printing or saving as PDF.",
    },
    {
      href: `/console/banking?${q}`,
      label: "Bank file & payments",
      description: "The salary disbursement file, split payments, and payment status.",
      blockedReason: approved ? undefined : notApprovedYet,
    },
    {
      href: `/console/banking?${q}&dimension=none`,
      label: "Journal & accounting",
      description: "The balanced journal voucher, Tally XML and journal CSV.",
    },
    {
      href: `/console/statutory?${q}`,
      label: "Statutory returns",
      description: "EPF ECR, ESIC contribution file, PT and LWF summaries, and the compliance calendar.",
    },
    {
      href: `/console/audit/pack?${q}`,
      label: "Audit pack",
      description: "Register, statutory summaries, approval trail, exceptions and variance in one file.",
      external: true,
    },
  ];

  return args.canSeeCompensation ? outputs : [];
}

export function RunOutputs(props: {
  companyId: string;
  year: number;
  month: number;
  status: string;
  canSeeCompensation: boolean;
  /** Bare link list, for somewhere too narrow for the two-column card. */
  compact?: boolean;
}) {
  const outputs = outputsFor(props);
  if (outputs.length === 0) return null;

  if (props.compact) {
    return (
      <ul className="flex flex-col divide-y divide-line-2" data-print="hide">
        {outputs.map((o) => (
          <li key={o.href} className="py-2">
            {o.blockedReason ? (
              <p className="text-sm text-ink-3">
                {o.label}
                <span className="block text-xs">{o.blockedReason}</span>
              </p>
            ) : o.external ? (
              <a href={o.href} className="text-sm text-indigo hover:underline font-medium">
                {o.label} ↓
              </a>
            ) : (
              <Link href={o.href} className="text-sm text-indigo hover:underline font-medium">
                {o.label} →
              </Link>
            )}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="border border-line bg-surface rounded-lg" data-print="hide">
      <div className="px-4 py-2.5 border-b border-line bg-surface-2">
        <span className="label text-ink-2">What this run produces</span>
      </div>
      <ul className="grid sm:grid-cols-2 divide-y sm:divide-y-0 divide-line-2">
        {outputs.map((o, i) => (
          <li
            key={o.href}
            className={`px-4 py-3 border-line-2 ${i % 2 === 0 ? "sm:border-r" : ""} ${
              i < outputs.length - 2 ? "sm:border-b" : ""
            }`}
          >
            {o.blockedReason ? (
              <>
                <p className="text-sm text-ink-3">{o.label}</p>
                <p className="text-xs text-ink-3 mt-0.5">{o.blockedReason}</p>
              </>
            ) : (
              <>
                {o.external ? (
                  <a
                    href={o.href}
                    className="text-sm text-indigo hover:underline font-medium"
                  >
                    {o.label} ↓
                  </a>
                ) : (
                  <Link
                    href={o.href}
                    className="text-sm text-indigo hover:underline font-medium"
                  >
                    {o.label} →
                  </Link>
                )}
                <p className="text-xs text-ink-2 mt-0.5 max-w-[46ch]">
                  {o.description}
                </p>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
