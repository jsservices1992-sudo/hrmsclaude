/**
 * Reporting engine — PRD §3.18.
 *
 * Most of the reports the PRD asks for already exist as views elsewhere
 * (the payroll register, statutory returns, the tax worksheet, loans,
 * gratuity/leave provisions) — this file does not recompute those. It
 * covers the reports nothing else produces: headcount reconciliation,
 * the onboarding funnel, attrition, and cost grouped by component or
 * cost centre. Month-on-month variance reuses `diffRuns` from the audit
 * module directly — it is generic over any two comparable "sides", not
 * tied to versions of one run, so a second engine for it would only
 * duplicate the first.
 */

/* ------------------------- headcount reconciliation ------------------------- */

export type HeadcountReconciliation = {
  openingCount: number;
  joiners: number;
  leavers: number;
  closingCount: number;
  expectedClosing: number;
  reconciles: boolean;
};

/**
 * Opening + joiners − leavers must equal closing, or the two counts were
 * taken from different definitions of "active" — that mismatch is the
 * finding, not a rounding note.
 */
export function reconcileHeadcount(args: {
  openingCount: number;
  joinersInPeriod: number;
  leaversInPeriod: number;
  closingCount: number;
}): HeadcountReconciliation {
  const expectedClosing = args.openingCount + args.joinersInPeriod - args.leaversInPeriod;
  return {
    openingCount: args.openingCount,
    joiners: args.joinersInPeriod,
    leavers: args.leaversInPeriod,
    closingCount: args.closingCount,
    expectedClosing,
    reconciles: expectedClosing === args.closingCount,
  };
}

/* ------------------------- onboarding funnel ------------------------- */

export type FunnelStatus = "draft" | "offer_sent" | "accepted" | "onboarding" | "joined" | "dropped";

export type OnboardingFunnel = {
  stageCounts: Record<FunnelStatus, number>;
  /** Still moving through the pipeline — neither converted nor dropped. */
  activeCount: number;
  /** Joiners whose proposed date of joining has passed without joining or dropping. */
  slaBreaches: { joinerId: string; proposedDoj: string; daysOverdue: number }[];
};

export function buildOnboardingFunnel(args: {
  joiners: { id: string; status: FunnelStatus; proposedDoj: string }[];
  today: string;
}): OnboardingFunnel {
  const stageCounts: Record<FunnelStatus, number> = {
    draft: 0,
    offer_sent: 0,
    accepted: 0,
    onboarding: 0,
    joined: 0,
    dropped: 0,
  };
  const slaBreaches: OnboardingFunnel["slaBreaches"] = [];

  for (const j of args.joiners) {
    stageCounts[j.status]++;
    if (j.status !== "joined" && j.status !== "dropped" && j.proposedDoj < args.today) {
      const daysOverdue = Math.round(
        (Date.parse(args.today + "T00:00:00Z") - Date.parse(j.proposedDoj + "T00:00:00Z")) /
          86_400_000,
      );
      slaBreaches.push({ joinerId: j.id, proposedDoj: j.proposedDoj, daysOverdue });
    }
  }

  return {
    stageCounts,
    activeCount: args.joiners.length - stageCounts.joined - stageCounts.dropped,
    slaBreaches: slaBreaches.sort((a, b) => b.daysOverdue - a.daysOverdue),
  };
}

/* ------------------------- attrition ------------------------- */

export type ExitReasonBucket = { exitType: string; count: number };

export type AttritionReport = {
  leaverCount: number;
  averageHeadcount: number;
  attritionRatePercent: number;
  /** Left within `earlyThresholdDays` of joining — a distinct signal from overall attrition. */
  earlyAttritionCount: number;
  earlyAttritionRatePercent: number;
  reasonBreakdown: ExitReasonBucket[];
};

/**
 * Reasons are bucketed by the exit type actually recorded on the case
 * (resignation, termination, ...), not a separate free-text taxonomy the
 * system does not collect — inventing categories nobody chose would make
 * the breakdown look more precise than the underlying data is.
 */
export function buildAttritionReport(args: {
  leavers: { exitType: string; dateOfJoining: string; lastWorkingDay: string }[];
  openingHeadcount: number;
  closingHeadcount: number;
  earlyThresholdDays?: number;
}): AttritionReport {
  const earlyThreshold = args.earlyThresholdDays ?? 365;
  const averageHeadcount = (args.openingHeadcount + args.closingHeadcount) / 2;
  const reasons = new Map<string, number>();
  let earlyAttritionCount = 0;

  for (const l of args.leavers) {
    const tenureDays = Math.round(
      (Date.parse(l.lastWorkingDay + "T00:00:00Z") - Date.parse(l.dateOfJoining + "T00:00:00Z")) /
        86_400_000,
    );
    if (tenureDays < earlyThreshold) earlyAttritionCount++;
    reasons.set(l.exitType, (reasons.get(l.exitType) ?? 0) + 1);
  }

  const rate = (count: number) =>
    averageHeadcount === 0 ? 0 : Math.round((count / averageHeadcount) * 10000) / 100;

  return {
    leaverCount: args.leavers.length,
    averageHeadcount,
    attritionRatePercent: rate(args.leavers.length),
    earlyAttritionCount,
    earlyAttritionRatePercent: rate(earlyAttritionCount),
    reasonBreakdown: [...reasons.entries()]
      .map(([exitType, count]) => ({ exitType, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/* ------------------------- cost grouping ------------------------- */

export type CostLine = {
  key: string;
  label: string;
  kind: "earning" | "deduction" | "employer_contribution" | "info";
  amountPaise: number;
};

export type CostBucket = {
  key: string;
  label: string;
  earningsPaise: number;
  deductionsPaise: number;
  employerCostPaise: number;
};

/**
 * Groups payroll lines by whatever key the caller supplies — a component
 * code for "component-wise cost", a department id for "cost-centre-wise
 * cost". One function serves both reports the PRD lists, because the
 * grouping is the only thing that differs between them.
 */
export function groupCost(lines: CostLine[]): CostBucket[] {
  const map = new Map<string, CostBucket>();
  for (const l of lines) {
    if (l.kind === "info") continue;
    const bucket = map.get(l.key) ?? {
      key: l.key,
      label: l.label,
      earningsPaise: 0,
      deductionsPaise: 0,
      employerCostPaise: 0,
    };
    if (l.kind === "earning") bucket.earningsPaise += l.amountPaise;
    else if (l.kind === "deduction") bucket.deductionsPaise += l.amountPaise;
    else bucket.employerCostPaise += l.amountPaise;
    map.set(l.key, bucket);
  }
  return [...map.values()].sort(
    (a, b) => b.earningsPaise + b.employerCostPaise - (a.earningsPaise + a.employerCostPaise),
  );
}
