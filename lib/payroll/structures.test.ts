import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildComponentSpecs, resolveStructureId, type StructureLineJoined } from "./structures";

function line(overrides: Partial<StructureLineJoined> = {}): StructureLineJoined {
  return {
    sequence: 0,
    calcMethodOverride: null,
    percentValueOverride: null,
    fixedPaiseOverride: null,
    componentCode: "BASIC",
    componentLabel: "Basic",
    componentKind: "earning",
    componentCalcMethod: "percent_of_gross",
    componentPercentValue: 50,
    componentPercentOfCode: null,
    componentFixedPaise: 0,
    componentTaxable: true,
    componentEpfBase: true,
    componentEsicBase: true,
    componentPtBase: true,
    componentBonusBase: true,
    componentGratuityBase: true,
    componentProrates: true,
    ...overrides,
  };
}

describe("buildComponentSpecs", () => {
  test("uses the component's own definition when no override is set", () => {
    const [spec] = buildComponentSpecs([line()]);
    assert.equal(spec.calcMethod, "percent_of_gross");
    assert.equal(spec.percentValue, 50);
    assert.equal(spec.fixedPaise, 0);
  });

  test("an override wins over the component's own definition", () => {
    const [spec] = buildComponentSpecs([
      line({ calcMethodOverride: "fixed", fixedPaiseOverride: 500000 }),
    ]);
    assert.equal(spec.calcMethod, "fixed");
    assert.equal(spec.fixedPaise, 500000);
    // percentValue wasn't overridden, so it still falls back to the component's.
    assert.equal(spec.percentValue, 50);
  });

  test("orders by the line's own sequence, not the component's", () => {
    const specs = buildComponentSpecs([
      line({ componentCode: "HRA", sequence: 1 }),
      line({ componentCode: "BASIC", sequence: 0 }),
    ]);
    assert.deepEqual(specs.map((s) => s.code), ["BASIC", "HRA"]);
  });
});

describe("resolveStructureId", () => {
  const base = {
    employeeStructureId: null as string | null,
    employeeDepartmentId: null as string | null,
    deptOverrideByDept: new Map<string, string>(),
    defaultStructureId: null as string | null,
  };

  test("an empty context falls through to the flat-components fallback", () => {
    const result = resolveStructureId(base);
    assert.equal(result.structureId, null);
    assert.equal(result.source, "fallback_flat_components");
  });

  test("company default wins when nothing else is set", () => {
    const result = resolveStructureId({ ...base, defaultStructureId: "struct_default" });
    assert.equal(result.structureId, "struct_default");
    assert.equal(result.source, "company_default");
  });

  test("a department override wins over the company default", () => {
    const result = resolveStructureId({
      ...base,
      employeeDepartmentId: "dept_eng",
      deptOverrideByDept: new Map([["dept_eng", "struct_eng"]]),
      defaultStructureId: "struct_default",
    });
    assert.equal(result.structureId, "struct_eng");
    assert.equal(result.source, "department_override");
  });

  test("an employee pin wins over a department override and the default", () => {
    const result = resolveStructureId({
      ...base,
      employeeStructureId: "struct_pinned",
      employeeDepartmentId: "dept_eng",
      deptOverrideByDept: new Map([["dept_eng", "struct_eng"]]),
      defaultStructureId: "struct_default",
    });
    assert.equal(result.structureId, "struct_pinned");
    assert.equal(result.source, "employee_pin");
  });

  test("an employee with no department simply skips the department check", () => {
    const result = resolveStructureId({
      ...base,
      employeeDepartmentId: null,
      deptOverrideByDept: new Map([["dept_eng", "struct_eng"]]),
      defaultStructureId: "struct_default",
    });
    assert.equal(result.structureId, "struct_default");
    assert.equal(result.source, "company_default");
  });
});

describe("choosing between two company defaults", () => {
  /* Mirrors loadStructureResolutionContext: with more than one row marked
     default — which older data can carry — the one that actually has
     components wins. Picking by row order is how an employee resolves to
     an empty structure and is paid nothing. */
  const pickDefault = (rows: { id: string; isDefault: boolean }[], components: Record<string, number>) => {
    const defaults = rows.filter((r) => r.isDefault);
    return defaults.find((r) => (components[r.id] ?? 0) > 0)?.id ?? defaults[0]?.id ?? null;
  };

  test("prefers the default that has components over the empty one", () => {
    const rows = [
      { id: "empty", isDefault: true },
      { id: "filled", isDefault: true },
    ];
    assert.equal(pickDefault(rows, { empty: 0, filled: 4 }), "filled");
  });

  test("is not decided by row order", () => {
    const rows = [
      { id: "filled", isDefault: true },
      { id: "empty", isDefault: true },
    ];
    assert.equal(pickDefault(rows, { empty: 0, filled: 4 }), "filled");
  });

  test("still returns something when every default is empty", () => {
    const rows = [{ id: "empty", isDefault: true }];
    assert.equal(pickDefault(rows, { empty: 0 }), "empty");
  });

  test("returns null when nothing is marked default", () => {
    assert.equal(pickDefault([{ id: "a", isDefault: false }], { a: 4 }), null);
  });
});
