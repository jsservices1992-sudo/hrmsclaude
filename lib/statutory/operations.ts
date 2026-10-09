import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db as defaultDb } from "@/db";
import * as s from "@/db/schema";
import * as c from "@/db/compliance-schema";
import { authoritativeRuns } from "@/lib/payroll/authoritative-runs";
import { codeWageSplit } from "@/lib/payroll/esic-wage";
import { applicableMinimumWage } from "@/lib/payroll/compensation";
import { ageAsOfMonth } from "./ecr";
import { epsEvidenceNeedsReview } from "@/lib/payroll/eps-evidence";
import { loadStatutoryConfig } from "@/lib/payroll/load";
import { APPROVED_STATUSES, buildEpfReturn, buildEsicReturn, loadRegister } from "./load";
import { annualBonus, bonusDueDate, bonusSurplus, nationalFloor, statutoryOvertime, workerLeaveYear, type BonusCarry } from "./workflow-rules";

export function periodDates(year: number, month: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2200 || !Number.isInteger(month) || month < 1 || month > 12) throw new Error("Choose a valid year and month");
  return { from: `${year}-${String(month).padStart(2, "0")}-01`, to: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) };
}
export function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function epsHistoryDigest(e: { epsMember: boolean | null; epsJoiningWagePaise: number | null; epsRevisionWagePaise: number | null; dateOfJoining: string; dateOfBirth: string | null; uan: string | null }) {
  return digest({ epsMember: e.epsMember, joiningWagePaise: e.epsJoiningWagePaise, revisionWagePaise: e.epsRevisionWagePaise,
    dateOfJoining: e.dateOfJoining, dateOfBirth: e.dateOfBirth, uan: e.uan });
}

export async function operationData(companyId: string, year: number, month: number, db: Pick<typeof defaultDb, "select"> = defaultDb) {
  periodDates(year, month);
  const [company] = await db.select().from(s.companies).where(eq(s.companies.id, companyId));
  const employees = await db.select().from(s.employees).where(eq(s.employees.companyId, companyId)).orderBy(asc(s.employees.empCode));
  const ids = employees.map(e => e.id);
  const fy = month >= 4 ? year : year - 1;
  const deposits = await db.select().from(c.statutoryDeposits).where(eq(c.statutoryDeposits.companyId, companyId)).orderBy(desc(c.statutoryDeposits.recordedAt));
  const ledger = ids.length ? await db.select().from(s.tdsLedger).where(and(inArray(s.tdsLedger.employeeId, ids), eq(s.tdsLedger.financialYear, fy))).orderBy(asc(s.tdsLedger.id)) : [];
  const allocations = deposits.length ? await db.select().from(c.tdsAllocations).where(inArray(c.tdsAllocations.depositId, deposits.map(d => d.id))) : [];
  const registers = await db.select().from(c.complianceRegisters).where(eq(c.complianceRegisters.companyId, companyId)).orderBy(desc(c.complianceRegisters.preparedAt));
  const notifications = await db.select().from(c.ruleNotifications).orderBy(desc(c.ruleNotifications.effectiveFrom));
  const eps = employees.map(e => ({ id: e.id, empCode: e.empCode, name: `${e.firstName} ${e.lastName}`, uan: e.uan,
    epsMember: e.epsMember, joiningWagePaise: e.epsJoiningWagePaise, revisionWagePaise: e.epsRevisionWagePaise,
    needsReview: epsEvidenceNeedsReview(e, periodDates(year, month).to),
    transitionRequired: e.dateOfJoining < "2026-09-17" && e.epsMember !== true && e.epsRevisionWagePaise !== null
      && e.epsRevisionWagePaise <= 2500000 && ageAsOfMonth(e.dateOfBirth, 2026, 9) !== null && ageAsOfMonth(e.dateOfBirth, 2026, 9)! < 58,
    review: registers.find(r => r.kind === "eps_review" && r.employeeId === e.id && r.status === "posted"
      && JSON.parse(r.snapshotJson).employeeDigest === epsHistoryDigest(e)),
  }));
  return { company, employees, deposits, ledger, allocations, registers, notifications, eps };
}

