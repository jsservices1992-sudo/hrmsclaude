import Link from "next/link";
import { NAV, SITE, PT_COUNT, LWF_COUNT } from "@/lib/site";
import { Container } from "./ui";

export default function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line/70 bg-paper">
      <Container>
        <div className="grid gap-10 py-16 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div className="flex max-w-sm flex-col gap-4">
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="grid h-9 w-9 place-items-center rounded-xl bg-indigo text-lg font-bold leading-none text-on-indigo"
              >
                ल
              </span>
              <span className="text-xl font-bold tracking-tight">{SITE.name}</span>
            </div>
            <p className="text-sm text-ink-2 leading-relaxed pretty">{SITE.description}</p>
            <div className="flex flex-wrap gap-2">
              {[`PT ${PT_COUNT}`, `LWF ${LWF_COUNT}`, "Data in India"].map((c) => (
                <span key={c} className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink-2">
                  {c}
                </span>
              ))}
            </div>
          </div>

          <nav aria-label="Product">
            <p className="mb-4 text-sm font-bold text-ink">Product</p>
            <ul className="flex flex-col gap-2.5">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="text-sm text-ink-2 transition-base hover:text-indigo">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <p className="mb-4 text-sm font-bold text-ink">Compliance</p>
            <ul className="flex flex-col gap-2.5 text-sm text-ink-2">
              <li>Provident Fund</li>
              <li>State Insurance</li>
              <li>Professional Tax</li>
              <li>Labour Welfare Fund</li>
              <li>Income tax & TDS</li>
              <li>Gratuity & Bonus</li>
            </ul>
          </div>

          <div>
            <p className="mb-4 text-sm font-bold text-ink">Get started</p>
            <ul className="flex flex-col gap-2.5 text-sm">
              <li>
                <Link href="/pricing" className="font-semibold text-indigo hover:text-indigo-2">
                  Book a demo →
                </Link>
              </li>
              <li>
                <Link href="/signup" className="text-ink-2 hover:text-indigo">
                  Create your company
                </Link>
              </li>
              <li>
                <Link href="/login" className="text-ink-2 hover:text-indigo">
                  Sign in
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-line py-6 text-sm text-ink-3 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {SITE.name}. Made for Indian payroll.
          </p>
          <p>{SITE.tagline}</p>
        </div>
      </Container>
    </footer>
  );
}
