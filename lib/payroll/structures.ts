import type { ComponentSpec, CalcMethod } from "./compensation";

/** A structure's line, joined with the pay component it references. */
export type StructureLineJoined = {
  sequence: number;
  calcMethodOverride: string | null;
  percentValueOverride: number | null;
  fixedPaiseOverride: number | null;
  componentCode: string;
  componentLabel: string;
  componentKind: "earning" | "deduction" | "employer_contribution";
  componentCalcMethod: string;
  componentPercentValue: number;
  componentPercentOfCode: string | null;
  componentFixedPaise: number;
  componentTaxable: boolean;
  componentEpfBase: boolean;
  componentEsicBase: boolean;
  componentPtBase: boolean;
  componentBonusBase: boolean;
  componentGratuityBase: boolean;
  componentProrates: boolean;
};

/**
 * Turns a structure's lines into the ComponentSpec[] the engine evaluates.
 * A null override means "use the component's own definition" — the whole
 * point of the override columns being nullable. Ordered by the line's own
 * sequence, not the component's, since a structure may want its own order.
 */
export function buildComponentSpecs(lines: StructureLineJoined[]): ComponentSpec[] {
  return [...lines]
    .sort((a, b) => a.sequence - b.sequence)
    .map((l) => ({
      code: l.componentCode,
      label: l.componentLabel,
      kind: l.componentKind,
      calcMethod: (l.calcMethodOverride ?? l.componentCalcMethod) as CalcMethod,
      percentValue: l.percentValueOverride ?? l.componentPercentValue,
      percentOfCode: l.componentPercentOfCode,
      fixedPaise: l.fixedPaiseOverride ?? l.componentFixedPaise,
      taxable: l.componentTaxable,
      epfBase: l.componentEpfBase,
      esicBase: l.componentEsicBase,
      ptBase: l.componentPtBase,
      bonusBase: l.componentBonusBase,
      gratuityBase: l.componentGratuityBase,
      prorates: l.componentProrates,
      sequence: l.sequence,
    }));
}

export type ResolvedStructureSource =
  | "employee_pin"
  | "department_override"
  | "company_default"
  | "fallback_flat_components";

export type StructureResolutionInputs = {
  /** employeeSalaries.structureId on the employee's current open row. */
  employeeStructureId: string | null;
  employeeDepartmentId: string | null;
  /** departmentId -> structureId, from departmentSalaryStructureOverrides. */
  deptOverrideByDept: Map<string, string>;
  /** The company's salaryStructures row with isDefault = true, if any. */
  defaultStructureId: string | null;
};

/**
 * Pure precedence: an explicit per-employee pin always wins, then a
 * department override, then the company default, then — if none of those
 * exist — the caller falls back to the flat payComponents list that every
 * company used before structures existed. That fallback is what keeps a
 * company with zero configured structures computing exactly as it always
 * has: this function simply reports "there is nothing to resolve" and lets
 * the caller supply its own untouched fallback.
 */
export function resolveStructureId(
  args: StructureResolutionInputs,
): { structureId: string | null; source: ResolvedStructureSource } {
  if (args.employeeStructureId) {
    return { structureId: args.employeeStructureId, source: "employee_pin" };
  }
  const deptOverride = args.employeeDepartmentId
    ? args.deptOverrideByDept.get(args.employeeDepartmentId)
    : undefined;
  if (deptOverride) {
    return { structureId: deptOverride, source: "department_override" };
  }
  if (args.defaultStructureId) {
    return { structureId: args.defaultStructureId, source: "company_default" };
  }
  return { structureId: null, source: "fallback_flat_components" };
}
