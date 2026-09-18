import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summarisePf,
  summariseEsic,
  summariseTds,
  summarisePt,
  summariseLwf,
  wageRegister,
  employeeRegister,
  attendanceRegister,
  leaveRegister,
  bonusRegister,
  toCsv,
  type RegisterLine,
} from "./summaries";

const L = (rupees: number) => Math.round(rupees * 100);

const line = (over: Partial<RegisterLine> = {}): RegisterLine => ({
  employeeId: "e1",
  empCode: "KA0001",
  name: "Aarav Nair",
  branchId: "br_ka",
  branchName: "Bengaluru",
  stateCode: "KA",
  grossPaise: L(45000),
  amounts: {
    EPF_WAGES: L(15000),
    EPF_EE: L(1800),
    EPF_ER: L(550),
    EPS_ER: L(1250),
    PT: L(200),
  },
  ...over,
});

/* ---------------- PF ---------------- */

test("the PF summary splits the employer share from the pension share", () => {
  const s = summarisePf([line()], new Map([["e1", "100123456789"]]));
  assert.equal(s.employeeSharePaise, L(1800));
  assert.equal(s.employerPfSharePaise, L(550));
  assert.equal(s.pensionSharePaise, L(1250));
  assert.equal(s.employerTotalPaise, L(1800), "employer PF plus pension");
  assert.equal(s.totalPaise, L(3600));
});

test("only contributing members are counted", () => {
  const s = summarisePf(
    [line(), line({ employeeId: "e2", empCode: "KA0002", amounts: {} })],
    new Map([
      ["e1", "100123456789"],
      ["e2", null],
    ]),
  );
  assert.equal(s.memberCount, 1);
  assert.deepEqual(s.missingUan, [], "the non-member's missing UAN is irrelevant");
});

test("a contributing member without a UAN blocks the upload", () => {
  const s = summarisePf([line()], new Map([["e1", null]]));
  assert.deepEqual(s.missingUan, ["KA0001"]);
  assert.ok(s.warnings.some((w) => w.includes("cannot be uploaded")));
});

/* ---------------- ESIC ---------------- */

test("the ESIC summary totals both shares over covered employees only", () => {
  const s = summariseEsic(
    [
      line({ amounts: { ESIC_EE: L(135), ESIC_ER: L(585) } }),
      line({ employeeId: "e2", empCode: "KA0002", amounts: {} }),
    ],
    new Map([["e1", "1234567890"]]),
  );
  assert.equal(s.coveredCount, 1);
  assert.equal(s.totalPaise, L(720));
});

test("a covered employee awaiting an insurance number is still payable", () => {
  const s = summariseEsic(
    [line({ amounts: { ESIC_EE: L(135), ESIC_ER: L(585) } })],
    new Map([["e1", null]]),
  );
  assert.deepEqual(s.missingIp, ["KA0001"]);
  assert.ok(s.warnings.some((w) => w.includes("cannot be withheld")));
});

/* ---------------- TDS ---------------- */

test("the TDS summary counts only deductees", () => {
  const s = summariseTds(
    [
      line({ amounts: { TDS: L(2000) } }),
      line({ employeeId: "e2", empCode: "KA0002", amounts: { TDS: 0 } }),
    ],
    new Map([["e1", true]]),
  );
  assert.equal(s.deducteeCount, 1);
  assert.equal(s.totalTdsPaise, L(2000));
});

test("a deductee without a valid PAN is flagged for 24Q", () => {
  const s = summariseTds(
    [line({ amounts: { TDS: L(2000) } })],
    new Map([["e1", false]]),
  );
  assert.deepEqual(s.withoutValidPan, ["KA0001"]);
  assert.ok(s.warnings.some((w) => w.includes("206AA")));
});

/* ---------------- PT ---------------- */

test("PT is grouped by state and then by branch", () => {
  const s = summarisePt({
    lines: [
      line(),
      line({ employeeId: "e2", empCode: "KA0002" }),
      line({
        employeeId: "e3",
        empCode: "MH0001",
        stateCode: "MH",
        branchId: "br_mh",
        branchName: "Mumbai",
        amounts: { PT: L(200) },
      }),
    ],
    ptLevyingStates: new Set(["KA", "MH"]),
  });

  assert.equal(s.states.length, 2);
  const ka = s.states.find((x) => x.stateCode === "KA")!;
  assert.equal(ka.totalPaise, L(400));
  assert.equal(ka.employeeCount, 2);
  assert.equal(ka.branches.length, 1);
  assert.equal(ka.branches[0].branchName, "Bengaluru");
  assert.equal(s.totalPaise, L(600));
});

test("a deduction in a non-levying state is called a fault, not a rounding", () => {
  const s = summarisePt({
    lines: [line({ stateCode: "SK" })],
    ptLevyingStates: new Set(["KA"]),
  });
  assert.ok(
    s.warnings.some((w) => w.includes("must be refunded")),
    s.warnings.join("; "),
  );
});

