import Link from "next/link";
import { Container, Section } from "@/components/ui";
import { DemoForm } from "./demo-form";

export const metadata = {
  title: "Book a demo",
  description: "See Lekha run one month of your own payroll — reconciled line by line.",
};

const PLAN_LABEL: Record<string, string> = {
  core: "Core",
  payroll: "Payroll",
  governed: "Governed",
};

export default async function DemoPage(props: PageProps<"/demo">) {
  const sp = await props.searchParams;
  const plan = typeof sp.plan === "string" && sp.plan in PLAN_LABEL ? sp.plan : null;

  return (
    <Section>
      <Container>
        <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
          <div className="flex flex-col gap-5">
            {plan && (
              <span className="w-fit rounded-full bg-indigo-soft px-3 py-1 text-xs font-semibold text-indigo">
                {PLAN_LABEL[plan]} plan
              </span>
            )}
            <h1 className="text-4xl font-bold leading-[1.1] tracking-[-0.02em] text-ink sm:text-5xl">
              {plan === "governed" ? "Talk to us" : "Book a demo"}
            </h1>
            <p className="max-w-lg text-lg leading-relaxed text-ink-2">
              Bring one month of real payroll. We run it in Lekha with you and reconcile it line by line against
              what you paid — every variance explained.
            </p>
            <ul className="flex flex-col gap-3 text-sm text-ink-2">
              {[
                "30 minutes, on a call or screen share",
                "Your states, your salary structures, your proration rules",
                "No commitment — and you keep the reconciliation",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2.5">
                  <span aria-hidden className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-teal-soft text-xs font-bold text-teal">
                    ✓
                  </span>
                  {t}
                </li>
              ))}
            </ul>
            <p className="text-sm text-ink-2">
              Rather set it up yourself?{" "}
              <Link href="/signup" className="font-semibold text-indigo hover:text-indigo-2">
                Create your company →
              </Link>
            </p>
          </div>

          <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">
            <DemoForm plan={plan} />
          </div>
        </div>
      </Container>
    </Section>
  );
}
