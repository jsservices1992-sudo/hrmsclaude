import { redirect } from "next/navigation";
import {
  getSessionUser,
  canAccessConsole,
  canSeeCompensation,
  isTenantWide,
} from "@/lib/auth/session";
import { logout } from "@/app/login/actions";
import { CONSOLE_SECTIONS } from "@/lib/console-nav";
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
  const sections = CONSOLE_SECTIONS.map((section) => ({
    ...section,
    groups: section.groups
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (item) =>
            (!item.needsCompensation || canSeeCompensation(user)) &&
            (!item.needsTenantWide || isTenantWide(user)),
        ),
      }))
      .filter((group) => group.items.length > 0),
  })).filter((section) => section.groups.length > 0);

  return (
    <ConsoleShell
      user={{
        name: user.name,
        email: user.email,
        role: user.role,
        compensationScope: user.compensationScope,
      }}
      sections={sections}
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