test("a levying state that deducted nothing points at a missing slab", () => {
  const s = summarisePt({
    lines: [line({ stateCode: "TG", amounts: { PT: 0 } })],
    ptLevyingStates: new Set(["KA", "TG"]),
  });
  assert.deepEqual(s.leviedButNothingDeducted, ["TG"]);
  assert.ok(s.warnings.some((w) => w.includes("deducts nothing silently")));
});

test("a state with no PT at all does not appear as an empty row", () => {
  const s = summarisePt({
    lines: [line({ stateCode: "SK", amounts: {} })],
    ptLevyingStates: new Set(["KA"]),
  });
  assert.equal(s.states.length, 0);
  assert.equal(s.totalPaise, 0);
});

/* ---------------- LWF ---------------- */

const lwfRules = new Map([
  ["MH", { frequency: "half-yearly", collectionMonths: [6, 12] }],
  ["HR", { frequency: "monthly", collectionMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }],
]);

test("LWF splits employee and employer shares by state", () => {
  const s = summariseLwf({
    lines: [
      line({ stateCode: "MH", amounts: { LWF_EE: L(25), LWF_ER: L(75) } }),
      line({
        employeeId: "e2",
        stateCode: "HR",
        amounts: { LWF_EE: L(34), LWF_ER: L(68) },
      }),
    ],
    stateRules: lwfRules,
    month: 6,
  });
  assert.equal(s.employeeSharePaise, L(59));
  assert.equal(s.employerSharePaise, L(143));
  assert.equal(s.totalPaise, L(202));
});

test("the employer share exceeds the employee share, as the rates require", () => {
  const s = summariseLwf({
    lines: [line({ stateCode: "MH", amounts: { LWF_EE: L(25), LWF_ER: L(75) } })],
    stateRules: lwfRules,
    month: 6,
  });
  assert.ok(s.employerSharePaise > s.employeeSharePaise);
});

test("collecting outside a state's own frequency is flagged", () => {
  const s = summariseLwf({
    lines: [line({ stateCode: "MH", amounts: { LWF_EE: L(25), LWF_ER: L(75) } })],
    stateRules: lwfRules,
    month: 9, // Maharashtra collects in June and December
  });
  assert.equal(s.states[0].dueThisPeriod, false);
  assert.ok(s.warnings.some((w) => w.includes("not a collection month")));
});

test("a monthly state is due every month", () => {
  const s = summariseLwf({
    lines: [line({ stateCode: "HR", amounts: { LWF_EE: L(34), LWF_ER: L(68) } })],
    stateRules: lwfRules,
    month: 9,
  });
  assert.equal(s.states[0].dueThisPeriod, true);
  assert.equal(s.warnings.length, 0);
});

test("states with no LWF are omitted", () => {
  const s = summariseLwf({
    lines: [line({ stateCode: "KA", amounts: {} })],
    stateRules: lwfRules,
    month: 9,
  });
  assert.equal(s.states.length, 0);
});

/* ---------------- registers ---------------- */

test("the wage register has a column per code found in the run", () => {
  const csv = wageRegister([line()]);
  const header = csv.split("\n")[0];
  assert.ok(header.startsWith("Employee code,Name,Branch,State,Gross,"));
  assert.ok(header.includes("EPF_EE"));
  assert.ok(header.includes("PT"));
});

test("the wage register shows rupees and paise, not paise integers", () => {
  const csv = wageRegister([line()]);
  const row = csv.split("\n")[1];
  assert.ok(row.includes("45000.00"), row);
  assert.ok(row.includes("1800.00"), row);
});

test("a code present on one employee but not another shows zero, not blank", () => {
  const csv = wageRegister([
    line(),
    line({ employeeId: "e2", empCode: "KA0002", amounts: { EPF_EE: L(1800) } }),
  ]);
  const second = csv.split("\n")[2];
  // PT is absent for the second employee and must read 0.00
  assert.ok(second.includes("0.00"));
});

test("the employee register carries the statutory identifiers", () => {
  const csv = employeeRegister([
    {
      empCode: "KA0001",
      name: "Aarav Nair",
      gender: "male",
      dateOfBirth: "1990-04-12",
      dateOfJoining: "2020-04-01",
      dateOfExit: null,
      designation: "Associate",
      branchName: "Bengaluru",
      stateCode: "KA",
      pan: "ABCPD1234E",
      uan: "100123456789",
      esicIp: null,
    },
  ]);
  const header = csv.split("\n")[0];
  assert.ok(header.includes("PAN"));
  assert.ok(header.includes("UAN"));
  assert.ok(csv.includes("ABCPD1234E"));
});

test("a null field becomes empty rather than the string null", () => {
  const csv = toCsv(["a", "b"], [["x", null]]);
  assert.equal(csv.trimEnd().split("\n")[1], "x,");
});

