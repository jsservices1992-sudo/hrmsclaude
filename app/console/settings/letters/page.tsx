import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { listCompanies } from "@/lib/payroll/load";
import { getSessionUser, canAccessCompany, scopeCompanies } from "@/lib/auth/session";
import { LETTER_TYPES } from "@/lib/letters/template";
import { LetterTemplateForm } from "./forms";
import { PageHeader, Card } from "@/components/console/ui";

export const metadata = { title: "Letter templates" };

export default async function LetterTemplatesPage(
  props: PageProps<"/console/settings/letters">,
) {
  const user = (await getSessionUser())!;
  const sp = await props.searchParams;
  const companies = scopeCompanies(user, await listCompanies());
  const requested = typeof sp.company === "string" ? sp.company : null;
  const companyId =
    requested && canAccessCompany(user, requested) ? requested : companies[0]?.id;
  if (!companyId) redirect("/console");

  const company = companies.find((c) => c.id === companyId)!;
  const isAdmin = user.role === "admin";

  const rows = await db
    .select()
    .from(s.letterTemplates)
    .where(eq(s.letterTemplates.companyId, companyId));
  const byType = new Map(rows.map((r) => [r.type, r]));

  return (
    <div className="flex flex-col gap-6 max-w-[64rem]">
      <PageHeader
        eyebrow="Settings"
        title="Letter templates"
        description={`${company.name} · Offer, relieving, letter of intent, experience and full & final letters — pasted text with fields that merge per employee, or your own letterhead file used as-is.`}
      />

      {!isAdmin && (
        <p className="text-sm text-ink-2 rounded-lg bg-amber-soft px-4 py-3">
          Only an administrator can change letter templates. What is shown below is what the company currently has on file.
        </p>
      )}

      {LETTER_TYPES.map((t) => {
        const current = byType.get(t.type);
        return (
          <Card key={t.type} padded={false}>
            <div className="px-4 py-2.5 border-b border-line-2">
              <span className="text-[15px] font-semibold text-ink">{t.label}</span>
              <p className="text-xs text-ink-3 mt-0.5">{t.description}</p>
            </div>
            {isAdmin ? (
              <LetterTemplateForm
                companyId={companyId}
                type={t.type}
                current={
                  current
                    ? { mode: current.mode as "text" | "file", bodyText: current.bodyText, fileName: current.fileName }
                    : null
                }
              />
            ) : (
              <p className="px-4 py-3 text-sm text-ink-2">
                {current
                  ? current.mode === "text"
                    ? "A pasted-text template is on file."
                    : `A file template is on file (${current.fileName}).`
                  : "No template set yet."}
              </p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
