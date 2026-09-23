import { redirect } from "next/navigation";
import {
  getSessionUser,
  canAccessConsole,
  canSeeCompensation,
  isTenantWide,
  scopeCompanies,
} from "@/lib/auth/session";
import { listCompanies } from "@/lib/payroll/load";
import { selectedCompanyId } from "@/lib/company-cookie-server";
import { logout } from "@/app/login/actions";
import { navFor } from "@/lib/console-nav";
import ConsoleShell from "@/components/console/shell";

// Console reads live database rows; prerendering would freeze them at build.
export const dynamic = "force-dynamic";

export default async function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The real check. proxy.ts only sees whether a cookie exists.
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/console");
  if (!canAccessConsole(user)) redirect("/me");

  // Filtered on the server, so a hidden route is never named to the client.
  const nav = navFor({ compensation: canSeeCompensation(user), tenantWide: isTenantWide(user) });
  const companies = scopeCompanies(user, await listCompanies()).map((c) => ({ id: c.id, name: c.name }));
  const selected = await selectedCompanyId();

  return (
    <ConsoleShell
      user={{
        name: user.name,
        email: user.email,
        role: user.role,
        compensationScope: user.compensationScope,
      }}
      nav={nav}
      companies={companies}
      selectedCompany={companies.some((c) => c.id === selected) ? selected : null}
      signOut={
        <form action={logout}>
          <button type="submit" className="text-sm text-rust hover:underline">
            Sign out
          </button>
        </form>
      }
    >
      {children}
    </ConsoleShell>
  );
}
