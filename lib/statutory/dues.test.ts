import { test } from "node:test";
import assert from "node:assert/strict";
import { dashboardDues, dueAmount, type DashboardDue } from "./dues";

const lines = [
  { code: "EPF_EE", amountPaise: 300000 },
  { code: "EPF_ER", amountPaise: 175000 },
  { code: "EPS_ER", amountPaise: 125000 },
  { code: "EDLI_ER", amountPaise: 7500 },
  { code: "EPF_ADMIN_ER", amountPaise: 12500 },
  { code: "PT", amountPaise: 20000, basis: "KA — Slab rate applied" },
  { code: "PT", amountPaise: 20000, basis: "MH — Slab rate applied" },
  { code: "LWF_EE", amountPaise: 3100, basis: "HR — monthly" },
  { code: "BASIC", amountPaise: 2500000 },
];

test("the PF challan carries contributions and the EDLI and admin charges", () => {
  assert.equal(dueAmount({ kind: "epf_ecr", stateCode: null }, lines), 620000);
});

test("PT and LWF count only their own state's lines", () => {
  assert.equal(dueAmount({ kind: "pt_return", stateCode: "KA" }, lines), 20000);
  assert.equal(dueAmount({ kind: "lwf_return", stateCode: "HR" }, lines), 3100);
  assert.equal(dueAmount({ kind: "lwf_return", stateCode: "DL" }, lines), 0);
});

test("a return that moves no money has no amount", () => {
  assert.equal(dueAmount({ kind: "tds_24q", stateCode: null }, lines), null);
});

test("filed and nothing-to-pay items drop out; overdue leads", () => {
  const d = (key: string, dueDate: string, status: DashboardDue["status"], amountPaise: number | null): DashboardDue => ({
    key, label: key, authority: "", companyName: "", dueDate, daysUntilDue: 0, status, amountPaise, periodLabel: "",
  });
  const out = dashboardDues([
    d("esic", "2026-10-15", "not_started", 5000),
    d("pf-aug", "2026-09-15", "overdue", 9000),
    d("tds", "2026-10-07", "filed", 100),
    d("lwf", "2026-10-31", "not_started", 0),
    d("24q", "2026-10-31", "not_started", null),
  ]);
  assert.deepEqual(out.map((x) => x.key), ["pf-aug", "esic", "24q"]);
});
