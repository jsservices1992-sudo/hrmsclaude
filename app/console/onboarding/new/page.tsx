import Link from "next/link";
import { redirect } from "next/navigation";
import { loadFormOptions } from "@/lib/hris/load";
import { listCompanies } from "@/lib/payroll/load";
import {
  getSessionUser,
  canMutate,
  scopeCompanies,
  canActOnPeople,
} from "@/lib/auth/session";
import { NewJoinerForm } from "../forms";
import { PageHeader } from "@/components/console/ui";

export const metadata = { title: "New joiner" };

export default async function NewJoinerPage(
  props: PageProps<"/console/onboarding/new">,
) {
  const user = (await getSessionUser())!;
  if (!canActOnPeople(user)) {
    redirect("/console/onboarding");
  }

  const sp = await props.searchParams;
  const companies = scopeCompanies(user, await listCompanies());
  const requested = typeof sp.company === "string" ? sp.company : null;
  const companyId =
    requested && companies.some((c) => c.id === requested) ? requested : companies[0]?.id;
  if (!companyId) redirect("/console/onboarding");

  const options = await loadFormOptions(companyId);
  const company = companies.find((c) => c.id === companyId)!;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/console/onboarding" className="inline-flex w-fit items-center gap-1 text-sm font-medium text-ink-2 hover:text-ink">
          ← Joiners
        </Link>
      </div>
      <PageHeader
        title="New joiner"
        description={
          <>
            Creating in <span className="font-medium text-ink">{company.name}</span>.
            This creates a pre-employee record with a document checklist,
            statutory declarations and provisioning tasks — plus a private portal
            link for the candidate. No employee record exists until conversion.
          </>
        }
      />

      <NewJoinerForm
        companyId={companyId}
        branches={options.branches.map((b) => ({ id: b.id, label: `${b.name} (${b.stateCode})` }))}
        departments={options.departments.map((d) => ({ id: d.id, label: `${d.code} — ${d.name}` }))}
        grades={options.grades.map((g) => ({ id: g.id, label: g.name }))}
        managers={options.managers}
      />
    </div>
  );
}
