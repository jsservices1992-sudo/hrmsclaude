import { test } from "node:test";
import assert from "node:assert/strict";
import { computePeriodEpf } from "./epf-period";
import type { EpfParams } from "./statutory";
const old: EpfParams = { wageCeilingPaise: 1500000, coverageCeilingPaise: 1500000,
  epsCeilingPaise: 1500000, edliCeilingPaise: 1500000, employeeBps: 1200, employerBps: 1200,
  epsBps: 833, edliBps: 50, adminBps: 50 };
const revised = { ...old, wageCeilingPaise: 2500000, coverageCeilingPaise: 2500000, epsCeilingPaise: 2500000, edliCeilingPaise: 2500000 };
const periods = [{ from: "2026-09-01", to: "2026-09-16", params: old },
  { from: "2026-09-17", to: "2026-09-30", params: revised }];
test("existing capped member uses 16/30 plus 14/30 before rounding", () => {
  const r = computePeriodEpf({ pfWagePaise: 2000000, params: revised, onActualBasic: false,
    hadPriorMembership: true, optedIn: false }, { periods, monthlyWagePaise: 2000000,
    year: 2026, month: 9, dateOfJoining: "2020-01-01" });
  assert.equal(r.employeePaise, 208000);
  assert.equal(r.employerEpsPaise, 144400);
  assert.equal(r.employerPfPaise, 63600);
  assert.equal(r.edliPaise, 8700);
  assert.equal(r.pfWageConsidered, 1733333);
});
test("previously excluded member contributes only from the new ceiling date", () => {
  const r = computePeriodEpf({ pfWagePaise: 2000000, params: revised, onActualBasic: false,
    hadPriorMembership: false, optedIn: false }, { periods, monthlyWagePaise: 2000000,
    year: 2026, month: 9, dateOfJoining: "2020-01-01" });
  assert.equal(r.employeePaise, 112000);
  assert.equal(r.pfWageConsidered, 933333);
});
