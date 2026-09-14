import { test } from "node:test";
import assert from "node:assert/strict";
import {
  valueCar,
  valueAccommodation,
  valueLoan,
  valueExcessRetirals,
  valueEsop,
  summarisePerquisites,
  PERQUISITE_RATES_2026 as R,
} from "./perquisites";

const L = (rupees: number) => Math.round(rupees * 100);

/* ---------------- car ---------------- */

test("a small-engine employer car is ₹1,800 a month", () => {
  const r = valueCar(
    {
      ownedByEmployer: true,
      engineCc: 1200,
      driverProvided: false,
      useIsWhollyPersonal: false,
      actualCostPaise: L(400000),
      amountRecoveredPaise: 0,
      months: 12,
    },
    R,
  );
  assert.equal(r.valuePaise, L(21600));
  assert.match(r.basis, /Up to 1600cc/);
});

test("above 1600cc the higher rate applies, and a driver adds ₹900", () => {
  const r = valueCar(
    {
      ownedByEmployer: true,
      engineCc: 1998,
      driverProvided: true,
      useIsWhollyPersonal: false,
      actualCostPaise: L(1200000),
      amountRecoveredPaise: 0,
      months: 12,
    },
    R,
  );
  assert.equal(r.valuePaise, L((2400 + 900) * 12));
});

test("exactly 1600cc is not 'above' 1600cc", () => {
  const r = valueCar(
    {
      ownedByEmployer: true,
      engineCc: 1600,
      driverProvided: false,
      useIsWhollyPersonal: false,
      actualCostPaise: 0,
      amountRecoveredPaise: 0,
      months: 12,
    },
    R,
  );
  assert.equal(r.valuePaise, L(21600));
});

test("wholly personal use is valued at actual cost, not the flat rate", () => {
  const r = valueCar(
    {
      ownedByEmployer: true,
      engineCc: 1200,
      driverProvided: false,
      useIsWhollyPersonal: true,
      actualCostPaise: L(340000),
      amountRecoveredPaise: L(40000),
      months: 12,
    },
    R,
  );
  assert.equal(r.valuePaise, L(300000));
  assert.match(r.basis, /actual cost/);
});

test("an employee-owned car raises no vehicle perquisite", () => {
  const r = valueCar(
    {
      ownedByEmployer: false,
      engineCc: 1998,
      driverProvided: true,
      useIsWhollyPersonal: false,
      actualCostPaise: L(1200000),
      amountRecoveredPaise: 0,
      months: 12,
    },
    R,
  );
  assert.equal(r.valuePaise, 0);
});

test("recovery from the employee cannot drive the value negative", () => {
  const r = valueCar(
    {
      ownedByEmployer: true,
      engineCc: 1200,
      driverProvided: false,
      useIsWhollyPersonal: false,
      actualCostPaise: 0,
      amountRecoveredPaise: L(50000),
      months: 12,
    },
    R,
  );
  assert.equal(r.valuePaise, 0);
});

test("a car provided part-year is valued for those months only", () => {
  const r = valueCar(
    {
      ownedByEmployer: true,
      engineCc: 1200,
      driverProvided: false,
      useIsWhollyPersonal: false,
      actualCostPaise: 0,
      amountRecoveredPaise: 0,
      months: 5,
    },
    R,
  );
  assert.equal(r.valuePaise, L(9000));
});

/* ---------------- accommodation ---------------- */

test("accommodation in a city above 40 lakh is 10% of salary", () => {
  const r = valueAccommodation(
    {
      provided: true,
      salaryPaise: L(1200000),
      cityPopulation: 12_000_000,
      leasedByEmployer: false,
      actualRentPaise: 0,
      rentRecoveredFromEmployeePaise: 0,
      furnishingValuePaise: 0,
    },
    R,
  );
  assert.equal(r.valuePaise, L(120000));
});

