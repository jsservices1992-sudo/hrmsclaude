import { computeEpf, type EpfInput, type EpfParams, type EpfResult } from "./statutory";

export type EpfPeriod = { from: string; to: string; params: EpfParams };

export function epfParamsFrom(p: Record<string, number>): EpfParams {
  return {
    wageCeilingPaise: p["epf.wage_ceiling"] ?? 1500000,
    coverageCeilingPaise: p["epf.coverage_ceiling"] ?? p["epf.wage_ceiling"] ?? 1500000,
    epsCeilingPaise: p["epf.eps_ceiling"] ?? 1500000,
    edliCeilingPaise: p["epf.edli_ceiling"] ?? 1500000,
    employeeBps: p["epf.employee_bps"] ?? 1200, employerBps: p["epf.employer_bps"] ?? 1200,
    epsBps: p["epf.eps_bps"] ?? 833, edliBps: p["epf.edli_bps"] ?? 50, adminBps: p["epf.admin_bps"] ?? 50,
  };
}

export function epfPeriodsFor(rows: { key: string; value: number; effectiveFrom: string; effectiveTo: string | null }[], asOf: string): EpfPeriod[] {
  const periods: EpfPeriod[] = [];
  const year = Number(asOf.slice(0, 4));
  const month = Number(asOf.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let day = 1; day <= lastDay; day++) {
    const date = `${asOf.slice(0, 7)}-${String(day).padStart(2, "0")}`;
    const params = epfParamsFrom(Object.fromEntries(rows.filter(r => r.key.startsWith("epf.") && r.effectiveFrom <= date
      && (!r.effectiveTo || r.effectiveTo >= date)).map(r => [r.key, r.value])));
    const previous = periods.at(-1);
    if (previous && JSON.stringify(previous.params) === JSON.stringify(params)) previous.to = date;
    else periods.push({ from: date, to: date, params });
  }
  return periods;
}

/** Apportion ceiling periods before rounding the month's contributions. */
export function computePeriodEpf(input: EpfInput, args: {
  periods: EpfPeriod[]; monthlyWagePaise: number; year: number; month: number;
  dateOfJoining: string; dateOfExit?: string | null;
  pensionEligibleFor?: (period: EpfPeriod) => boolean;
  coveredPeriods?: Set<string>;
}): EpfResult {
  if (args.periods.length <= 1) return computeEpf(input);
  const daysInMonth = new Date(Date.UTC(args.year, args.month, 0)).getUTCDate();
  const monthStart = `${args.year}-${String(args.month).padStart(2, "0")}-01`;
  const monthEnd = `${args.year}-${String(args.month).padStart(2, "0")}-${daysInMonth}`;
  const start = args.dateOfJoining > monthStart ? args.dateOfJoining : monthStart;
  const end = args.dateOfExit && args.dateOfExit < monthEnd ? args.dateOfExit : monthEnd;
  const employedDays = Math.max(0, (Date.parse(end) - Date.parse(start)) / 86400000 + 1);
  const pieces = args.periods.map(period => {
    const from = period.from > start ? period.from : start;
    const to = period.to < end ? period.to : end;
    const days = Math.max(0, (Date.parse(to) - Date.parse(from)) / 86400000 + 1);
    const pensionEligible = args.pensionEligibleFor?.(period) ?? input.pensionEligible !== false;
    const result = computeEpf({ ...input, optedIn: input.optedIn || args.coveredPeriods?.has(period.from) === true,
      params: period.params, pfWagePaise: args.monthlyWagePaise, pensionEligible });
    // Wages follow employed days; statutory ceilings retain calendar fractions.
    const earned = employedDays > 0 ? input.pfWagePaise * days / employedDays : 0;
    const capped = input.onActualBasic || input.isInternationalWorker
      ? earned : Math.min(earned, period.params.wageCeilingPaise * days / daysInMonth);
    const pf = result.applicable ? capped : 0;
    const eps = result.applicable && pensionEligible && !input.isInternationalWorker
      ? Math.min(pf, period.params.epsCeilingPaise * days / daysInMonth) : 0;
    const edli = result.applicable && input.edliApplicable !== false
      ? Math.min(pf, (period.params.edliCeilingPaise ?? period.params.wageCeilingPaise) * days / daysInMonth) : 0;
    return { result, pf, eps, edli, params: period.params };
  });
  const sum = (pick: (p: typeof pieces[number]) => number) => pieces.reduce((total, p) => total + pick(p), 0);
  const rupee = (paise: number) => Math.round(paise / 100) * 100;
  const eps = rupee(sum(p => p.eps * p.params.epsBps / 10000));
  const employer = rupee(sum(p => p.pf * p.params.employerBps / 10000));
  return {
    applicable: pieces.some(p => p.result.applicable && p.pf > 0),
    pfWageConsidered: Math.round(sum(p => p.pf)), epsWagePaise: Math.round(sum(p => p.eps)),
    edliWagePaise: Math.round(sum(p => p.edli)),
    employeePaise: rupee(sum(p => p.pf * p.params.employeeBps / 10000)),
    employerPfPaise: Math.max(0, employer - eps), employerEpsPaise: eps,
    edliPaise: rupee(sum(p => p.edli * (p.params.edliBps ?? 0) / 10000)),
    adminPaise: rupee(sum(p => p.pf * (p.params.adminBps ?? 0) / 10000)),
    vpfPaise: rupee(input.pfWagePaise * (input.vpfPercent ?? 0) / 100),
    reason: `Dated PF ceiling split: ${args.periods.map(p => `${p.from} to ${p.to}`).join("; ")}`,
  };
}
