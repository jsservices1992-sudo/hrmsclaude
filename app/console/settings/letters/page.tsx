import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { listCompanies } from "@/lib/payroll/load";
import { getSessionUser, canAccessCompany, scopeCompanies } from "@/lib/auth/session";
import { LETTER_TYPES, isLetterType, letterDefinition, type LetterType } from "@/lib/letters/template";
import { LETTER_THEMES, type LetterTheme } from "@/lib/letters/themes";
import { LetterTemplateEditor } from "./forms";
import { PageHeader, Card, Tabs, TabLink, Badge } from "@/components/console/ui";

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

  const type: LetterType = isLetterType(sp.type) ? sp.type : "offer";
  const def = letterDefinition(type);
  const isAdmin = user.role === "admin";

  const [[company], rows] = await Promise.all([
    db.select().from(s.companies).where(eq(s.companies.id, companyId)).limit(1),
    db.select().from(s.letterTemplates).where(eq(s.letterTemplates.companyId, companyId)),
  ]);
  const byType = new Map(rows.map((r) => [r.type, r]));
  const current = byType.get(type);

  const head = {
    name: company.legalName || company.name,
    address: [company.registeredAddress, company.registeredCity, company.registeredStateCode, company.registeredPincode]
      .filter(Boolean)
      .join(", "),
    cin: company.cin,
    logoUrl: company.logoUrl,
  };

  const describe = (r: typeof current) =>
    !r
      ? "Not set up"
      : r.mode === "file"
        ? `Finished file · ${r.fileName}`
        : `${LETTER_THEMES.find((t) => t.theme === r.theme)?.label ?? "Classic"} theme`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Settings"
        title="Letter templates"
        description={`${company.name} · Each letter has its own fields and wording. Write it here or in Word, pick a theme, and it is filled in for each employee when issued.`}
      />

      <Tabs>
        {LETTER_TYPES.map((t) => (
          <TabLink key={t.type} href={`/console/settings/letters?company=${companyId}&type=${t.type}`} active={t.type === type}>
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={`h-1.5 w-1.5 rounded-full ${byType.has(t.type) ? "bg-teal" : "bg-ink-3/40"}`}
              />
              {t.label}
            </span>
          </TabLink>
        ))}
      </Tabs>

      <Card padded={false}>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line-2 px-5 py-4">
          <div>
            <h2 className="text-[17px] font-semibold text-ink">{def.label}</h2>
            <p className="mt-0.5 text-sm text-ink-3">{def.description}</p>
          </div>
          <Badge tone={current ? "teal" : "neutral"}>{describe(current)}</Badge>
        </div>
        <div className="p-5">
          {isAdmin ? (
            <LetterTemplateEditor
              key={type}
              companyId={companyId}
              type={type}
              company={head}
              current={
                current
                  ? {
                      mode: current.mode as "text" | "file",
                      bodyText: current.bodyText,
                      fileName: current.fileName,
                      theme: (current.theme ?? "classic") as LetterTheme,
                      signatoryName: current.signatoryName,
                      signatoryTitle: current.signatoryTitle,
                    }
                  : null
              }
            />
          ) : (
            <p className="text-sm text-ink-2">
              Only an administrator can change letter templates. {current ? `On file: ${describe(current)}.` : "No template set yet."}
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