export function quarterMonths(quarter: number) { return quarter === 4 ? [1, 2, 3] : [quarter * 3 + 1, quarter * 3 + 2, quarter * 3 + 3]; }
export function filingDigest(data: Awaited<ReturnType<typeof operationData>>, quarter: number) {
  const ledger = data.ledger.filter(l => quarterMonths(quarter).includes(l.month));
  const allocations = data.allocations.filter(a => ledger.some(l => l.id === a.ledgerId));
  return digest({ tan: data.company?.tan, legalName: data.company?.legalName, ledger,
    allocations: allocations.sort((a, b) => a.id.localeCompare(b.id)),
    deposits: data.deposits.filter(d => allocations.some(a => a.depositId === d.id)).sort((a, b) => a.id.localeCompare(b.id)),
    employees: data.employees.filter(e => ledger.some(l => l.employeeId === e.id)).map(e => ({ id: e.id, pan: e.pan, name: `${e.firstName} ${e.lastName}` })) });
}

export async function periodLiabilities(companyId: string, year: number, month: number) {
  const data = await operationData(companyId, year, month);
  const tds = data.ledger.filter(l => l.month === month).reduce((sum, l) => sum + l.tdsPaise, 0);
  const register = await loadRegister(companyId, year, month);
  const rows = [{ scheme: "tds", stateCode: "-", amountPaise: tds }];
  if (register && APPROVED_STATUSES.has(register.run.status)) {
    const epf = await buildEpfReturn(register);
    if (epf.blocking.length === 0) rows.push({ scheme: "epf", stateCode: "-", amountPaise: epf.challan.totalPaise });
    const esic = buildEsicReturn(register);
    rows.push({ scheme: "esic", stateCode: "-", amountPaise: esic.summary.totalPayablePaise });
    const states = new Set(register.lines.map(l => l.stateCode));
    for (const stateCode of states) for (const scheme of ["pt", "lwf"]) {
      rows.push({ scheme, stateCode, amountPaise: register.lines.filter(l => l.stateCode === stateCode)
        .reduce((sum, l) => sum + (scheme === "pt" ? l.amounts.PT ?? 0 : (l.amounts.LWF_EE ?? 0) + (l.amounts.LWF_ER ?? 0)), 0) });
    }
  }
  return { rows, approvedRun: register && APPROVED_STATUSES.has(register.run.status) ? register.run.id : null };
}

export async function salaryRate(employeeId: string, asOf: string, db: Pick<typeof defaultDb, "select"> = defaultDb) {
  const salaries = await db.select().from(s.employeeSalaries).where(and(eq(s.employeeSalaries.employeeId, employeeId), lte(s.employeeSalaries.effectiveFrom, asOf)))
    .orderBy(desc(s.employeeSalaries.effectiveFrom));
  const salary = salaries.find(r => !r.effectiveTo || r.effectiveTo >= asOf);
  if (!salary || salary.monthlyGrossPaise <= 0) throw new Error("An effective salary is required");
  if (salary.payMode === "take_home") throw new Error("Take-home contracts require a reviewed ordinary wage before automated overtime processing");
  return salary.monthlyGrossPaise;
}

