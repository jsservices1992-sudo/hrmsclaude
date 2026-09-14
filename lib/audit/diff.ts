import type { Paise } from "../payroll/money";

/**
 * Run version comparison — PRD §3.15, FR-AUD-3.
 *
 * The control objective is that for any rupee paid, the system can say
 * what it would have been before the last change. That means a diff at
 * component level, not a pair of totals: "net fell by ₹4,000" is not an
 * explanation, "loss of pay rose by three days and PT moved slab" is.
 */

export type RunSide = {
  version: number;
  status: string;
  calculatedAt: string;
  preparedBy: string;
  employees: {
    employeeId: string;
    empCode: string;
    name: string;
    grossPaise: Paise;
    deductionsPaise: Paise;
    netPaise: Paise;
    paidDays: number;
    lopDays: number;
    lines: { code: string; label: string; amountPaise: Paise }[];
  }[];
};

export type ComponentChange = {
  code: string;
  label: string;
  fromPaise: Paise;
  toPaise: Paise;
  deltaPaise: Paise;
  /** A component that appears or disappears is not the same as one that moves. */
  change: "added" | "removed" | "changed";
};

export type EmployeeDiff = {
  employeeId: string;
  empCode: string;
  name: string;
  status: "added" | "removed" | "changed" | "unchanged";
  fromNetPaise: Paise;
  toNetPaise: Paise;
  netDeltaPaise: Paise;
  fromGrossPaise: Paise;
  toGrossPaise: Paise;
  lopDelta: number;
  components: ComponentChange[];
};

export type RunDiff = {
  from: { version: number; status: string; calculatedAt: string; preparedBy: string };
  to: { version: number; status: string; calculatedAt: string; preparedBy: string };
  employees: EmployeeDiff[];
  added: EmployeeDiff[];
  removed: EmployeeDiff[];
  changed: EmployeeDiff[];
  unchangedCount: number;
  totals: {
    fromGrossPaise: Paise;
    toGrossPaise: Paise;
    grossDeltaPaise: Paise;
    fromNetPaise: Paise;
    toNetPaise: Paise;
    netDeltaPaise: Paise;
  };
  /** Component codes that moved across the whole run, largest first. */
  componentImpact: { code: string; label: string; deltaPaise: Paise; employeeCount: number }[];
  warnings: string[];
};

export function diffRuns(from: RunSide, to: RunSide): RunDiff {
  const warnings: string[] = [];

  if (from.version === to.version) {
    warnings.push("Both sides are the same version; there is nothing to compare.");
  }
  if (from.version > to.version) {
    warnings.push(
      `Comparing version ${from.version} to the earlier version ${to.version}. The direction of every difference below is reversed from what you probably expect.`,
    );
  }

  const fromById = new Map(from.employees.map((e) => [e.employeeId, e]));
  const toById = new Map(to.employees.map((e) => [e.employeeId, e]));
  const allIds = new Set([...fromById.keys(), ...toById.keys()]);

  const employees: EmployeeDiff[] = [];

  for (const id of allIds) {
    const a = fromById.get(id);
    const b = toById.get(id);

    const codes = new Set([
      ...(a?.lines.map((l) => l.code) ?? []),
      ...(b?.lines.map((l) => l.code) ?? []),
    ]);

    const components: ComponentChange[] = [];

    for (const code of codes) {
      // A code can appear more than once in a run, so sum rather than find.
      const fromAmount =
        a?.lines.filter((l) => l.code === code).reduce((x, l) => x + l.amountPaise, 0) ?? 0;
      const toAmount =
        b?.lines.filter((l) => l.code === code).reduce((x, l) => x + l.amountPaise, 0) ?? 0;

      if (fromAmount === toAmount) continue;

      const label =
        b?.lines.find((l) => l.code === code)?.label ??
        a?.lines.find((l) => l.code === code)?.label ??
        code;

      components.push({
        code,
        label,
        fromPaise: fromAmount,
        toPaise: toAmount,
        deltaPaise: toAmount - fromAmount,
        change:
          fromAmount === 0 ? "added" : toAmount === 0 ? "removed" : "changed",
      });
    }

    components.sort(
      (x, y) => Math.abs(y.deltaPaise) - Math.abs(x.deltaPaise),
    );

    const status: EmployeeDiff["status"] = !a
      ? "added"
      : !b
        ? "removed"
        : components.length === 0 &&
            a.netPaise === b.netPaise &&
            a.lopDays === b.lopDays
          ? "unchanged"
          : "changed";

    employees.push({
      employeeId: id,
      empCode: (b ?? a)!.empCode,
      name: (b ?? a)!.name,
      status,
      fromNetPaise: a?.netPaise ?? 0,
      toNetPaise: b?.netPaise ?? 0,
      netDeltaPaise: (b?.netPaise ?? 0) - (a?.netPaise ?? 0),
      fromGrossPaise: a?.grossPaise ?? 0,
      toGrossPaise: b?.grossPaise ?? 0,
      lopDelta: (b?.lopDays ?? 0) - (a?.lopDays ?? 0),
      components,
    });
  }

  employees.sort(
    (x, y) => Math.abs(y.netDeltaPaise) - Math.abs(x.netDeltaPaise),
  );

  // Which components moved the run, aggregated across employees.
  const impact = new Map<string, { label: string; delta: Paise; count: number }>();
  for (const e of employees) {
    for (const c of e.components) {
      const existing = impact.get(c.code);
      if (existing) {
        existing.delta += c.deltaPaise;
        existing.count += 1;
      } else {
        impact.set(c.code, { label: c.label, delta: c.deltaPaise, count: 1 });
      }
    }
  }

  const componentImpact = [...impact.entries()]
    .map(([code, v]) => ({
      code,
      label: v.label,
      deltaPaise: v.delta,
      employeeCount: v.count,
    }))
    .sort((a, b) => Math.abs(b.deltaPaise) - Math.abs(a.deltaPaise));

  const sum = (side: RunSide, key: "grossPaise" | "netPaise") =>
    side.employees.reduce((a, e) => a + e[key], 0);

  const added = employees.filter((e) => e.status === "added");
  const removed = employees.filter((e) => e.status === "removed");
  const changed = employees.filter((e) => e.status === "changed");

  if (added.length > 0 || removed.length > 0) {
    warnings.push(
      `${added.length} employee(s) appear only in version ${to.version} and ${removed.length} only in version ${from.version}. A change in headcount between versions of the same period needs an explanation on the record.`,
    );
  }

  return {
    from: {
      version: from.version,
      status: from.status,
      calculatedAt: from.calculatedAt,
      preparedBy: from.preparedBy,
    },
    to: {
      version: to.version,
      status: to.status,
      calculatedAt: to.calculatedAt,
      preparedBy: to.preparedBy,
    },
    employees,
    added,
    removed,
    changed,
    unchangedCount: employees.filter((e) => e.status === "unchanged").length,
    totals: {
      fromGrossPaise: sum(from, "grossPaise"),
      toGrossPaise: sum(to, "grossPaise"),
      grossDeltaPaise: sum(to, "grossPaise") - sum(from, "grossPaise"),
      fromNetPaise: sum(from, "netPaise"),
      toNetPaise: sum(to, "netPaise"),
      netDeltaPaise: sum(to, "netPaise") - sum(from, "netPaise"),
    },
    componentImpact,
    warnings,
  };
}

