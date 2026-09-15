import test from "node:test";
import assert from "node:assert/strict";
import { valueNotice } from "./notice";

test("the three notice treatments a user can choose produce three outcomes", () => {
  const base = { shortfallDays: 20, perDayPaise: 50_000, exitType: "resignation" as const };

  const recovered = valueNotice({ ...base, waived: false });
  assert.equal(recovered.kind, "recovery");
  assert.equal(recovered.amountPaise, 20 * 50_000);

  const waived = valueNotice({ ...base, waived: true });
  assert.equal(waived.kind, "waived");
  assert.equal(waived.amountPaise, 0, "waiving recovers nothing");

  const paid = valueNotice({ ...base, waived: false, employerPaysInLieu: true });
  assert.equal(paid.kind, "payout");
  assert.equal(paid.amountPaise, 20 * 50_000, "the same days, owed the other way");
});

test("waiving wins over the employer paying, so the two cannot both apply", () => {
  const both = valueNotice({
    shortfallDays: 10,
    perDayPaise: 50_000,
    exitType: "termination",
    waived: true,
    employerPaysInLieu: true,
  });
  assert.equal(both.kind, "waived");
  assert.equal(both.amountPaise, 0);
});

test("a full notice period recovers nothing whatever is chosen", () => {
  for (const waived of [true, false]) {
    const r = valueNotice({ shortfallDays: 0, perDayPaise: 50_000, exitType: "resignation", waived });
    assert.equal(r.amountPaise, 0);
  }
});

test("death in service never carries a recovery, even unwaived", () => {
  const r = valueNotice({
    shortfallDays: 30,
    perDayPaise: 50_000,
    exitType: "death_in_service",
    waived: false,
  });
  assert.equal(r.kind, "none");
  assert.equal(r.amountPaise, 0);
});
