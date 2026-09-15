import test from "node:test";
import assert from "node:assert/strict";
import { valueNotice, resolveNoticeDays } from "./notice";

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

test("the grade's notice period beats the company default", () => {
  /* The grade carried a notice period that nothing ever read: every
     settlement used the company's sixty days, so somebody on a grade
     with thirty days' notice was charged for sixty they never owed. */
  const resolved = resolveNoticeDays({
    employeeOverrideDays: null,
    gradeDays: 30,
    employmentTypeDays: null,
    companyDefaultDays: 60,
  });
  assert.equal(resolved.days, 30);
  assert.equal(resolved.source, "grade");
});

test("a grade with no notice period falls back to the company default", () => {
  const resolved = resolveNoticeDays({
    gradeDays: null,
    companyDefaultDays: 60,
  });
  assert.equal(resolved.days, 60);
  assert.equal(resolved.source, "company default");
});

test("an override on the person beats their grade", () => {
  const resolved = resolveNoticeDays({
    employeeOverrideDays: 15,
    gradeDays: 30,
    companyDefaultDays: 60,
  });
  assert.equal(resolved.days, 15);
  assert.equal(resolved.source, "employee override");
});

test("thirty days of notice against sixty is thirty days of recovery, not sixty", () => {
  /* Resigned 1 September, left the same day: the whole notice period is
     short, so the difference between the two rules is the whole bill. */
  const perDay = 50_000;
  const onGrade = valueNotice({
    shortfallDays: resolveNoticeDays({ gradeDays: 30, companyDefaultDays: 60 }).days,
    perDayPaise: perDay,
    exitType: "resignation",
    waived: false,
  });
  const onDefault = valueNotice({
    shortfallDays: resolveNoticeDays({ gradeDays: null, companyDefaultDays: 60 }).days,
    perDayPaise: perDay,
    exitType: "resignation",
    waived: false,
  });
  assert.equal(onGrade.amountPaise, 30 * perDay);
  assert.equal(onDefault.amountPaise, 60 * perDay);
  assert.equal(onDefault.amountPaise - onGrade.amountPaise, 30 * perDay, "the gap is real money");
});
