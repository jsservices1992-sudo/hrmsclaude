import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, like, or, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSessionUser, type SessionUser } from "../auth/session";
import {
  detectAlerts,
  DEFAULT_THRESHOLDS,
  DEFAULT_SOD,
  type ChangeEvent,
  type SodPolicy,
  type SodRule,
} from "./controls";

export type AuditSource = "interface" | "api" | "import" | "automation";

/**
 * The single way anything is written to the audit log — PRD §3.15,
 * FR-AUD-1. Actor, role and source are captured from the session rather
 * than passed in, because a caller that can choose its own role is not an
 * audit trail.
 */
export async function recordAudit(entry: {
  user: Pick<SessionUser, "email" | "role">;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  source?: AuditSource;
  affectedCount?: number;
}): Promise<void> {
  await db.insert(s.auditLog).values({
    id: randomUUID(),
    at: new Date().toISOString(),
    actor: entry.user.email,
    actorRole: entry.user.role,
    source: entry.source ?? "interface",
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    before: entry.before ? JSON.stringify(entry.before) : null,
    after: entry.after ? JSON.stringify(entry.after) : null,
    reason: entry.reason ?? null,
    affectedCount: entry.affectedCount ?? null,
  });
}

/**
 * The same, for call sites that hold an actor email rather than the
 * session user. The role is resolved from the live session rather than
 * trusted from the caller — a role a caller can name is not evidence.
 */
export async function recordAuditAs(entry: {
  actor: string;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  source?: AuditSource;
  affectedCount?: number;
}): Promise<void> {
  const session = await getSessionUser();
  await recordAudit({
    ...entry,
    user: {
      email: entry.actor,
      // Only attribute a role when the session and the actor agree.
      role: session?.email === entry.actor ? session.role : (null as never),
    },
  });
}

/**
 * Reads of compensation and bank data — FR-AUD-6.
 *
 * Deliberately fire-and-forget: a logging failure must never stop someone
 * doing their job, but it is reported to the server log rather than
 * swallowed, because silently losing access records defeats the purpose.
 */
export async function recordAccess(entry: {
  user: Pick<SessionUser, "email" | "role">;
  dataClass: "compensation" | "bank" | "tax";
  surface: string;
  companyId?: string | null;
  subjectEmployeeId?: string | null;
  rowCount?: number;
  filterApplied?: string | null;
}): Promise<void> {
  try {
    await db.insert(s.accessLog).values({
      id: randomUUID(),
      at: new Date().toISOString(),
      actor: entry.user.email,
      actorRole: entry.user.role,
      dataClass: entry.dataClass,
      surface: entry.surface,
      companyId: entry.companyId ?? null,
      subjectEmployeeId: entry.subjectEmployeeId ?? null,
      rowCount: entry.rowCount ?? 1,
      filterApplied: entry.filterApplied ?? null,
    });
  } catch (error) {
    console.error("[access-log] failed to record a compensation read", error);
  }
}

/* ==================================================================
   Segregation of duties — FR-AUD-4
   ================================================================== */

export async function loadSodPolicies(companyId: string): Promise<SodPolicy[]> {
  const rows = await db
    .select()
    .from(s.sodPolicies)
    .where(eq(s.sodPolicies.companyId, companyId));

  if (rows.length === 0) return DEFAULT_SOD;

  // A rule with no stored row keeps its default rather than vanishing.
  return DEFAULT_SOD.map((d) => {
    const stored = rows.find((r) => r.rule === d.rule);
    return stored
      ? {
          rule: stored.rule as SodRule,
          enabled: stored.enabled,
          coolingDays: stored.coolingDays ?? d.coolingDays,
        }
      : d;
  });
}

/** Bank-detail changes touching employees in a run, for the cooling window. */
export async function bankChangesFor(args: {
  employeeIds: string[];
  sinceIso: string;
}): Promise<{ actor: string; at: string; employeeId: string }[]> {
  if (args.employeeIds.length === 0) return [];

  const rows = await db
    .select()
    .from(s.auditLog)
    .where(
      and(
        gte(s.auditLog.at, args.sinceIso),
        or(
          like(s.auditLog.action, "employee.bank%"),
          like(s.auditLog.action, "bank_account.%"),
        ),
      ),
    );

  return rows
    .filter((r) => r.entityId && args.employeeIds.includes(r.entityId))
    .map((r) => ({ actor: r.actor, at: r.at, employeeId: r.entityId! }));
}

