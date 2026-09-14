import "server-only";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import {
  assessReadiness,
  determineEnrolment,
  findDuplicates,
  type DuplicateMatch,
  type EnrolmentDecision,
  type MatchCandidate,
  type Readiness,
} from "./rules";
import { loadStatutoryConfig } from "@/lib/payroll/load";
import { DEFAULT_STRUCTURE } from "@/lib/payroll/engine";
import { evaluateStructure } from "@/lib/payroll/compensation";

export const DOC_CHECKLIST = [
  { docType: "PAN", label: "PAN card", category: "identity" as const, mandatory: true },
  { docType: "AADHAAR", label: "Aadhaar or alternate ID", category: "identity" as const, mandatory: true },
  { docType: "BANK_PROOF", label: "Cancelled cheque or statement header", category: "banking" as const, mandatory: true },
  { docType: "RELIEVING", label: "Relieving letter", category: "employment" as const, mandatory: false },
  { docType: "PAYSLIPS", label: "Last three payslips", category: "employment" as const, mandatory: false },
  { docType: "FORM16", label: "Previous employer Form 16", category: "employment" as const, mandatory: false },
  { docType: "DEGREE", label: "Highest qualification certificate", category: "education" as const, mandatory: true },
  { docType: "PHOTO", label: "Photograph", category: "personal" as const, mandatory: false },
  { docType: "ADDRESS", label: "Address proof", category: "personal" as const, mandatory: false },
];

export const DECLARATIONS = [
  { form: "epf_form_11" as const, label: "EPF Form 11 — previous membership" },
  { form: "epf_form_2" as const, label: "EPF Form 2 — nomination" },
  { form: "gratuity_form_f" as const, label: "Form F — gratuity nomination" },
  { form: "esic_form_1" as const, label: "ESIC Form 1 — declaration" },
  { form: "form_12bb" as const, label: "Form 12BB — tax declarations" },
];

export const PROVISIONING_TASKS = [
  { owner: "it" as const, label: "Create email and directory account", dueOffsetDays: -2 },
  { owner: "it" as const, label: "Allocate laptop and peripherals", dueOffsetDays: -1 },
  { owner: "it" as const, label: "Provision application access", dueOffsetDays: 0 },
  { owner: "admin" as const, label: "Issue access card and seat", dueOffsetDays: 0 },
  { owner: "hr" as const, label: "Induction and policy acknowledgements", dueOffsetDays: 1 },
  { owner: "hr" as const, label: "Assign buddy or mentor", dueOffsetDays: 0 },
  { owner: "finance" as const, label: "Verify bank and tax details", dueOffsetDays: -1 },
  { owner: "manager" as const, label: "Team introduction and first-week plan", dueOffsetDays: 1 },
];

export type JoinerView = {
  joiner: typeof s.joiners.$inferSelect;
  company: typeof s.companies.$inferSelect;
  branch: typeof s.branches.$inferSelect | null;
  department: typeof s.departments.$inferSelect | null;
  grade: typeof s.grades.$inferSelect | null;
  documents: (typeof s.joinerDocuments.$inferSelect)[];
  declarations: (typeof s.joinerDeclarations.$inferSelect)[];
  tasks: (typeof s.joinerTasks.$inferSelect)[];
  readiness: Readiness;
  enrolment: EnrolmentDecision[];
  duplicates: DuplicateMatch[];
};

export async function listJoiners(companyIds: string[]) {
  if (companyIds.length === 0) return [];
  const rows = await db
    .select({
      joiner: s.joiners,
      company: s.companies,
      branch: s.branches,
    })
    .from(s.joiners)
    .innerJoin(s.companies, eq(s.joiners.companyId, s.companies.id))
    .leftJoin(s.branches, eq(s.joiners.branchId, s.branches.id))
    .where(inArray(s.joiners.companyId, companyIds))
    .orderBy(asc(s.joiners.proposedDoj));

  const ids = rows.map((r) => r.joiner.id);
  const docs = ids.length
    ? await db.select().from(s.joinerDocuments).where(inArray(s.joinerDocuments.joinerId, ids))
    : [];
  const tasks = ids.length
    ? await db.select().from(s.joinerTasks).where(inArray(s.joinerTasks.joinerId, ids))
    : [];
  const decls = ids.length
    ? await db.select().from(s.joinerDeclarations).where(inArray(s.joinerDeclarations.joinerId, ids))
    : [];

  return rows.map((r) => {
    const d = docs.filter((x) => x.joinerId === r.joiner.id);
    const t = tasks.filter((x) => x.joinerId === r.joiner.id);
    const dc = decls.filter((x) => x.joinerId === r.joiner.id);
    const mandatory = d.filter((x) => x.mandatory);
    return {
      ...r,
      readiness: assessReadiness({
        profileSubmitted: Boolean(r.joiner.profileSubmittedAt),
        mandatoryDocsTotal: mandatory.length,
        mandatoryDocsVerified: mandatory.filter((x) => x.status === "verified").length,
        declarationsTotal: dc.filter((x) => x.status !== "not_applicable").length,
        declarationsSubmitted: dc.filter((x) => x.status === "submitted").length,
        tasksTotal: t.length,
        tasksDone: t.filter((x) => x.status === "done" || x.status === "waived").length,
        offerAccepted: r.joiner.offerStatus === "accepted",
        bgvStatus: r.joiner.bgvStatus,
        hasPan: Boolean(r.joiner.pan),
        hasBankDetails: Boolean(r.joiner.bankAccount && r.joiner.ifsc),
      }),
    };
  });
}

