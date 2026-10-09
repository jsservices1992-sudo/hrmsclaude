import { test } from "node:test";
import assert from "node:assert/strict";
import { assessAgeing } from "./settlement-tax";

test("two working days skips weekly offs and applicable holidays", () => {
  const args = { lastWorkingDay: "2026-10-09", slaDays: 2, workingDays: true,
    weeklyOffDays: [0, 6], holidays: ["2026-10-12"], gratuityPayable: false, settled: false };
  assert.equal(assessAgeing({ ...args, today: "2026-10-14" }).daysRemaining, 0);
  assert.equal(assessAgeing({ ...args, today: "2026-10-15" }).status, "overdue");
});

test("invalid working calendars and SLAs fail instead of looping indefinitely", () => {
  const args = { lastWorkingDay: "2026-10-09", today: "2026-10-10", slaDays: 2,
    workingDays: true, gratuityPayable: false, settled: false };
  assert.throws(() => assessAgeing({ ...args, weeklyOffDays: [0, 1, 2, 3, 4, 5, 6] }), /working day/);
  assert.throws(() => assessAgeing({ ...args, slaDays: NaN }), /SLA/);
});