export async function prepareOvertime(companyId: string, employeeId: string, year: number, month: number, divisor: number, db: Pick<typeof defaultDb, "select"> = defaultDb) {
  const { from, to } = periodDates(year, month);
  const [employee] = await db.select().from(s.employees).where(and(eq(s.employees.id, employeeId), eq(s.employees.companyId, companyId)));
  if (!employee) throw new Error("Employee not found");
  const coverageRows = await db.select().from(c.complianceRegisters).where(and(eq(c.complianceRegisters.companyId, companyId),
    eq(c.complianceRegisters.employeeId, employeeId), eq(c.complianceRegisters.kind, "worker_coverage"), eq(c.complianceRegisters.status, "posted")))
    .orderBy(desc(c.complianceRegisters.preparedAt));
  const coverage = coverageRows.find(r => JSON.parse(r.snapshotJson).effectiveFrom <= from);
  if (!coverage || !JSON.parse(coverage.snapshotJson).overtimeCovered) throw new Error("Record reviewed overtime coverage first");
  if (to > new Date().toISOString().slice(0, 10)) throw new Error("Close the attendance month before preparing its overtime register");
  const first = new Date(from + "T00:00:00Z"); first.setUTCDate(first.getUTCDate() - (first.getUTCDay() + 6) % 7);
  const weekStart = first.toISOString().slice(0, 10);
  const records = await db.select().from(s.attendanceRecords).where(and(eq(s.attendanceRecords.employeeId, employeeId), gte(s.attendanceRecords.date, weekStart), lte(s.attendanceRecords.date, to)));
  const [shift] = await db.select().from(s.shifts).where(and(eq(s.shifts.companyId, companyId), eq(s.shifts.isDefault, true))).limit(1);
  const offs = new Set((shift?.weeklyOffDays ?? "0").split(",").map(Number));
  const holidays = await db.select().from(s.holidays).where(and(eq(s.holidays.companyId, companyId), gte(s.holidays.date, weekStart), lte(s.holidays.date, to), eq(s.holidays.restricted, false)));
  const holidayDays = new Set(holidays.filter(h => !h.branchId || h.branchId === employee.branchId).map(h => h.date));
  // A partial first week must include earlier days to apply the weekly threshold.
  for (let d = new Date(weekStart + "T00:00:00Z"); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    if (day >= employee.dateOfJoining && (!employee.dateOfExit || day <= employee.dateOfExit)
      && !records.some(r => r.date === day)) throw new Error(`Attendance is incomplete on ${day}. Finalise daily attendance first.`);
  }
  const salaryRows = await db.select().from(s.employeeSalaries).where(eq(s.employeeSalaries.employeeId, employeeId));
  if (salaryRows.some(r => r.effectiveFrom > from && r.effectiveFrom <= to)) throw new Error("Mid-month salary revision requires dated ordinary-wage segments; do not apply a single overtime rate");
  const wage = await salaryRate(employeeId, to, db);
  const result = statutoryOvertime(records.map(r => ({ date: r.date, workedMinutes: r.workedMinutes,
    offDay: offs.has(new Date(r.date + "T00:00:00Z").getUTCDay()) || holidayDays.has(r.date) })), wage, divisor);
  const [company] = await db.select().from(s.companies).where(eq(s.companies.id, companyId));
  const rate = Math.max(result.ratePaisePerHour, company.otRatePaisePerHour ?? 0);
  const rows = result.rows.filter(r => r.date >= from && r.date <= to);
  const totalMinutes = rows.reduce((sum, r) => sum + r.overtimeMinutes, 0);
  return { employeeId, year, month, rows, totalMinutes, divisor, monthlyOrdinaryWagePaise: wage,
    ratePaisePerHour: rate, amountPaise: Math.round(totalMinutes / 60 * rate),
    inputDigest: digest({ records, salaryRows, shift, holidays, coverage: coverage.id, configuredRate: company.otRatePaisePerHour, divisor }) };
}

