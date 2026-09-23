import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSessionUser, scopeCompanies, isTenantWide } from "@/lib/auth/session";
import { canManageUsers, ASSIGNABLE_ROLES } from "@/lib/auth/user-admin";
import { listCompanies } from "@/lib/payroll/load";
import {
  PageHeader,
  Card,
  StatCard,
  Badge,
  EmptyState,
  type BadgeTone,
} from "@/components/console/ui";
import {
  CreateUserForm,
  EditUserForm,
  ResetPasswordForm,
  EndSessionsForm,
} from "./forms";
import { formatDate } from "@/lib/format/date";

export const metadata = { title: "Accounts" };
export const dynamic = "force-dynamic";

const ROLE_TONE: Record<string, BadgeTone> = {
  admin: "indigo",
  payroll_manager: "teal",
  hr_manager: "brass",
  auditor: "neutral",
  employee: "neutral",
};

const ROLE_LABEL = Object.fromEntries(
  ASSIGNABLE_ROLES.map((r) => [r.role, r.label]),
);

/**
 * Who can sign in, and as what.
 *
 * This screen did not exist, which meant a freshly installed instance
 * had exactly one account — the one the bootstrap script made — and no
 * way to add a second. Administrator-only: it is the one place that can
 * hand out every other permission in the product.
 */
export default async function UsersPage(
  props: PageProps<"/console/settings/users">,
) {
  const user = (await getSessionUser())!;
  if (!canManageUsers(user)) redirect("/console/settings?denied=users");

  const sp = await props.searchParams;
  const editId = typeof sp.edit === "string" ? sp.edit : null;

  const companies = scopeCompanies(user, await listCompanies());
  const companyIds = companies.map((c) => c.id);

  /* Scoped, not "every user in the database".
     An administrator confined to one company must not see another
     company's people — which is exactly what self-serve registration
     creates, several companies sharing one instance. A tenant-wide
     administrator (a self-hosted install bootstrapped from the command
     line) still sees everyone, including accounts not yet attached to a
     company. */
  const allUsers = await db.select().from(s.users).orderBy(asc(s.users.email));
  const rows = isTenantWide(user)
    ? allUsers
    : allUsers.filter((u) => u.companyId === user.companyId);

  const employees = companyIds.length
    ? await db
        .select({
          id: s.employees.id,
          empCode: s.employees.empCode,
          firstName: s.employees.firstName,
          lastName: s.employees.lastName,
        })
        .from(s.employees)
        .where(inArray(s.employees.companyId, companyIds))
        .orderBy(asc(s.employees.empCode))
    : [];

  const companyOptions = companies.map((c) => ({ id: c.id, label: c.name }));
  const employeeOptions = employees.map((e) => ({
    id: e.id,
    label: `${e.empCode} — ${e.firstName} ${e.lastName}`,
  }));
  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  const employeeLabel = new Map(employeeOptions.map((e) => [e.id, e.label]));

  const editing = editId ? rows.find((r) => r.id === editId) : undefined;
  const activeAdmins = rows.filter((r) => r.role === "admin" && r.active).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/console/settings" className="text-sm font-semibold text-indigo hover:text-indigo-2">
          ← Settings
        </Link>
        <PageHeader
          eyebrow="Access"
          title="Accounts"
          description="Who can sign in, what they may change, and whose pay they can see. Every change here is recorded against your name."
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Accounts" value={rows.length} />
        <StatCard label="Can sign in" value={rows.filter((r) => r.active).length} />
        <StatCard
          label="Administrators"
          value={activeAdmins}
          hint={activeAdmins === 1 ? "Only one — add a second" : undefined}
        />
        <StatCard
          label="Self-service"
          value={rows.filter((r) => r.role === "employee").length}
        />
      </div>

      {activeAdmins === 1 && (
        <div className="border border-brass/40 bg-brass-soft px-4 py-3 text-sm rounded-lg">
          <span className="label text-brass">One administrator</span>{" "}
          <span className="text-ink-2">
            If this account is lost there is no way back into the instance
            without database access. Add a second administrator.
          </span>
        </div>
      )}

      {editing && (
        <Card>
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <h2 className="font-display text-lg font-semibold">
              {editing.email}
            </h2>
            <Link
              href="/console/settings/users"
              className="label text-ink-3 hover:text-ink"
            >
              Done
            </Link>
          </div>
          <EditUserForm
            userId={editing.id}
            companies={companyOptions}
            employees={employeeOptions}
            editing={{
              name: editing.name,
              role: editing.role,
              companyId: editing.companyId,
              employeeId: editing.employeeId,
              compensationScope: editing.compensationScope,
              active: editing.active,
            }}
          />
        </Card>
      )}

      <Card padded={false}>
        <div className="px-5 py-3.5 border-b border-line-2">
          <span className="text-[15px] font-semibold text-ink">Existing accounts</span>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            title="No accounts"
            description="Run db:bootstrap to create the first administrator."
          />
        ) : (
          <ul className="divide-y divide-line-2">
            {rows.map((r) => (
              <li key={r.id} className="px-4 py-3 flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {r.name}
                    {!r.active && <Badge tone="rust" className="ml-2">no access</Badge>}
                    {r.id === user.id && <Badge tone="neutral" className="ml-2">you</Badge>}
                  </p>
                  <p className="font-mono text-xs text-indigo mt-0.5 break-all">{r.email}</p>
                  <p className="text-xs text-ink-3 mt-1">
                    {r.companyId ? (companyName.get(r.companyId) ?? "Unknown company") : "Every company"}
                    {r.employeeId && ` · ${employeeLabel.get(r.employeeId) ?? "linked record"}`}
                    {r.lastLoginAt
                      ? ` · last signed in ${formatDate(r.lastLoginAt)}`
                      : " · never signed in"}
                  </p>
                </div>
                <div className="flex items-start gap-5">
                  <div className="flex flex-col items-end gap-1">
                    <Badge tone={ROLE_TONE[r.role] ?? "neutral"}>
                      {ROLE_LABEL[r.role] ?? r.role}
                    </Badge>
                    <span className="label text-ink-3">
                      {r.compensationScope === "none"
                        ? "no pay data"
                        : r.compensationScope === "own"
                          ? "own payslip"
                          : r.compensationScope === "company"
                            ? "company pay"
                            : "all pay"}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1 items-start">
                    <Link
                      href={`/console/settings/users?edit=${r.id}`}
                      className="text-xs text-brass hover:underline"
                    >
                      Edit
                    </Link>
                    <ResetPasswordForm userId={r.id} />
                    <EndSessionsForm userId={r.id} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="font-display text-lg font-semibold mb-3">Add an account</h2>
        <CreateUserForm companies={companyOptions} employees={employeeOptions} />
      </Card>
    </div>
  );
}
