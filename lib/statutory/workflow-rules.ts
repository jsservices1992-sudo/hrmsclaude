export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}

export function money(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Amounts must be non-negative integer paise");
  return value;
}

export function reconcileDeposit(liabilityPaise: number, deposits: { amountPaise: number }[]) {
  money(liabilityPaise);
  const paidPaise = deposits.reduce((sum, d) => sum + money(d.amountPaise), 0);
  return { liabilityPaise, paidPaise, outstandingPaise: Math.max(0, liabilityPaise - paidPaise),
    excessPaise: Math.max(0, paidPaise - liabilityPaise), matches: paidPaise === liabilityPaise };
}

export type FloorNotification = {
  stateCode: string; subject: string; status: string; effectiveFrom: string; effectiveTo: string | null;
  monthlyFloorPaise: number | null; documentUrl: string; documentSha256: string; reviewedBy: string;
};
export function nationalFloor(rows: FloorNotification[], stateCode: string, asOf: string): number | null {
  const applicable = rows.filter(r => r.subject === "floor_wage" && ["IN", stateCode].includes(r.stateCode)
    && r.effectiveFrom <= asOf && (!r.effectiveTo || r.effectiveTo >= asOf));
  const latest = new Map<string, FloorNotification>();
  for (const r of applicable) if (!latest.has(r.stateCode) || latest.get(r.stateCode)!.effectiveFrom < r.effectiveFrom) latest.set(r.stateCode, r);
  const notified = [...latest.values()].filter(r => r.status === "notified" && r.reviewedBy && r.documentUrl
    && /^[a-f0-9]{64}$/i.test(r.documentSha256) && (r.monthlyFloorPaise ?? 0) > 0);
  return notified.length ? Math.max(...notified.map(r => r.monthlyFloorPaise!)) : null;
}

export type OvertimeDay = { date: string; workedMinutes: number; offDay: boolean };
/** Count daily and weekly excess once, including weeks spanning month boundaries. */
export function statutoryOvertime(days: OvertimeDay[], monthlyOrdinaryWagePaise: number, divisor = 26) {
  money(monthlyOrdinaryWagePaise);
  if (!(divisor > 0) || divisor > 31) throw new Error("Invalid ordinary-wage divisor");
  const weeks = new Map<string, number>();
  const seen = new Set<string>();
  const rows = [...days].sort((a, b) => a.date.localeCompare(b.date)).map(d => {
    if (!validDate(d.date) || !Number.isInteger(d.workedMinutes) || d.workedMinutes < 0 || d.workedMinutes > 1440 || seen.has(d.date)) {
      throw new Error("Invalid or duplicate attendance day");
    }
    seen.add(d.date);
    const date = new Date(d.date + "T00:00:00Z");
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    const week = date.toISOString().slice(0, 10);
    const previous = weeks.get(week) ?? 0;
    const ordinary = d.offDay ? 0 : Math.min(480, d.workedMinutes);
    const dailyMinutes = d.offDay ? d.workedMinutes : Math.max(0, d.workedMinutes - 480);
    const weeklyMinutes = Math.max(0, previous + ordinary - 2880) - Math.max(0, previous - 2880);
    weeks.set(week, previous + ordinary);
    return { ...d, dailyMinutes, weeklyMinutes, overtimeMinutes: dailyMinutes + weeklyMinutes };
  });
  const ratePaisePerHour = monthlyOrdinaryWagePaise / divisor / 8 * 2;
  return { rows, ratePaisePerHour, totalMinutes: rows.reduce((sum, r) => sum + r.overtimeMinutes, 0),
    amountFor: (from: string, to: string) => Math.round(rows.filter(r => r.date >= from && r.date <= to)
      .reduce((sum, r) => sum + r.overtimeMinutes, 0) / 60 * ratePaisePerHour) };
}

export function workerLeaveYear(args: {
  year: number; dateOfJoining: string; workedDays: number; qualifyingDeemedDays: number;
  openingDays: number; usedDays: number; refusedDays: number; adolescentOrUnderground: boolean;
  exited: boolean; policyEarnedDays: number; policyCarryCap: number; encashOnDemandDays: number;
}) {
  for (const n of [args.workedDays, args.qualifyingDeemedDays, args.openingDays, args.usedDays, args.refusedDays,
    args.policyEarnedDays, args.policyCarryCap, args.encashOnDemandDays]) {
    if (!Number.isFinite(n) || n < 0) throw new Error("Invalid leave days");
  }
  if (!validDate(args.dateOfJoining)) throw new Error("Invalid joining date");
  const end = new Date(Date.UTC(args.year, 11, 31));
  const start = new Date(`${args.year}-01-01T00:00:00Z`);
  const joining = new Date(args.dateOfJoining + "T00:00:00Z");
  const employedDays = joining > end ? 0 : Math.round((end.getTime() - Math.max(start.getTime(), joining.getTime())) / 86400000) + 1;
  if (args.workedDays + args.qualifyingDeemedDays > employedDays) throw new Error("Worked/deemed days exceed employment days");
  const threshold = joining > start ? employedDays / 4 : 180;
  const eligible = employedDays > 0 && (args.exited || args.workedDays + args.qualifyingDeemedDays >= threshold);
  const statutoryEarnedDays = eligible ? Math.round(args.workedDays / (args.adolescentOrUnderground ? 15 : 20)) : 0;
  const earnedDays = Math.max(statutoryEarnedDays, args.policyEarnedDays);
  const closingDays = Math.max(0, args.openingDays + earnedDays - args.usedDays);
  const protectedDays = Math.min(closingDays, args.refusedDays);
  const ordinaryDays = closingDays - protectedDays;
  const excessDays = Math.max(0, ordinaryDays - Math.max(30, args.policyCarryCap));
  const encashDays = args.exited ? closingDays : Math.max(excessDays, Math.min(closingDays, args.encashOnDemandDays));
  return { eligible, threshold, statutoryEarnedDays, earnedDays, closingDays, protectedDays,
    carryDays: closingDays - encashDays, encashDays, lapseDays: 0 };
}