test("a comma in a value is quoted", () => {
  const csv = toCsv(["a"], [["Nair, Aarav"]]);
  assert.ok(csv.includes('"Nair, Aarav"'));
});

test("an establishment minimum tops the employer up without touching pay", () => {
  const rules = new Map([
    [
      "MP",
      {
        frequency: "half-yearly",
        collectionMonths: [6, 12],
        employerMinimumPaise: L(2500),
      },
    ],
  ]);
  // Ten people at ₹50 come to ₹500, against the ₹2,500 the establishment owes.
  const s = summariseLwf({
    lines: Array.from({ length: 10 }, (_, i) =>
      line({ employeeId: `e${i}`, stateCode: "MP", amounts: { LWF_EE: L(10), LWF_ER: L(50) } }),
    ),
    stateRules: rules,
    month: 6,
  });

  assert.equal(s.states[0].employerSharePaise, L(500), "the per-head sum is unchanged");
  assert.equal(s.states[0].employerTopUpPaise, L(2000));
  assert.equal(s.states[0].employerPayablePaise, L(2500), "what goes to the board");
  assert.equal(s.employeeSharePaise, L(100), "and nobody's deduction moved");
  assert.ok(s.warnings.some((w) => w.includes("not recovered from anybody")));
});

test("the minimum is not owed in a month the state does not collect", () => {
  const rules = new Map([
    ["MP", { frequency: "half-yearly", collectionMonths: [6, 12], employerMinimumPaise: L(2500) }],
  ]);
  const s = summariseLwf({
    lines: [line({ stateCode: "MP", amounts: { LWF_EE: L(10), LWF_ER: L(50) } })],
    stateRules: rules,
    month: 9,
  });
  assert.equal(s.states[0].employerTopUpPaise, 0);
});

test("a state without a minimum is left alone", () => {
  const s = summariseLwf({
    lines: [line({ stateCode: "MH", amounts: { LWF_EE: L(25), LWF_ER: L(75) } })],
    stateRules: lwfRules,
    month: 6,
  });
  assert.equal(s.states[0].employerTopUpPaise, 0);
  assert.equal(s.states[0].employerPayablePaise, L(75));
});

/* ==================================================================
   Attendance, leave and bonus registers
   ================================================================== */

test("attendanceRegister lists total, paid, LOP and off-days-worked", () => {
  const csv = attendanceRegister([
    { empCode: "KA0001", name: "Aarav Nair", branchName: "Bengaluru", totalDays: 31, paidDays: 29, lopDays: 2, offDaysWorked: 1 },
  ]);
  const lines = csv.trim().split("\n");
  assert.equal(lines[0], "Employee code,Name,Branch,Total days,Paid days,Loss of pay (days),Weekly-off/holiday worked");
  assert.equal(lines[1], "KA0001,Aarav Nair,Bengaluru,31.00,29.00,2.00,1.00");
});

test("leaveRegister shows a null balance as blank, not zero", () => {
  const csv = leaveRegister([
    { empCode: "KA0001", name: "Aarav Nair", leaveTypeName: "Earned leave", daysTakenInPeriod: 2, lopDaysInPeriod: 0, currentBalanceDays: 8.5, balanceAsOf: "2026-08-31" },
    { empCode: "KA0002", name: "Priya Rao", leaveTypeName: "Casual leave", daysTakenInPeriod: 1, lopDaysInPeriod: 0, currentBalanceDays: null, balanceAsOf: null },
  ]);
  const lines = csv.trim().split("\n");
  assert.equal(lines[1], "KA0001,Aarav Nair,Earned leave,2.00,0.00,8.50,2026-08-31");
  // A leave type with no balance record at all is blank, not a false "0.00".
  assert.equal(lines[2], "KA0002,Priya Rao,Casual leave,1.00,0.00,,");
});

test("bonusRegister reports eligibility and how many months actually fed it", () => {
  const csv = bonusRegister(
    [
      { empCode: "KA0001", name: "Aarav Nair", bonusBaseWagePaise: L(300000), bonusPaidPaise: L(25000), monthsIncluded: 12, eligible: true },
      { empCode: "KA0002", name: "Priya Rao", bonusBaseWagePaise: L(600000), bonusPaidPaise: 0, monthsIncluded: 6, eligible: false },
    ],
    12,
  );
  const lines = csv.trim().split("\n");
  assert.equal(lines[0], "Employee code,Name,Bonus-qualifying wage for the year (₹),Statutory bonus paid (₹),Months included,Eligible under the Act (average monthly wage)");
  assert.equal(lines[1], "KA0001,Aarav Nair,300000.00,25000.00,12 of 12,Yes");
  assert.equal(lines[2], "KA0002,Priya Rao,600000.00,0.00,6 of 12,No");
});