test("the population bands step down to 7.5% and 5%", () => {
  const mid = valueAccommodation(
    {
      provided: true,
      salaryPaise: L(1200000),
      cityPopulation: 2_000_000,
      leasedByEmployer: false,
      actualRentPaise: 0,
      rentRecoveredFromEmployeePaise: 0,
      furnishingValuePaise: 0,
    },
    R,
  );
  assert.equal(mid.valuePaise, L(90000));

  const small = valueAccommodation(
    {
      provided: true,
      salaryPaise: L(1200000),
      cityPopulation: 400_000,
      leasedByEmployer: false,
      actualRentPaise: 0,
      rentRecoveredFromEmployeePaise: 0,
      furnishingValuePaise: 0,
    },
    R,
  );
  assert.equal(small.valuePaise, L(60000));
});

test("leased accommodation takes the lower of rent and the percentage", () => {
  const cheapRent = valueAccommodation(
    {
      provided: true,
      salaryPaise: L(1200000),
      cityPopulation: 12_000_000,
      leasedByEmployer: true,
      actualRentPaise: L(90000),
      rentRecoveredFromEmployeePaise: 0,
      furnishingValuePaise: 0,
    },
    R,
  );
  assert.equal(cheapRent.valuePaise, L(90000), "rent is lower than 10%");

  const dearRent = valueAccommodation(
    {
      provided: true,
      salaryPaise: L(1200000),
      cityPopulation: 12_000_000,
      leasedByEmployer: true,
      actualRentPaise: L(300000),
      rentRecoveredFromEmployeePaise: 0,
      furnishingValuePaise: 0,
    },
    R,
  );
  assert.equal(dearRent.valuePaise, L(120000), "the 10% cap binds");
});

test("furnishing is added and recovery subtracted", () => {
  const r = valueAccommodation(
    {
      provided: true,
      salaryPaise: L(1200000),
      cityPopulation: 12_000_000,
      leasedByEmployer: false,
      actualRentPaise: 0,
      rentRecoveredFromEmployeePaise: L(36000),
      furnishingValuePaise: L(24000),
    },
    R,
  );
  assert.equal(r.valuePaise, L(108000));
});

test("recovery exceeding the value floors at zero", () => {
  const r = valueAccommodation(
    {
      provided: true,
      salaryPaise: L(600000),
      cityPopulation: 400_000,
      leasedByEmployer: false,
      actualRentPaise: 0,
      rentRecoveredFromEmployeePaise: L(90000),
      furnishingValuePaise: 0,
    },
    R,
  );
  assert.equal(r.valuePaise, 0);
});

/* ---------------- loans ---------------- */

test("a loan within the ₹20,000 threshold is not a perquisite", () => {
  const r = valueLoan(
    {
      monthlyOutstandingPaise: Array(12).fill(L(18000)),
      interestChargedBps: 0,
      isExemptPurpose: false,
    },
    R,
  );
  assert.equal(r.valuePaise, 0);
  assert.match(r.basis, /within the ₹20000 exemption/);
});

test("the threshold is tested on the peak, not the closing balance", () => {
  const r = valueLoan(
    {
      monthlyOutstandingPaise: [L(500000), L(400000), L(300000), L(200000), L(100000), L(15000)],
      interestChargedBps: 0,
      isExemptPurpose: false,
    },
    R,
  );
  assert.ok(r.valuePaise > 0, "a loan that has since been repaid still counts");
});

test("an interest-free loan is valued at the full SBI rate on monthly balances", () => {
  const r = valueLoan(
    {
      monthlyOutstandingPaise: Array(12).fill(L(1200000)),
      interestChargedBps: 0,
      isExemptPurpose: false,
    },
    R,
  );
  // 9% of 12,00,000 for a full year
  assert.equal(r.valuePaise, L(108000));
});

