/**
 * What a newly registered company still has to configure.
 *
 * Registration creates a company row and an administrator, and nothing
 * else — deliberately, because every one of these is a policy decision
 * that belongs to the company rather than a default it should inherit
 * from a demo. This turns that emptiness into a list with an order,
 * since "configure payroll" is not an instruction anyone can act on.
 *
 * The order is the dependency order. A salary structure needs pay
 * components to reference; an employee needs a branch and a grade to
 * sit in; payroll needs all of it. Doing them out of order means going
 * back, so the list does not offer the choice.
 */

export type SetupFacts = {
  /** Statutory identifiers on the company record. */
  hasPan: boolean;
  hasTan: boolean;
  branches: number;
  departments: number;
  grades: number;
  payComponents: number;
  salaryStructures: number;
  leaveTypes: number;
  shifts: number;
  employees: number;
};

export type SetupStep = {
  id: string;
  title: string;
  /** Why it exists, in terms of what breaks without it. */
  why: string;
  href: string;
  done: boolean;
  /** Nothing later can be done until this is. */
  blocking: boolean;
};

export function setupSteps(f: SetupFacts): SetupStep[] {
  return [
    {
      id: "company",
      title: "Company identifiers",
      why: "PAN and TAN appear on every payslip and on the quarterly TDS return. Without them the return cannot be filed.",
      href: "/console/settings",
      done: f.hasPan && f.hasTan,
      blocking: false,
    },
    {
      id: "branches",
      title: "Add your locations",
      why: "Professional tax, labour welfare fund and minimum wages are all decided by the state a person works in.",
      href: "/console/settings",
      done: f.branches > 0,
      blocking: true,
    },
    {
      id: "org",
      title: "Departments and grades",
      why: "A grade carries notice period and probation. Departments are how payroll cost is reported back to the business.",
      href: "/console/settings/master-data?tab=org",
      done: f.departments > 0 && f.grades > 0,
      blocking: true,
    },
    {
      id: "pay-components",
      title: "Pay components",
      why: "Basic, HRA and the rest — the pieces a salary is built from. A structure has nothing to reference until these exist.",
      href: "/console/settings/master-data?tab=pay",
      done: f.payComponents > 0,
      blocking: true,
    },
    {
      id: "structure",
      title: "Salary structure",
      why: "How a CTC is split across those components. Every employee's pay is derived from one, so a structure with no components in it pays nothing.",
      href: "/console/settings/payroll",
      done: f.salaryStructures > 0,
      blocking: true,
    },
    {
      id: "leave",
      title: "Leave types",
      why: "Earned, casual and sick leave, with how much accrues. Attendance turns anything uncovered into loss of pay.",
      href: "/console/settings/master-data?tab=leave",
      done: f.leaveTypes > 0,
      blocking: false,
    },
    {
      id: "shifts",
      title: "Working hours",
      why: "The shift decides what counts as a full day, a half day and a weekly off when attendance is derived.",
      href: "/console/settings/master-data?tab=shifts",
      done: f.shifts > 0,
      blocking: false,
    },
    {
      id: "payroll-settings",
      title: "Payroll conventions",
      why: "Pay day, proration basis and rounding. These are frozen into each run, so they are worth reading once before the first one.",
      href: "/console/settings/payroll",
      done: f.salaryStructures > 0 && f.payComponents > 0,
      blocking: false,
    },
    {
      id: "employees",
      title: "Add your people",
      why: "Onboard a joiner or add an employee directly. Payroll has nothing to run until someone is on the books.",
      href: "/console/employees/new",
      done: f.employees > 0,
      blocking: false,
    },
  ];
}

export type SetupProgress = {
  steps: SetupStep[];
  done: number;
  total: number;
  percent: number;
  complete: boolean;
  /** The one to do next: the first unfinished step in dependency order. */
  next: SetupStep | null;
  /** Unfinished steps that later ones depend on. */
  blockers: SetupStep[];
};

export function setupProgress(f: SetupFacts): SetupProgress {
  const steps = setupSteps(f);
  const done = steps.filter((s) => s.done).length;
  return {
    steps,
    done,
    total: steps.length,
    percent: Math.round((done / steps.length) * 100),
    complete: done === steps.length,
    next: steps.find((s) => !s.done) ?? null,
    blockers: steps.filter((s) => !s.done && s.blocking),
  };
}

/** Whether payroll can be run at all yet. */
export function canRunPayroll(f: SetupFacts): boolean {
  return setupProgress(f).blockers.length === 0 && f.employees > 0;
}