export async function prepareBonus(companyId: string, year: number, allocablePaise: number, db: Pick<typeof defaultDb, "select"> = defaultDb, openingCarry: BonusCarry[] = []) {
  const [company] = await db.select().from(s.companies).where(eq(s.companies.id, companyId));
  const statutory = await loadStatutoryConfig(`${year + 1}-03-31`, companyId, db);
  if (company.financialYearStartMonth !== 4) throw new Error("This annual bonus workflow uses an April-March accounting year. A different accounting year requires a reviewed dated cycle");
  if (company.declaredHeadcount === null || company.declaredHeadcount < statutory.bonusHeadcountThreshold) throw new Error("Confirm establishment bonus coverage/headcount before preparing the annual cycle");
  const runRows = await db.select().from(s.payrollRuns).where(eq(s.payrollRuns.companyId, companyId));
  const runs = authoritativeRuns(runRows).filter(r => (r.periodMonth >= 4 ? r.periodYear : r.periodYear - 1) === year);
  if (!runs.length) throw new Error("No approved salary history exists for the accounting year");
  const ids = runs.map(r => r.id);
  const summaries = await db.select().from(s.payrollEmployeeSummaries).where(inArray(s.payrollEmployeeSummaries.runId, ids));
  const lines = await db.select().from(s.payrollLines).where(inArray(s.payrollLines.runId, ids));
  const employees = await db.select().from(s.employees).where(eq(s.employees.companyId, companyId));
  const components = await db.select().from(s.payComponents).where(eq(s.payComponents.companyId, companyId));
  const floors = await db.select().from(s.minimumWages);
  const notifications = await db.select().from(c.ruleNotifications);
  const branches = await db.select().from(s.branches).where(eq(s.branches.companyId, companyId));
  const grades = await db.select().from(s.grades).where(eq(s.grades.companyId, companyId));
  const attendance = employees.length ? await db.select().from(s.attendanceRecords).where(and(inArray(s.attendanceRecords.employeeId, employees.map(e => e.id)), gte(s.attendanceRecords.date, `${year}-04-01`), lte(s.attendanceRecords.date, `${year + 1}-03-31`))) : [];
  const holidays = await db.select().from(s.holidays).where(and(eq(s.holidays.companyId, companyId), gte(s.holidays.date, `${year}-04-01`), lte(s.holidays.date, `${year + 1}-03-31`), eq(s.holidays.restricted, false)));
  const [shift] = await db.select().from(s.shifts).where(and(eq(s.shifts.companyId, companyId), eq(s.shifts.isDefault, true))).limit(1);
  const weeklyOffs = new Set((shift?.weeklyOffDays ?? "0").split(",").map(Number));
  const evidenceRows = await db.select().from(c.complianceRegisters).where(and(eq(c.complianceRegisters.companyId, companyId), eq(c.complianceRegisters.kind, "bonus"), eq(c.complianceRegisters.status, "posted")));
  const prior = evidenceRows.filter(r => r.periodYear < year).sort((a, b) => b.periodYear - a.periodYear)[0];
  if (prior && prior.periodYear !== year - 1) throw new Error("Post intervening bonus years first so carry-forward is continuous");
  if (prior && openingCarry.length) throw new Error("Opening carry cannot override the posted preceding year's carry");
  const carry: BonusCarry[] = prior ? JSON.parse(prior.snapshotJson).surplus.closingCarry : openingCarry;
  const awards = employees.filter(e => e.dateOfJoining <= `${year + 1}-03-31` && (!e.dateOfExit || e.dateOfExit >= `${year}-04-01`)
    && !["apprentice", "intern"].includes(e.employmentType)).map(e => {
    const own = summaries.filter(sm => sm.employeeId === e.id);
    const ownDays = attendance.filter(r => r.employeeId === e.id);
    let annualWorkingDays = 0;
    for (const d = new Date(`${year}-04-01T00:00:00Z`); d.toISOString().slice(0, 10) <= `${year + 1}-03-31`; d.setUTCDate(d.getUTCDate() + 1)) {
      const day = d.toISOString().slice(0, 10);
      if (!weeklyOffs.has(d.getUTCDay()) && !holidays.some(h => h.date === day && (!h.branchId || h.branchId === e.branchId))) annualWorkingDays++;
      if (day >= e.dateOfJoining && (!e.dateOfExit || day <= e.dateOfExit) && !ownDays.some(r => r.date === day)) throw new Error(`Daily bonus work/deemed-day evidence missing for ${e.empCode} on ${day}`);
    }
    for (let i = 0; i < 12; i++) {
      const month = (i + 3) % 12 + 1, y = month >= 4 ? year : year + 1;
      const p = periodDates(y, month);
      if (e.dateOfJoining <= p.to && (!e.dateOfExit || e.dateOfExit >= p.from)
        && !own.some(sm => { const run = runs.find(r => r.id === sm.runId)!; return run.periodYear === y && run.periodMonth === month; })) {
        throw new Error(`Approved salary history missing for ${e.empCode}, ${p.from.slice(0, 7)}`);
      }
    }
    const months = own.map(sm => {
      const run = runs.find(r => r.id === sm.runId)!;
      const asOf = periodDates(run.periodYear, run.periodMonth).to;
      const branch = branches.find(b => b.id === e.branchId), grade = grades.find(g => g.id === e.gradeId);
      const skill = e.skillCategory ?? grade?.skillCategory;
      if (!skill) throw new Error(`Record the skill category for ${e.empCode} before assessing bonus`);
      const floor = applicableMinimumWage(floors, branch?.stateCode ?? "", skill, asOf, branch?.minimumWageZone ?? null, companyId);
      if (!floor?.verified) throw new Error(`Verify applicable minimum wage for ${e.empCode} at ${asOf}`);
      const ownLines = lines.filter(l => l.runId === run.id && l.employeeId === e.id);
      const wage = codeWageSplit(ownLines, components).wagesPaise;
      if (sm.paidDays <= 0) throw new Error(`Zero paid-day month for ${e.empCode} requires manual reviewed bonus day attribution`);
      const wageRate = Math.round(wage * sm.totalDays / sm.paidDays);
      return { wageRatePaise: wageRate, earnedWagePaise: wage,
        minimumWagePaise: Math.max(floor.monthlyPaise, nationalFloor(notifications, branch?.stateCode ?? "", asOf) ?? 0),
        workingDays: sm.totalDays, workedDays: ownDays.filter(d => d.date >= periodDates(run.periodYear, run.periodMonth).from && d.date <= asOf)
          .reduce((sum, d) => sum + (["present", "on_duty", "half_day", "on_leave"].includes(d.status) ? Math.max(0, 1 - d.lopUnits) : d.workedMinutes > 0 ? 1 : 0), 0) };
    });
    const bonusCodes = new Set(components.filter(p => p.bonusRole === "statutory_bonus").map(p => p.code));
    const paid = lines.filter(l => l.employeeId === e.id && l.kind === "earning" && (bonusCodes.has(l.code) || l.code === "SYS_BONUS"))
      .reduce((sum, l) => sum + l.amountPaise, 0);
    return { employeeId: e.id, empCode: e.empCode, ...annualBonus({ months, eligibilityPaise: statutory.bonus.eligibilityWagePaise,
      calculationCeilingPaise: statutory.bonus.calculationCeilingPaise, alreadyPaidPaise: paid, annualWorkingDays }) };
  });
  const minimumPaise = awards.reduce((sum, a) => sum + a.minimumPaise, 0), maximumPaise = awards.reduce((sum, a) => sum + a.maximumPaise, 0);
  const surplus = bonusSurplus({ year, allocablePaise, minimumPaise, maximumPaise, totalWagesPaise: awards.reduce((sum, a) => sum + a.annualWagesPaise, 0), carry });
  let remaining = surplus.payablePaise - minimumPaise;
  const extraCapacity = maximumPaise - minimumPaise;
  const result = awards.map((a, i) => {
    const capacity = a.maximumPaise - a.minimumPaise;
    const extra = i === awards.length - 1 ? Math.min(capacity, remaining)
      : Math.min(capacity, extraCapacity > 0 ? Math.floor((surplus.payablePaise - minimumPaise) * capacity / extraCapacity) : 0);
    remaining -= extra;
    const payablePaise = a.minimumPaise + extra;
    return { ...a, payablePaise, balancePaise: Math.max(0, payablePaise - a.alreadyPaidPaise) };
  });
  // Allocate any final rounding paise without exceeding individual maxima.
  for (const a of result) { const add = Math.min(remaining, a.maximumPaise - a.payablePaise); a.payablePaise += add; a.balancePaise = Math.max(0, a.payablePaise - a.alreadyPaidPaise); remaining -= add; }
  return { year, allocablePaise, openingCarry, minimumPaise, maximumPaise, surplus, awards: result, dueOn: bonusDueDate(`${year + 1}-03-31`),
    inputDigest: digest({ company, statutory: statutory.bonus, runs, summaries, lines, floors, notifications, branches, grades, prior, components, attendance, holidays, shift }) };
}

