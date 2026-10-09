import { pgTable, text, integer, bigint, uniqueIndex, index } from "drizzle-orm/pg-core";
import { companies, employees, tdsLedger, exitCases } from "./schema";

export const fnfTaxReviews = pgTable("fnf_tax_reviews", {
  id: text("id").primaryKey(),
  exitCaseId: text("exit_case_id").notNull().references(() => exitCases.id),
  companyId: text("company_id").notNull().references(() => companies.id),
  factsJson: text("facts_json").notNull(),
  inputDigest: text("input_digest").notNull(),
  evidence: text("evidence").notNull(),
  recordedBy: text("recorded_by").notNull(),
  recordedAt: text("recorded_at").notNull(),
}, t => [index("fnf_tax_review_exit_idx").on(t.exitCaseId, t.recordedAt)]);

export const statutoryDeposits = pgTable("statutory_deposits", {
  id: text("id").primaryKey(), companyId: text("company_id").notNull().references(() => companies.id),
  scheme: text("scheme", { enum: ["tds", "epf", "esic", "pt", "lwf"] }).notNull(),
  stateCode: text("state_code").notNull().default("-"), periodYear: integer("period_year").notNull(),
  periodMonth: integer("period_month").notNull(), amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
  depositedOn: text("deposited_on").notNull(), reference: text("reference").notNull(),
  bsr: text("bsr"), serial: text("serial"), evidence: text("evidence").notNull(),
  recordedBy: text("recorded_by").notNull(), recordedAt: text("recorded_at").notNull(),
}, t => [uniqueIndex("statutory_deposit_reference_idx").on(t.companyId, t.scheme, t.reference),
  index("statutory_deposit_period_idx").on(t.companyId, t.periodYear, t.periodMonth)]);

export const tdsAllocations = pgTable("tds_allocations", {
  id: text("id").primaryKey(), depositId: text("deposit_id").notNull().references(() => statutoryDeposits.id),
  ledgerId: text("ledger_id").notNull().references(() => tdsLedger.id),
  amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
}, t => [uniqueIndex("tds_allocation_idx").on(t.depositId, t.ledgerId)]);

// Drafts are replaceable; posted snapshots and their evidence are immutable.
export const complianceRegisters = pgTable("compliance_registers", {
  id: text("id").primaryKey(), companyId: text("company_id").notNull().references(() => companies.id),
  employeeId: text("employee_id").references(() => employees.id),
  kind: text("kind", { enum: ["eps_review", "worker_coverage", "overtime", "bonus", "worker_leave", "filing_validation"] }).notNull(),
  sourceKey: text("source_key").notNull(), periodYear: integer("period_year").notNull(),
  periodMonth: integer("period_month").notNull().default(0),
  status: text("status", { enum: ["draft", "posted"] }).notNull().default("draft"),
  snapshotJson: text("snapshot_json").notNull(), evidence: text("evidence").notNull(),
  preparedBy: text("prepared_by").notNull(), reviewedBy: text("reviewed_by"),
  reviewEvidence: text("review_evidence"),
  preparedAt: text("prepared_at").notNull(), postedAt: text("posted_at"),
}, t => [uniqueIndex("compliance_register_source_idx").on(t.companyId, t.sourceKey),
  index("compliance_register_kind_idx").on(t.companyId, t.kind, t.periodYear)]);

export const ruleNotifications = pgTable("rule_notifications", {
  id: text("id").primaryKey(), stateCode: text("state_code").notNull(),
  subject: text("subject", { enum: ["wage_code", "osh_code", "minimum_wage", "pt", "lwf", "floor_wage"] }).notNull(),
  status: text("status", { enum: ["draft", "notified", "not_notified", "superseded"] }).notNull(),
  notificationRef: text("notification_ref").notNull(), documentUrl: text("document_url").notNull(),
  documentSha256: text("document_sha256").notNull(), effectiveFrom: text("effective_from").notNull(),
  effectiveTo: text("effective_to"), reviewedBy: text("reviewed_by").notNull(),
  reviewedAt: text("reviewed_at").notNull(), reviewNote: text("review_note").notNull(),
  monthlyFloorPaise: bigint("monthly_floor_paise", { mode: "number" }),
}, t => [index("notification_scope_idx").on(t.stateCode, t.subject, t.effectiveFrom)]);