/* ==================================================================
   Variance against the prior period — used by the audit pack
   ================================================================== */

export type VarianceRow = {
  employeeId: string;
  empCode: string;
  name: string;
  priorNetPaise: Paise;
  currentNetPaise: Paise;
  deltaPaise: Paise;
  deltaBps: number;
  /** Above the threshold, or a joiner or leaver. */
  flagged: boolean;
  reason: string;
};

/**
 * Month-on-month variance. This is the report a reviewer actually reads
 * before approving: not the whole register, only what moved and why it
 * might have.
 */
export function computeVariance(args: {
  prior: RunSide | null;
  current: RunSide;
  /** Flag a move larger than this share of the prior net, in basis points. */
  thresholdBps: number;
  /** Always flag a move larger than this, however small in percentage. */
  absoluteThresholdPaise: Paise;
}): { rows: VarianceRow[]; flagged: VarianceRow[]; warnings: string[] } {
  const warnings: string[] = [];

  if (!args.prior) {
    warnings.push(
      "There is no prior period to compare against, so every employee reads as new. The variance report is not meaningful for a first run.",
    );
  }

  const priorById = new Map(
    (args.prior?.employees ?? []).map((e) => [e.employeeId, e]),
  );
  const currentById = new Map(args.current.employees.map((e) => [e.employeeId, e]));
  const allIds = new Set([...priorById.keys(), ...currentById.keys()]);

  const rows: VarianceRow[] = [];

  for (const id of allIds) {
    const prior = priorById.get(id);
    const current = currentById.get(id);

    const priorNet = prior?.netPaise ?? 0;
    const currentNet = current?.netPaise ?? 0;
    const delta = currentNet - priorNet;

    const deltaBps =
      priorNet > 0 ? Math.round((delta / priorNet) * 10000) : delta === 0 ? 0 : 10000;

    let reason: string;
    let flagged: boolean;

    if (!prior) {
      reason = "New this period — a joiner, or an employee who was not paid last month";
      flagged = true;
    } else if (!current) {
      reason = "Not paid this period — a leaver, or dropped from the run";
      flagged = true;
    } else if (delta === 0) {
      reason = "No change";
      flagged = false;
    } else {
      const overRelative = Math.abs(deltaBps) >= args.thresholdBps;
      const overAbsolute = Math.abs(delta) >= args.absoluteThresholdPaise;
      flagged = overRelative || overAbsolute;
      reason = flagged
        ? `Net moved by ${(deltaBps / 100).toFixed(1)}%${
            (current.lopDays ?? 0) !== (prior.lopDays ?? 0)
              ? `, loss of pay changed by ${((current.lopDays ?? 0) - (prior.lopDays ?? 0)).toFixed(1)} day(s)`
              : ""
          }`
        : `Within tolerance at ${(deltaBps / 100).toFixed(1)}%`;
    }

    rows.push({
      employeeId: id,
      empCode: (current ?? prior)!.empCode,
      name: (current ?? prior)!.name,
      priorNetPaise: priorNet,
      currentNetPaise: currentNet,
      deltaPaise: delta,
      deltaBps,
      flagged,
      reason,
    });
  }

  rows.sort((a, b) => Math.abs(b.deltaPaise) - Math.abs(a.deltaPaise));

  return { rows, flagged: rows.filter((r) => r.flagged), warnings };
}