test("a reducing balance is valued month by month, not on the peak", () => {
  const balances = [
    L(1200000), L(1100000), L(1000000), L(900000), L(800000), L(700000),
    L(600000), L(500000), L(400000), L(300000), L(200000), L(100000),
  ];
  const reducing = valueLoan(
    { monthlyOutstandingPaise: balances, interestChargedBps: 0, isExemptPurpose: false },
    R,
  );
  const flat = valueLoan(
    {
      monthlyOutstandingPaise: Array(12).fill(L(1200000)),
      interestChargedBps: 0,
      isExemptPurpose: false,
    },
    R,
  );
  assert.ok(reducing.valuePaise < flat.valuePaise);
  assert.equal(reducing.valuePaise, L(58500), "9% on ₹78,00,000 of month-end balances");
});

test("interest at or above the SBI rate leaves no perquisite", () => {
  const r = valueLoan(
    {
      monthlyOutstandingPaise: Array(12).fill(L(1200000)),
      interestChargedBps: 1000,
      isExemptPurpose: false,
    },
    R,
  );
  assert.equal(r.valuePaise, 0);
  assert.match(r.basis, /at or above the SBI rate/);
});

test("only the shortfall against the SBI rate is charged", () => {
  const r = valueLoan(
    {
      monthlyOutstandingPaise: Array(12).fill(L(1200000)),
      interestChargedBps: 600,
      isExemptPurpose: false,
    },
    R,
  );
  assert.equal(r.valuePaise, L(36000), "3% shortfall on 12,00,000");
});

test("an exempt-purpose loan is excluded outright", () => {
  const r = valueLoan(
    {
      monthlyOutstandingPaise: Array(12).fill(L(5000000)),
      interestChargedBps: 0,
      isExemptPurpose: true,
    },
    R,
  );
  assert.equal(r.valuePaise, 0);
});

/* ---------------- retirals ---------------- */

test("employer retirals within the aggregate cap are not taxable", () => {
  const r = valueExcessRetirals(
    {
      employerPfPaise: L(300000),
      employerNpsPaise: L(200000),
      employerSuperannuationPaise: L(100000),
    },
    R,
  );
  assert.equal(r.valuePaise, 0);
});

test("the cap is on the aggregate, not on each fund", () => {
  const r = valueExcessRetirals(
    {
      employerPfPaise: L(400000),
      employerNpsPaise: L(300000),
      employerSuperannuationPaise: L(200000),
    },
    R,
  );
  assert.equal(r.valuePaise, L(150000), "9,00,000 less the 7,50,000 cap");
});

/* ---------------- ESOP ---------------- */

test("ESOP perquisite is the spread on exercise", () => {
  const r = valueEsop({
    sharesExercised: 2000,
    fairMarketValuePerSharePaise: L(450),
    exercisePricePerSharePaise: L(100),
    isEligibleStartup: false,
  });
  assert.equal(r.valuePaise, L(700000));
});

test("an underwater option produces no perquisite", () => {
  const r = valueEsop({
    sharesExercised: 2000,
    fairMarketValuePerSharePaise: L(80),
    exercisePricePerSharePaise: L(100),
    isEligibleStartup: false,
  });
  assert.equal(r.valuePaise, 0);
});

test("a start-up may defer the TDS but the perquisite still arises", () => {
  const r = valueEsop({
    sharesExercised: 1000,
    fairMarketValuePerSharePaise: L(300),
    exercisePricePerSharePaise: L(50),
    isEligibleStartup: true,
  });
  assert.equal(r.valuePaise, L(250000));
  assert.match(r.basis, /192\(1C\)/);
});

/* ---------------- assembly ---------------- */

test("the summary drops nil lines and totals the rest", () => {
  const s = summarisePerquisites([
    { code: "CAR", label: "Motor car", valuePaise: L(21600), basis: "" },
    { code: "ACCOM", label: "Accommodation", valuePaise: 0, basis: "Not provided" },
    { code: "LOAN", label: "Concessional loan", valuePaise: L(36000), basis: "" },
  ]);
  assert.equal(s.lines.length, 2);
  assert.equal(s.totalPaise, L(57600));
});