export type BonusMonth = { wageRatePaise: number; minimumWagePaise: number; earnedWagePaise: number; workingDays: number; workedDays: number };
export function annualBonus(args: { months: BonusMonth[]; eligibilityPaise: number; calculationCeilingPaise: number; alreadyPaidPaise: number; annualWorkingDays?: number }) {
  let basePaise = 0, workedDays = 0, workingDays = 0;
  for (const m of args.months) {
    money(m.wageRatePaise); money(m.earnedWagePaise); money(m.minimumWagePaise);
    if (m.minimumWagePaise <= 0 || m.wageRatePaise <= 0 || m.workingDays <= 0 || m.workedDays < 0 || m.workedDays > m.workingDays) {
      throw new Error("Verified wage floor and actual working-day evidence are required for bonus");
    }
    workedDays += m.workedDays; workingDays += m.workingDays;
    if (m.wageRatePaise <= args.eligibilityPaise) basePaise += Math.round(Math.min(m.wageRatePaise,
      Math.max(args.calculationCeilingPaise, m.minimumWagePaise)) * Math.min(1, m.earnedWagePaise / m.wageRatePaise));
  }
  const eligible = workedDays >= 30 && basePaise > 0;
  const annualDays = args.annualWorkingDays ?? workingDays;
  if (!Number.isFinite(annualDays) || annualDays <= 0 || annualDays < workedDays) throw new Error("Annual working-day denominator is invalid");
  const minimumPaise = eligible ? Math.max(Math.round(basePaise / 12), Math.round(10000 * workedDays / annualDays)) : 0;
  const maximumPaise = eligible ? Math.max(minimumPaise, Math.round(basePaise / 5)) : 0;
  return { eligible, basePaise, workedDays, annualWagesPaise: args.months.reduce((sum, m) => sum + m.earnedWagePaise, 0), minimumPaise, maximumPaise, alreadyPaidPaise: money(args.alreadyPaidPaise) };
}

export type BonusCarry = { year: number; kind: "set_on" | "set_off"; amountPaise: number };
export function bonusSurplus(args: { year: number; allocablePaise: number; minimumPaise: number; maximumPaise: number; totalWagesPaise: number; carry: BonusCarry[] }) {
  let available = money(args.allocablePaise);
  const carry = args.carry.filter(c => c.year < args.year && c.year >= args.year - 4)
    .map(c => ({ ...c, amountPaise: money(c.amountPaise) })).sort((a, b) => a.year - b.year);
  for (const c of carry) {
    const consumed = c.kind === "set_off" ? Math.min(c.amountPaise, Math.max(0, available - args.minimumPaise))
      : Math.min(c.amountPaise, Math.max(0, args.maximumPaise - available));
    available += c.kind === "set_on" ? consumed : -consumed;
    c.amountPaise -= consumed;
  }
  const payablePaise = Math.max(args.minimumPaise, Math.min(args.maximumPaise, available));
  const excess = Math.max(0, available - args.maximumPaise);
  const deficiency = Math.max(0, args.minimumPaise - available);
  const closing = carry.filter(c => c.amountPaise > 0);
  if (excess) closing.push({ year: args.year, kind: "set_on", amountPaise: Math.min(excess, Math.round(args.totalWagesPaise / 5)) });
  if (deficiency) closing.push({ year: args.year, kind: "set_off", amountPaise: deficiency });
  return { payablePaise, closingCarry: closing, expiredCarry: args.carry.filter(c => c.year < args.year - 4) };
}

export function bonusDueDate(accountingYearEnd: string): string {
  if (!validDate(accountingYearEnd)) throw new Error("Invalid accounting year end");
  const d = new Date(accountingYearEnd + "T00:00:00Z");
  const year = d.getUTCFullYear(), month = d.getUTCMonth() + 8;
  return new Date(Date.UTC(year, month, Math.min(d.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate())))
    .toISOString().slice(0, 10);
}

/** Protect CSV users from formula execution in identifiers and references. */
export function csvFile(rows: (string | number | null)[][]): string {
  return rows.map(row => row.map(cell => {
    const raw = String(cell ?? "");
    const value = typeof cell === "string" && /^[\s]*[=+@-]/.test(raw) ? "'" + raw : raw;
    return '"' + value.replaceAll('"', '""') + '"';
  }).join(",")).join("\r\n") + "\r\n";
}
