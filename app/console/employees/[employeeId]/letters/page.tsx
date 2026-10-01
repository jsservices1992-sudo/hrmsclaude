import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSessionUser, canAccessCompany, canActOnPeople } from "@/lib/auth/session";
import { LETTER_TYPES, isLetterType, type LetterType } from "@/lib/letters/template";
import type { LetterTheme } from "@/lib/letters/themes";
import { letterFieldsFor, nextRefNo } from "@/lib/letters/fields";
import { loadIssuedLetters } from "../../letters";
import { IssueTextLetterForm, IssueFileLetterForm } from "./forms";
import { Card, Badge, Tabs, TabLink } from "@/components/console/ui";
import { formatDate } from "@/lib/format/date";

export const metadata = { title: "Letters" };

export default async function EmployeeLettersPage(
  props: PageProps<"/console/employees/[employeeId]/letters">,
) {
  const user = (await getSessionUser())!;
  const { employeeId } = await props.params;
  const sp = await props.searchParams;

  const [emp] = await db.select().from(s.employees).where(eq(s.employees.id, employeeId)).limit(1);
  if (!emp) notFound();
  if (!canAccessCompany(user, emp.companyId)) redirect("/console?denied=letters");

  const requestedType = typeof sp.type === "string" ? sp.type : "offer";
  const activeType: LetterType = isLetterType(requestedType) ? requestedType : "offer";

  const [template] = await db
    .select()
    .from(s.letterTemplates)
    .where(and(eq(s.letterTemplates.companyId, emp.companyId), eq(s.letterTemplates.type, activeType)))
    .limit(1);

  const [{ values, inputDefaults }, refNo, [company]] = await Promise.all([
    letterFieldsFor(employeeId),
    nextRefNo(employeeId, activeType, emp.empCode, new Date().toISOString().slice(0, 10)),
    db.select().from(s.companies).where(eq(s.companies.id, emp.companyId)).limit(1),
  ]);
  const head = {
    name: company.legalName || company.name,
    address: values.company_address ?? "",
    cin: company.cin,
    logoUrl: company.logoUrl,
  };

  const issued = await loadIssuedLetters(employeeId);
  const canIssue = canActOnPeople(user);

  return (
    <div className="flex flex-col gap-5 max-w-[80rem]">
      <div>
        <Link href={`/console/employees/${employeeId}`} className="text-sm font-medium text-ink-2 hover:text-ink">
          ← {emp.firstName} {emp.lastName}
        </Link>
        <h1 className="text-xl font-semibold text-ink mt-1">Letters</h1>
      </div>

      <Tabs>
        {LETTER_TYPES.map((t) => (
          <TabLink key={t.type} href={`/console/employees/${employeeId}/letters?type=${t.type}`} active={t.type === activeType}>
            {t.label}
          </TabLink>
        ))}
      </Tabs>

      <Card padded={false}>
        <div className="px-4 py-2.5 border-b border-line-2">
          <span className="text-[15px] font-semibold text-ink">
            {LETTER_TYPES.find((t) => t.type === activeType)?.label}
          </span>
        </div>
        <div className="p-5">
          {!template ? (
            <p className="text-sm text-ink-2">
              No template is set for this letter type.{" "}
              <Link href={`/console/settings/letters?company=${emp.companyId}`} className="text-indigo hover:underline">
                Add one under Settings → Letter templates
              </Link>
              .
            </p>
          ) : !canIssue ? (
            <p className="text-sm text-ink-2">Your role cannot issue letters.</p>
          ) : template.mode === "text" ? (
            <IssueTextLetterForm
              employeeId={employeeId}
              type={activeType}
              template={template.bodyText ?? ""}
              values={values}
              inputDefaults={inputDefaults}
              theme={(template.theme ?? "classic") as LetterTheme}
              signatoryName={template.signatoryName}
              signatoryTitle={template.signatoryTitle}
              company={head}
              refNo={refNo}
              addresseeAddress={values.employee_address ?? ""}
            />
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-ink-2">
                Company file: {template.fileName} — handed over exactly as uploaded, no fields merged.
              </p>
              <IssueFileLetterForm employeeId={employeeId} type={activeType} />
            </div>
          )}
        </div>
      </Card>

      <Card padded={false}>
        <div className="px-4 py-2.5 border-b border-line-2">
          <span className="text-[15px] font-semibold text-ink">Issued to this employee</span>
        </div>
        {issued.length === 0 ? (
          <p className="px-4 py-4 text-sm text-ink-3">Nothing issued yet.</p>
        ) : (
          <ul className="divide-y divide-line-2">
            {issued.map((l) => (
              <li key={l.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <Link
                    href={`/console/employees/${employeeId}/letters/${l.id}`}
                    className="text-ink font-medium hover:text-indigo hover:underline"
                  >
                    {LETTER_TYPES.find((t) => t.type === l.type)?.label ?? l.type}
                  </Link>
                  <span className="text-ink-3 ml-2">
                    {l.refNo ? `${l.refNo} · ` : ""}{formatDate(l.issuedAt.slice(0, 10))} · {l.issuedBy}
                  </span>
                </div>
                <Badge tone={l.mode === "text" ? "indigo" : "brass"}>{l.mode === "text" ? "Text" : "File"}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
