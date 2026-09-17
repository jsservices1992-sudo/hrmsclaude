/**
 * Setting a company up as one path rather than a list of links.
 *
 * The checklist on /console/setup says what is left; this says where to go
 * next. They are the same steps, ordered the same way, and the difference
 * is only that a wizard hands somebody the following screen instead of
 * sending them back to a list to find it.
 *
 * Steps that are optional are still in the path. A company with no loan
 * scheme should see the screen and pass it by, rather than discover six
 * months later that the feature existed — skipping is a decision, and
 * never being shown is not.
 */

import type { SetupFacts } from "./setup";

export type WizardFacts = SetupFacts & {
  registrations: number;
  variablePayTypes: number;
  loanSchemes: number;
  glAccounts: number;
};

export type WizardStep = {
  id: string;
  title: string;
  /** What breaks without it, or what it is for where nothing breaks. */
  why: string;
  /** Whether nothing later works until this is done. */
  required: boolean;
  done: boolean;
  href: string;
};

export function wizardSteps(companyId: string, f: WizardFacts): WizardStep[] {
  const company = (tab: string) => `/console/settings/companies/${companyId}?tab=${tab}`;
  const master = (tab: string) => `/console/settings/master-data?company=${companyId}&tab=${tab}`;

  return [
    {
      id: "profile",
      title: "Profile & conventions",
      why: "PAN and TAN appear on every payslip and on the quarterly TDS return. Without them the return cannot be filed.",
      required: true,
      done: f.hasPan && f.hasTan,
      href: company("profile"),
    },
    {
      id: "branches",
      title: "Branches",
      why: "Professional tax, labour welfare fund and minimum wages are all decided by the state a person works in.",
      required: true,
      done: f.branches > 0,
      href: company("branches"),
    },
    {
      id: "registrations",
      title: "Registrations",
      why: "The PF, ESIC and professional tax numbers each state registration is filed under.",
      required: false,
      done: f.registrations > 0,
      href: company("registrations"),
    },
    {
      id: "org",
      title: "Departments & grades",
      why: "A grade carries notice period and probation. Departments are how payroll cost is reported back to the business.",
      required: true,
      done: f.departments > 0 && f.grades > 0,
      href: master("org"),
    },
    {
      id: "leave",
      title: "Leave & holidays",
      why: "Attendance turns anything uncovered into loss of pay, and an undeclared holiday is an ordinary working day to it.",
      required: false,
      done: f.leaveTypes > 0 && f.holidays > 0,
      href: master("leave"),
    },
    {
      id: "shifts",
      title: "Shifts",
      why: "The shift decides what counts as a full day, a half day and a weekly off when attendance is derived.",
      required: false,
      done: f.shifts > 0,
      href: master("shifts"),
    },
    {
      id: "pay",
      title: "Pay components",
      why: "Basic, HRA and the rest — the pieces a salary is built from. A structure has nothing to reference until these exist.",
      required: true,
      done: f.payComponents > 0,
      href: master("pay"),
    },
    {
      id: "variable",
      title: "Variable pay types",
      why: "Overtime, incentives, and the deductions a penalty or a salary advance is entered against.",
      required: false,
      done: f.variablePayTypes > 0,
      href: master("variable"),
    },
    {
      id: "loans",
      title: "Loan schemes",
      why: "What may be lent, over how long, and the net pay recovery must never breach.",
      required: false,
      done: f.loanSchemes > 0,
      href: master("loans"),
    },
    {
      id: "gl",
      title: "Chart of accounts",
      why: "Where each payroll figure lands in your accounting system, so the month can be posted rather than retyped.",
      required: false,
      done: f.glAccounts > 0,
      href: master("gl"),
    },
    {
      id: "structure",
      title: "Salary structure",
      why: "How a CTC is split across those components. Every employee's pay is derived from one, so a structure with no components in it pays nothing.",
      required: true,
      done: f.salaryStructures > 0,
      href: `/console/settings/payroll?company=${companyId}&tab=structures`,
    },
    {
      id: "employees",
      title: "Add your people",
      why: "Payroll has nothing to run until someone is on the books.",
      required: true,
      done: f.employees > 0,
      href: "/console/employees/new",
    },
    {
      id: "salaries",
      title: "Everyone has a salary",
      why: "Payroll only includes people with a salary on record. Someone without one is not paid less — they are left out of the run entirely.",
      required: true,
      done: f.employees > 0 && f.employeesWithoutSalary === 0,
      href: "/console/import",
    },
    {
      id: "bank",
      title: "Salary bank account",
      why: "The account the salary file is drawn on. Payroll can be calculated and approved without it, and then there is nothing to pay anybody from.",
      required: false,
      done: f.bankAccounts > 0,
      href: `/console/settings/payroll?company=${companyId}&tab=banks`,
    },
  ];
}

export type WizardPosition = {
  steps: WizardStep[];
  index: number;
  step: WizardStep;
  previous: WizardStep | null;
  next: WizardStep | null;
  done: number;
  total: number;
};

/** Where in the path a given step sits, and what surrounds it. */
export function wizardPosition(
  companyId: string,
  facts: WizardFacts,
  stepId: string,
): WizardPosition | null {
  const steps = wizardSteps(companyId, facts);
  const index = steps.findIndex((s) => s.id === stepId);
  if (index === -1) return null;

  return {
    steps,
    index,
    step: steps[index],
    previous: index > 0 ? steps[index - 1] : null,
    next: index < steps.length - 1 ? steps[index + 1] : null,
    done: steps.filter((s) => s.done).length,
    total: steps.length,
  };
}

/**
 * Where "next" goes: the following step that still has something to do.
 *
 * Walking to index + 1 parks somebody on a screen they have already
 * finished — a company that arrived with pay components seeded is shown
 * them again and has to press Next a second time to get past. When
 * nothing is left the checklist is the end of the path.
 */
export function nextStop(steps: WizardStep[], index: number): WizardStep | null {
  return steps.slice(index + 1).find((s) => !s.done) ?? null;
}

/** Adds the wizard to a step's own address, so the bar survives the hop. */
export function withWizard(href: string, stepId: string): string {
  return `${href}${href.includes("?") ? "&" : "?"}setup=${stepId}`;
}
