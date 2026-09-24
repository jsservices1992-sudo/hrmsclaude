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
  Badge,
  EmptyState,
  type BadgeTone, MetricStrip, DrawerButton, Alert
} from "@/components/console/ui";
import {
  CreateUserForm,
  EditUserForm,
  ResetPasswordForm,
  EndSessionsForm,
} from "./forms";
import { formatDate } from "@/lib/format/date";

export const metadata = { title: "Users & access" };
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
      <PageHeader
        eyebrow="Settings"
        title="Users & access"
        description="Who can sign in, what they may change, and whose pay they can see. Every change is recorded."
        actions={
          <DrawerButton label="+ Add user" variant="primary" title="Add a user" description="They get a sign-in link to set their own password.">
            <CreateUserForm companies={companyOptions} employees={employeeOptions} />
          </DrawerButton>
        }
      />

      <MetricStrip
        items={[
          { label: "Accounts", value: (rows.length) },
          { label: "Can sign in", value: (rows.filter((r) => r.active).length) },
          { label: "Administrators", value: (activeAdmins), hint: (activeAdmins === 1 ? "Only one — add a second" : undefined) },
          { label: "Self-service", value: (rows.filter((r) => r.role === "employee").length) },
        ]}
      />

      {activeAdmins === 1 && (
        <Alert tone="warning" title="Only one administrator">
          If that account is lost there is no way back in without database access. Add a second administrator.
        </Alert>
      )}

      {editing && (
        <DrawerButton
          key={editing.id}
          label="Edit"
          hideTrigger
          title={`Edit ${editing.name}`}
          description={editing.email}
          defaultOpen
        >
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
        </DrawerButton>
      )}

      <Card padded={false}>
        <div className="px-5 py-3.5 border-b border-line-2">
          <span className="text-[15px] font-semibold text-ink">All users</span>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            title="No accounts"
            description="Run db:bootstrap to create the first administrator."
          />
        ) : (
          <ul className="divide-y divide-line-2">
            {rows.map((r) => (
              <li key={r.id} className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-indigo-soft text-xs font-bold text-indigo">
                  {r.name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    {r.name}
                    {!r.active && <Badge tone="rust" className="ml-2">no access</Badge>}
                    {r.id === user.id && <Badge tone="neutral" className="ml-2">you</Badge>}
                  </p>
                  <p className="text-xs text-ink-2 mt-0.5 break-all">{r.email}</p>
                  <p className="text-xs text-ink-3 mt-1">
                    {r.companyId ? (companyName.get(r.companyId) ?? "Unknown company") : "Every company"}
                    {r.employeeId && ` · ${employeeLabel.get(r.employeeId) ?? "linked record"}`}
                    {r.lastLoginAt
                      ? ` · last signed in ${formatDate(r.lastLoginAt)}`
                      : " · never signed in"}
                  </p>
                </div>
                </div>
                <div className="flex items-start gap-5">
                  <div className="flex flex-col items-end gap-1">
                    <Badge tone={ROLE_TONE[r.role] ?? "neutral"}>
                      {ROLE_LABEL[r.role] ?? r.role}
                    </Badge>
                    <span className="text-xs text-ink-3">
                      {r.compensationScope === "none"
                        ? "no pay data"
                        : r.compensationScope === "own"
                          ? "own payslip"
                          : r.compensationScope === "company"
                            ? "company pay"
                            : "all pay"}
                    </span>
                  </div>
                  <details className="relative">
                    <summary className="grid h-8 w-8 cursor-pointer list-none place-items-center rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink" aria-label={`Actions for ${r.name}`}>
                      <span aria-hidden className="text-lg leading-none">⋯</span>
                    </summary>
                    <div className="absolute right-0 z-20 mt-1 flex w-56 flex-col items-start gap-1 rounded-xl border border-line bg-surface p-2 shadow-lg">
                      <Link
                        href={`/console/settings/users?edit=${r.id}`}
                        className="w-full rounded-lg px-2 py-1.5 text-sm font-medium text-ink hover:bg-surface-2"
                      >
                        Edit access
                      </Link>
                      <div className="w-full px-2 py-1"><ResetPasswordForm userId={r.id} /></div>
                      <div className="w-full px-2 py-1"><EndSessionsForm userId={r.id} /></div>
                    </div>
                  </details>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

    </div>
  );
}
