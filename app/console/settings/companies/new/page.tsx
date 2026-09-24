import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { CompanyForm } from "../../forms";
import { PageHeader } from "@/components/console/ui";

export const metadata = { title: "New company" };

export default async function NewCompanyPage() {
  const user = (await getSessionUser())!;
  if (user.role !== "admin") redirect("/console/settings");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/console/settings" className="inline-flex w-fit items-center gap-1 text-sm font-medium text-ink-2 hover:text-ink">
          ← Settings
        </Link>
        <PageHeader
          eyebrow="Settings"
          title="New legal entity"
          description="Add branches and per-state registrations after creating it. Payroll conventions can be changed later, but doing so after a run exists requires a reason."
        />
      </div>

      <CompanyForm
        mode="create"
        values={{
          roundingMode: "nearest",
          attendanceMode: "exception",
          sandwichRule: false,
          epfOnActualBasic: false,
        }}
      />
    </div>
  );
}
