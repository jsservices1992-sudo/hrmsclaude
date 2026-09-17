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
import EmployeeForm from "../employee-form";
import { PageHeader, Select, FilterBar, FilterField } from "@/components/console/ui";
import { SetupWizard } from "@/components/console/setup-wizard";

export const metadata = { title: "New employee" };

export default async function NewEmployeePage(
  props: PageProps<"/console/employees/new">,
) {
  const user = (await getSessionUser())!;
  if (!canActOnPeople(user)) {
    redirect("/console/employees?denied=create");
  }

  const sp = await props.searchParams;
  const companies = scopeCompanies(user, await listCompanies());
  const requested = typeof sp.company === "string" ? sp.company : null;
  const companyId =
    requested && companies.some((c) => c.id === requested)
      ? requested
      : companies[0]?.id;

  if (!companyId) redirect("/console/employees");

  const options = await loadFormOptions(companyId);
  const company = companies.find((c) => c.id === companyId)!;

  const setupStep = typeof sp.setup === "string" ? sp.setup : undefined;

  return (
    <div className="flex flex-col gap-6">
      <SetupWizard companyId={companyId} stepId={setupStep} />

      <div>
        <Link href="/console/employees" className="label text-brass hover:underline">
          ← Employees
        </Link>
      </div>
      <PageHeader
        title="New employee"
        description={
          <>
            Creating in <span className="font-medium text-ink">{company.name}</span>. Statutory
            applicability follows the branch you choose.
          </>
        }
        actions={
          companies.length > 1 && (
            <FilterBar action="/console/employees/new" mode="switch">
              <FilterField label="Company" showLabel={false}>
                <Select name="company" defaultValue={companyId}>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </FilterField>
            </FilterBar>
          )
        }
      />

      <EmployeeForm
        mode="create"
        companyId={companyId}
        values={{ gender: "other", employmentType: "permanent" }}
        options={options}
        setupStep={setupStep}
      />
    </div>
  );
}