/* ==================================================================
   Alerts — FR-AUD-5
   ================================================================== */

function toChangeEvent(row: typeof s.auditLog.$inferSelect): ChangeEvent {
  const parse = (value: string | null) => {
    if (!value) return null;
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  return {
    action: row.action,
    actor: row.actor,
    at: row.at,
    entity: row.entity,
    entityId: row.entityId,
    source: row.source,
    before: parse(row.before),
    after: parse(row.after),
    affectedCount: row.affectedCount ?? undefined,
  };
}

/**
 * Scan recent audit entries and persist any alert not already raised.
 * Re-running is safe: an alert is identified by kind, actor and instant,
 * so the same event never raises twice.
 */
export async function refreshAlerts(args: {
  companyId: string;
  sinceIso: string;
  disbursementDate: string | null;
}): Promise<number> {
  const rows = await db
    .select()
    .from(s.auditLog)
    .where(gte(s.auditLog.at, args.sinceIso))
    .orderBy(desc(s.auditLog.at))
    .limit(1000);

  const alerts = detectAlerts({
    events: rows.map(toChangeEvent),
    thresholds: DEFAULT_THRESHOLDS,
    disbursementDate: args.disbursementDate,
  });

  const existing = await db
    .select({
      kind: s.controlAlerts.kind,
      actor: s.controlAlerts.actor,
      raisedAt: s.controlAlerts.raisedAt,
    })
    .from(s.controlAlerts)
    .where(eq(s.controlAlerts.companyId, args.companyId));

  const seen = new Set(
    existing.map((e) => `${e.kind}::${e.actor}::${e.raisedAt}`),
  );

  const fresh = alerts.filter(
    (a) => !seen.has(`${a.kind}::${a.actor}::${a.at}`),
  );

  if (fresh.length === 0) return 0;

  await db.insert(s.controlAlerts).values(
    fresh.map((a) => ({
      id: randomUUID(),
      companyId: args.companyId,
      kind: a.kind,
      severity: a.severity,
      title: a.title,
      detail: a.detail,
      actor: a.actor,
      raisedAt: a.at,
      entityId: a.entityId,
      acknowledgedBy: null,
      acknowledgedAt: null,
      acknowledgementNote: null,
    })),
  );

  return fresh.length;
}

export async function loadAlerts(companyId: string, includeAcknowledged = false) {
  const rows = await db
    .select()
    .from(s.controlAlerts)
    .where(eq(s.controlAlerts.companyId, companyId))
    .orderBy(desc(s.controlAlerts.raisedAt))
    .limit(200);

  return includeAcknowledged ? rows : rows.filter((r) => !r.acknowledgedAt);
}

/* ==================================================================
   Access log reading — FR-AUD-6
   ================================================================== */

export async function loadAccessLog(args: {
  companyIds: string[];
  limit?: number;
}) {
  if (args.companyIds.length === 0) return [];

  const rows = await db
    .select({ log: s.accessLog, subject: s.employees })
    .from(s.accessLog)
    .leftJoin(s.employees, eq(s.accessLog.subjectEmployeeId, s.employees.id))
    .where(
      or(
        inArray(s.accessLog.companyId, args.companyIds),
        sql`${s.accessLog.companyId} is null`,
      ),
    )
    .orderBy(desc(s.accessLog.at))
    .limit(args.limit ?? 100);

  return rows.map(({ log, subject }) => ({
    ...log,
    subjectCode: subject?.empCode ?? null,
    subjectName: subject ? `${subject.firstName} ${subject.lastName}` : null,
  }));
}

/** Bulk reads, which are the ones worth looking at first. */
export async function loadBulkAccess(companyIds: string[], minRows = 10) {
  const rows = await loadAccessLog({ companyIds, limit: 500 });
  return rows.filter((r) => r.rowCount >= minRows);
}

/* ==================================================================
   Legal holds — FR-AUD-8
   ================================================================== */

export async function loadLegalHolds(companyId: string) {
  const rows = await db
    .select({ hold: s.legalHolds, emp: s.employees })
    .from(s.legalHolds)
    .leftJoin(s.employees, eq(s.legalHolds.employeeId, s.employees.id))
    .where(eq(s.legalHolds.companyId, companyId))
    .orderBy(desc(s.legalHolds.placedAt));

  return rows.map(({ hold, emp }) => ({
    ...hold,
    employeeCode: emp?.empCode ?? null,
    employeeName: emp ? `${emp.firstName} ${emp.lastName}` : null,
  }));
}
