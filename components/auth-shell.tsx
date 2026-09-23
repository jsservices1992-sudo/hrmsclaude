import Link from "next/link";

/**
 * The frame of every sign-in-adjacent page: the form on the left, and on
 * a wide screen a brand panel on the right that shows what is behind the
 * door — the product's own run summary, not a stock illustration.
 */
export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="grid min-h-dvh bg-surface lg:grid-cols-[1fr_1.05fr]">
      {/* ---------- form ---------- */}
      <div className="flex flex-col px-6 py-8 sm:px-10">
        <Link href="/" className="flex w-fit items-center gap-2.5">
          <span
            aria-hidden
            className="grid h-9 w-9 place-items-center rounded-xl bg-indigo text-lg font-bold leading-none text-on-indigo"
          >
            ल
          </span>
          <span className="text-xl font-bold tracking-tight">Lekha</span>
        </Link>

        <div className="flex flex-1 items-center justify-center py-12">
          <div className="flex w-full max-w-sm flex-col gap-7">
            <div className="flex flex-col gap-2">
              <h1 className="text-3xl font-extrabold tracking-[-0.03em] text-ink">{title}</h1>
              {description && <div className="text-sm text-ink-2 leading-relaxed">{description}</div>}
            </div>
            {children}
            {footer && <div className="flex flex-col gap-2 text-sm text-ink-2">{footer}</div>}
          </div>
        </div>

        <p className="text-xs text-ink-3">
          Payroll and employee data are restricted. Every sign-in is recorded.
        </p>
      </div>

      {/* ---------- brand panel ---------- */}
      <aside className="relative hidden overflow-hidden bg-indigo p-10 text-on-indigo lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(55%_60%_at_90%_5%,color-mix(in_srgb,var(--brass)_65%,transparent),transparent_70%),radial-gradient(45%_50%_at_0%_100%,color-mix(in_srgb,#000_25%,transparent),transparent_70%)]"
        />
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.12] [background-image:linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_70%_20%,black_20%,transparent_70%)]"
        />

        <div className="relative max-w-md">
          <p className="inline-flex rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-semibold">
            HR & payroll for India
          </p>
          <h2 className="mt-5 text-4xl font-extrabold leading-[1.08] tracking-[-0.03em] balance">
            Payroll that closes to the rupee.
          </h2>
          <ul className="mt-6 flex flex-col gap-3 text-sm text-white/85">
            {[
              "EPF, ESIC, PT, LWF and TDS — right in every state",
              "The whole month on one screen, step by step",
              "Every figure explainable, every change audited",
            ].map((t) => (
              <li key={t} className="flex items-center gap-2.5">
                <span aria-hidden className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/15 text-[10px] font-bold">
                  ✓
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>

        {/* the product, as a card */}
        <div className="relative ml-auto w-full max-w-sm rounded-2xl bg-surface p-5 text-ink shadow-[0_30px_60px_-20px_rgba(0,0,0,0.45)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-ink-3">March 2026 payroll</p>
              <p className="text-sm font-bold">Example Industries</p>
            </div>
            <span className="rounded-full bg-teal-soft px-2.5 py-1 text-xs font-semibold text-teal">Approved</span>
          </div>
          <p className="mt-4 text-xs text-ink-3">Net to pay</p>
          <p className="text-3xl font-extrabold tracking-[-0.03em] tnum">₹1,13,67,805</p>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            {[
              ["486", "Employees"],
              ["7", "States"],
              ["₹0.00", "Variance"],
            ].map(([v, k]) => (
              <div key={k} className="rounded-lg bg-surface-2 px-2 py-2">
                <p className="text-sm font-bold tnum">{v}</p>
                <p className="text-[11px] text-ink-3">{k}</p>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </main>
  );
}

/** One field style for every auth form. */
export const authField =
  "h-11 w-full rounded-xl border border-line bg-surface-3/60 px-3.5 text-sm text-ink placeholder:text-ink-3 outline-none transition-base hover:bg-surface-3 focus:border-indigo focus:bg-surface focus:shadow-ring";

export const authButton =
  "inline-flex h-11 w-full items-center justify-center rounded-xl bg-indigo px-5 text-sm font-semibold text-on-indigo shadow-[0_8px_20px_-8px_var(--indigo)] transition-base hover:bg-indigo-2 disabled:opacity-60";