export async function prepareWorkerLeave(companyId: string, employeeId: string, year: number, facts: {
  qualifyingDeemedDays: number; openingDays: number; usedDays: number; refusedDays: number;
  policyEarnedDays: number; policyCarryCap: number; encashOnDemandDays: number; dailyWagePaise: number;
}, db: Pick<typeof defaultDb, "select"> = defaultDb) {
  const [e] = await db.select().from(s.employees).where(and(eq(s.employees.id, employeeId), eq(s.employees.companyId, companyId)));
  if (!e) throw new Error("Employee not found");
  const coverageRows = await db.select().from(c.complianceRegisters).where(and(eq(c.complianceRegisters.companyId, companyId), eq(c.complianceRegisters.employeeId, employeeId),
    eq(c.complianceRegisters.kind, "worker_coverage"), eq(c.complianceRegisters.status, "posted"))).orderBy(desc(c.complianceRegisters.preparedAt));
  const coverage = coverageRows.find(r => JSON.parse(r.snapshotJson).effectiveFrom <= `${year}-12-31`);
  if (!coverage || !JSON.parse(coverage.snapshotJson).leaveCovered) throw new Error("Record reviewed OSH worker-leave coverage first");
  if (JSON.parse(coverage.snapshotJson).effectiveFrom > (e.dateOfJoining > `${year}-01-01` ? e.dateOfJoining : `${year}-01-01`)) throw new Error("Part-year coverage requires separate dated entitlement segments; record the applicable coverage history before annual processing");
  const records = await db.select().from(s.attendanceRecords).where(and(eq(s.attendanceRecords.employeeId, employeeId), gte(s.attendanceRecords.date, `${year}-01-01`), lte(s.attendanceRecords.date, `${year}-12-31`)));
  const workedDays = records.filter(r => ["present", "on_duty", "half_day"].includes(r.status) || (["weekly_off", "holiday"].includes(r.status) && r.workedMinutes > 0)).reduce((sum, r) => sum + (r.status === "half_day" ? .5 : 1), 0);
  if (!records.length) throw new Error("Finalised daily attendance is required");
  for (const d = new Date(`${year}-01-01T00:00:00Z`); d.toISOString().slice(0, 10) <= `${year}-12-31`; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    if (day >= e.dateOfJoining && (!e.dateOfExit || day <= e.dateOfExit) && !records.some(r => r.date === day)) throw new Error(`Year-end daily attendance is incomplete on ${day}`);
  }
  const result = workerLeaveYear({ ...facts, year, dateOfJoining: e.dateOfJoining, workedDays,
    adolescentOrUnderground: JSON.parse(coverage.snapshotJson).adolescentOrUnderground,
    exited: Boolean(e.dateOfExit && e.dateOfExit <= `${year}-12-31`) });
  return { ...result, facts, employeeId, year, workedDays, encashPaise: Math.round(result.encashDays * facts.dailyWagePaise),
    inputDigest: digest({ e, records, coverage, facts }) };
}
