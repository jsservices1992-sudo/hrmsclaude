import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSessionUser, scopeCompanies } from "@/lib/auth/session";
import { SetDefaultForm } from "./forms";
import { PageHeader, Button, Badge, Alert } from "@/components/console/ui";

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
        title="Companies"
        description="Each legal entity has its own registrations, payroll rules and approvals. Branches inherit them unless you override."
        actions={
          isAdmin && (
            <Button href="/console/settings/companies/new" variant="primary">
              + Add company
            </Button>
          )
        }
      />

      {!isAdmin && (
        <Alert tone="info" title="View only">
          Only an administrator can change company or branch settings.
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {companies.map((c) => {
          const own = branches.filter((b) => b.companyId === c.id);
          const states = Array.from(new Set(own.map((b) => b.stateCode)));
          return (
            <section key={c.id} className="flex flex-col rounded-xl border border-line bg-surface transition-base hover:border-indigo/30">
              <div className="flex items-start justify-between gap-3 p-5">
                <Link href={`/console/settings/companies/${c.id}`} className="group flex min-w-0 items-center gap-3">
                  <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-indigo-soft text-sm font-bold text-indigo">
                    {c.name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-base font-semibold text-ink group-hover:text-indigo">{c.name}</span>
                      {c.isDefault && <Badge tone="teal">Default</Badge>}
                    </span>
                    <span className="block truncate text-xs text-ink-3">{c.legalName}</span>
                  </span>
                </Link>
                {isAdmin && !c.isDefault && <SetDefaultForm companyId={c.id} />}
              </div>

              <dl className="grid grid-cols-3 border-y border-line-2">
                {[
                  { k: "Employees", v: String(headById[c.id] ?? 0) },
                  { k: "Branches", v: String(own.length) },
                  { k: "States", v: states.join(", ") || "—" },
                ].map((x) => (
                  <div key={x.k} className="min-w-0 border-r border-line-2 px-5 py-3 last:border-0">
                    <dt className="text-xs text-ink-3">{x.k}</dt>
                    <dd className="mt-0.5 truncate text-lg font-bold tracking-tight tnum text-ink">{x.v}</dd>
                  </div>
                ))}
              </dl>

              <div className="flex flex-wrap gap-1.5 px-5 py-3">
                {[
                  `PAN ${c.pan ?? "missing"}`,
                  `TAN ${c.tan ?? "missing"}`,
                  `${c.prorationBasis.replace("_", " ")} days`,
                  `Round ${c.roundingMode}`,
                  `PF on ${c.epfOnActualBasic ? "actual basic" : "ceiling"}`,
                  `Sandwich ${c.sandwichRule ? "on" : "off"}`,
                ].map((chip) => (
                  <span
                    key={chip}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${chip.endsWith("missing") ? "bg-rust-soft text-rust" : "bg-surface-2 text-ink-2"}`}
                  >
                    {chip}
                  </span>
                ))}
              </div>

              <div className="mt-auto flex items-center justify-end gap-2 border-t border-line-2 px-5 py-3">
                <Button href={`/console/settings/payroll?company=${c.id}`} variant="ghost" size="sm">
                  Payroll rules
                </Button>
                <Button href={`/console/settings/companies/${c.id}`} size="sm">
                  Configure
                </Button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
