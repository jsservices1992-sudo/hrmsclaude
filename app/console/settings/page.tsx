import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSessionUser, scopeCompanies } from "@/lib/auth/session";
import { SetDefaultForm } from "./forms";
import { PageHeader, Button, Card, Badge } from "@/components/console/ui";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = (await getSessionUser())!;
  const all = await db.select().from(s.companies).orderBy(asc(s.companies.name));
  const companies = scopeCompanies(user, all);

  const branches = await db.select().from(s.branches);
  const headcount = await db
    .select({
      companyId: s.employees.companyId,
      n: sql<number>`count(*)`,
    })
    .from(s.employees)
    .where(eq(s.employees.status, "active"))
    .groupBy(s.employees.companyId);

  const headById = Object.fromEntries(headcount.map((h) => [h.companyId, h.n]));
  const isAdmin = user.role === "admin";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Settings"
        title="Companies & branches"
        description="Each legal entity carries its own statutory registrations, payroll conventions and approval chain. A branch inherits the company's registrations unless you override them."
        actions={
          isAdmin && (
            <Button href="/console/settings/companies/new" variant="primary">
              New company
            </Button>
          )
        }
      />

      {!isAdmin && (
        <Card>
          <span className="label text-ink-3">Read only</span> — only an
          administrator can change company or branch configuration.
        </Card>
      )}

      <div className="flex flex-col gap-4">
        {companies.map((c) => {
          const own = branches.filter((b) => b.companyId === c.id);
          const states = Array.from(new Set(own.map((b) => b.stateCode)));
          return (
            <Card key={c.id} padded={false}>
              <div className="px-4 py-3 border-b border-line bg-surface-2 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Link
                    href={`/console/settings/companies/${c.id}`}
                    className="font-display text-lg font-semibold hover:text-indigo hover:underline"
                  >
                    {c.name}
                  </Link>
                  {c.isDefault && <Badge tone="teal">Default</Badge>}
                </div>
                <div className="flex items-center gap-3">
                  {isAdmin && !c.isDefault && <SetDefaultForm companyId={c.id} />}
                  <Link
                    href={`/console/settings/payroll?company=${c.id}`}
                    className="label text-brass hover:underline"
                  >
                    Payroll settings
                  </Link>
                  <Link
                    href={`/console/settings/companies/${c.id}`}
                    className="label text-brass hover:underline"
                  >
                    Configure →
                  </Link>
                </div>
              </div>

              <dl className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6">
                {[
                  { k: "Legal name", v: c.legalName },
                  { k: "PAN", v: c.pan ?? "—" },
                  { k: "TAN", v: c.tan ?? "—" },
                  { k: "Active headcount", v: String(headById[c.id] ?? 0) },
                  { k: "Branches", v: String(own.length) },
                  { k: "States", v: states.join(", ") || "—" },
                ].map((x) => (
                  <div key={x.k} className="px-4 py-3 border-r border-b border-line-2">
                    <dt className="label text-ink-3">{x.k}</dt>
                    <dd className="text-sm mt-0.5 font-mono tnum break-all">{x.v}</dd>
                  </div>
                ))}
              </dl>

              <div className="px-4 py-2.5 border-t border-line-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-2">
                <span>
                  Proration{" "}
                  <span className="font-mono text-ink">
                    {c.prorationBasis.replace("_", " ")}
                  </span>
                </span>
                <span>
                  Rounding <span className="font-mono text-ink">{c.roundingMode}</span>
                </span>
                <span>
                  EPF base{" "}
                  <span className="font-mono text-ink">
                    {c.epfOnActualBasic ? "actual basic" : "ceiling"}
                  </span>
                </span>
                <span>
                  Sandwich rule{" "}
                  <span className="font-mono text-ink">
                    {c.sandwichRule ? "on" : "off"}
                  </span>
                </span>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