export async function loadJoiner(joinerId: string): Promise<JoinerView | null> {
  const [row] = await db
    .select({
      joiner: s.joiners,
      company: s.companies,
      branch: s.branches,
    })
    .from(s.joiners)
    .innerJoin(s.companies, eq(s.joiners.companyId, s.companies.id))
    .leftJoin(s.branches, eq(s.joiners.branchId, s.branches.id))
    .where(eq(s.joiners.id, joinerId))
    .limit(1);

  if (!row) return null;
  const j = row.joiner;

  const [department] = j.departmentId
    ? await db.select().from(s.departments).where(eq(s.departments.id, j.departmentId)).limit(1)
    : [];
  const [grade] = j.gradeId
    ? await db.select().from(s.grades).where(eq(s.grades.id, j.gradeId)).limit(1)
    : [];

  const [documents, declarations, tasks] = await Promise.all([
    db.select().from(s.joinerDocuments).where(eq(s.joinerDocuments.joinerId, j.id)).orderBy(asc(s.joinerDocuments.sequence)),
    db.select().from(s.joinerDeclarations).where(eq(s.joinerDeclarations.joinerId, j.id)),
    db.select().from(s.joinerTasks).where(eq(s.joinerTasks.joinerId, j.id)).orderBy(asc(s.joinerTasks.sequence)),
  ]);

  const mandatory = documents.filter((d) => d.mandatory);
  const readiness = assessReadiness({
    profileSubmitted: Boolean(j.profileSubmittedAt),
    mandatoryDocsTotal: mandatory.length,
    mandatoryDocsVerified: mandatory.filter((d) => d.status === "verified").length,
    declarationsTotal: declarations.filter((d) => d.status !== "not_applicable").length,
    declarationsSubmitted: declarations.filter((d) => d.status === "submitted").length,
    tasksTotal: tasks.length,
    tasksDone: tasks.filter((t) => t.status === "done" || t.status === "waived").length,
    offerAccepted: j.offerStatus === "accepted",
    bgvStatus: j.bgvStatus,
    hasPan: Boolean(j.pan),
    hasBankDetails: Boolean(j.bankAccount && j.ifsc),
  });

  /* Statutory enrolment preview — FR-ONB-9 */
  const statutory = await loadStatutoryConfig(j.proposedDoj);
  const stateCode = row.branch?.stateCode ?? "";
  const monthlyGross = j.offeredCtcPaise ? Math.round(j.offeredCtcPaise / 12) : 0;
  const pfWage = evaluateStructure(DEFAULT_STRUCTURE, monthlyGross).epfBasePaise;

  const enrolment = determineEnrolment({
    monthlyGrossPaise: monthlyGross,
    pfWagePaise: pfWage,
    hadPriorPfMembership: j.hadPriorPfMembership,
    hasUan: Boolean(j.uan),
    stateCode,
    esicImplementedArea: row.branch?.esicImplementedArea ?? false,
    ptApplicableInState: statutory.ptApplicableByState[stateCode] ?? false,
    lwfApplicableInState: statutory.lwfApplicableByState[stateCode] ?? false,
    epfCeilingPaise: statutory.epf.wageCeilingPaise,
    esicThresholdPaise: statutory.esic.wageThresholdPaise,
  });

  /* Duplicate & rehire detection — FR-ONB-15 */
  const existing = await db
    .select({
      id: s.employees.id,
      empCode: s.employees.empCode,
      firstName: s.employees.firstName,
      lastName: s.employees.lastName,
      pan: s.employees.pan,
      uan: s.employees.uan,
      email: s.employees.email,
      personalEmail: s.employees.personalEmail,
      mobile: s.employees.mobile,
      status: s.employees.status,
      dateOfExit: s.employees.dateOfExit,
    })
    .from(s.employees)
    .where(eq(s.employees.companyId, j.companyId));

  const candidates: MatchCandidate[] = existing.map((e) => ({
    id: e.id,
    empCode: e.empCode,
    name: `${e.firstName} ${e.lastName}`,
    pan: e.pan,
    uan: e.uan,
    email: e.email,
    personalEmail: e.personalEmail,
    mobile: e.mobile,
    status: e.status,
    dateOfExit: e.dateOfExit,
    rehireEligible: null,
  }));

  const duplicates = findDuplicates(
    { pan: j.pan, uan: j.uan, personalEmail: j.personalEmail, mobile: j.mobile },
    candidates,
  );

  return {
    joiner: j,
    company: row.company,
    branch: row.branch,
    department: department ?? null,
    grade: grade ?? null,
    documents,
    declarations,
    tasks,
    readiness,
    enrolment,
    duplicates,
  };
}

/** Portal lookup by token — no session, no account. */
export async function loadJoinerByToken(token: string) {
  const [row] = await db
    .select({ joiner: s.joiners, company: s.companies })
    .from(s.joiners)
    .innerJoin(s.companies, eq(s.joiners.companyId, s.companies.id))
    .where(
      and(
        eq(s.joiners.portalToken, token),
        or(
          isNull(s.joiners.portalTokenExpiresAt),
          // Lexicographic compare works on ISO timestamps.
          eq(s.joiners.portalTokenExpiresAt, s.joiners.portalTokenExpiresAt),
        ),
      ),
    )
    .limit(1);

  if (!row) return null;
  if (
    row.joiner.portalTokenExpiresAt &&
    row.joiner.portalTokenExpiresAt < new Date().toISOString()
  ) {
    return null;
  }
  if (row.joiner.status === "joined" || row.joiner.status === "dropped") return null;

  const documents = await db
    .select()
    .from(s.joinerDocuments)
    .where(eq(s.joinerDocuments.joinerId, row.joiner.id))
    .orderBy(asc(s.joinerDocuments.sequence));

  return { ...row, documents };
}
