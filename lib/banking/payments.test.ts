import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitNetPay,
  buildPaymentRun,
  reconcilePaymentRun,
  formatBankFile,
  validateIfsc,
  bankCodeOf,
  RTGS_MINIMUM_PAISE,
  type Payee,
  type EmployeeAccount,
} from "./payments";

const L = (rupees: number) => Math.round(rupees * 100);

const account = (over: Partial<EmployeeAccount> = {}): EmployeeAccount => ({
  accountId: "a1",
  accountNumber: "50100123456789",
  ifsc: "HDFC0001234",
  accountHolderName: "Aarav Nair",
  allocation: { kind: "remainder" },
  sequence: 0,
  ...over,
});

const payee = (over: Partial<Payee> = {}): Payee => ({
  employeeId: "e1",
  empCode: "KA0001",
  name: "Aarav Nair",
  netPaise: L(45000),
  mode: "bank_transfer",
  accounts: [account()],
  ...over,
});

/* ---------------- IFSC ---------------- */

test("a valid IFSC is four letters, a zero, then six characters", () => {
  assert.ok(validateIfsc("HDFC0001234"));
  assert.ok(validateIfsc("SBIN0AB1234"));
  assert.ok(validateIfsc("hdfc0001234"), "case is normalised");
});

test("a malformed IFSC is rejected", () => {
  assert.ok(!validateIfsc("HDFC1001234"), "the fifth character must be zero");
  assert.ok(!validateIfsc("HDF0001234"), "too short");
  assert.ok(!validateIfsc("HDFC00012345"), "too long");
  assert.ok(!validateIfsc("HD1C0001234"), "the bank code must be letters");
  assert.ok(!validateIfsc(null));
  assert.ok(!validateIfsc(""));
});

test("the bank code is the first four characters", () => {
  assert.equal(bankCodeOf("hdfc0001234"), "HDFC");
});

/* ---------------- splits ---------------- */

test("a single remainder account takes the whole net", () => {
  const { splits } = splitNetPay(L(45000), [account()]);
  assert.equal(splits.length, 1);
  assert.equal(splits[0].amountPaise, L(45000));
});

test("a fixed split leaves the balance to the remainder account", () => {
  const { splits } = splitNetPay(L(45000), [
    account({ accountId: "savings", allocation: { kind: "fixed", amountPaise: L(10000) }, sequence: 0 }),
    account({ accountId: "salary", allocation: { kind: "remainder" }, sequence: 1 }),
  ]);
  assert.equal(splits.find((s) => s.accountId === "savings")!.amountPaise, L(10000));
  assert.equal(splits.find((s) => s.accountId === "salary")!.amountPaise, L(35000));
});

test("a percentage split is taken on net pay", () => {
  const { splits } = splitNetPay(L(45000), [
    account({ accountId: "savings", allocation: { kind: "percent", bps: 2000 }, sequence: 0 }),
    account({ accountId: "salary", allocation: { kind: "remainder" }, sequence: 1 }),
  ]);
  assert.equal(splits.find((s) => s.accountId === "savings")!.amountPaise, L(9000));
  assert.equal(splits.find((s) => s.accountId === "salary")!.amountPaise, L(36000));
});

test("splits always sum to net exactly, whatever the mix", () => {
  for (const net of [L(45000), L(37333.33), 1, L(0.07)]) {
    const { splits } = splitNetPay(net, [
      account({ accountId: "a", allocation: { kind: "percent", bps: 3333 }, sequence: 0 }),
      account({ accountId: "b", allocation: { kind: "fixed", amountPaise: 1 }, sequence: 1 }),
      account({ accountId: "c", allocation: { kind: "remainder" }, sequence: 2 }),
    ]);
    const total = splits.reduce((a, s) => a + s.amountPaise, 0);
    assert.equal(total, net, `net ${net} split to ${total}`);
  }
});

test("a fixed split larger than net is reduced rather than overdrawn", () => {
  const { splits, warnings } = splitNetPay(L(5000), [
    account({ accountId: "savings", allocation: { kind: "fixed", amountPaise: L(10000) }, sequence: 0 }),
    account({ accountId: "salary", allocation: { kind: "remainder" }, sequence: 1 }),
  ]);
  assert.equal(splits.reduce((a, s) => a + s.amountPaise, 0), L(5000));
  assert.ok(warnings.some((w) => w.includes("has been reduced")));
});

test("splits are applied in sequence order, not array order", () => {
  const { splits } = splitNetPay(L(45000), [
    account({ accountId: "second", allocation: { kind: "fixed", amountPaise: L(5000) }, sequence: 2 }),
    account({ accountId: "first", allocation: { kind: "fixed", amountPaise: L(10000) }, sequence: 1 }),
    account({ accountId: "rest", allocation: { kind: "remainder" }, sequence: 3 }),
  ]);
  assert.equal(splits[0].accountId, "first");
  assert.equal(splits[1].accountId, "second");
});

test("with no remainder account the balance lands somewhere and is flagged", () => {
  const { splits, warnings } = splitNetPay(L(45000), [
    account({ accountId: "a", allocation: { kind: "fixed", amountPaise: L(10000) }, sequence: 0 }),
    account({ accountId: "b", allocation: { kind: "fixed", amountPaise: L(20000) }, sequence: 1 }),
  ]);
  assert.equal(splits.reduce((a, s) => a + s.amountPaise, 0), L(45000));
  assert.ok(warnings.some((w) => w.includes("Nominate a remainder account")));
});

test("a zero split is dropped rather than instructed", () => {
  const { splits } = splitNetPay(L(45000), [
    account({ accountId: "a", allocation: { kind: "fixed", amountPaise: 0 }, sequence: 0 }),
    account({ accountId: "b", allocation: { kind: "remainder" }, sequence: 1 }),
  ]);
  assert.equal(splits.length, 1);
  assert.equal(splits[0].accountId, "b");
});

/* ---------------- payment run ---------------- */

const build = (payees: Payee[]) =>
  buildPaymentRun({ payees, disbursingIfsc: "HDFC0000001" });

test("an ordinary payee produces one instruction", () => {
  const run = build([payee()]);
  assert.equal(run.instructions.length, 1);
  assert.equal(run.electronicTotalPaise, L(45000));
  assert.equal(run.totalPaise, L(45000));
});

test("banking with the disbursing bank is recognised as internal", () => {
  const run = build([
    payee({ accounts: [account({ ifsc: "HDFC0009999" })] }),
    payee({ employeeId: "e2", empCode: "KA0002", accounts: [account({ ifsc: "ICIC0001111" })] }),
  ]);
  assert.equal(run.sameBankCount, 1);
  assert.equal(run.interBankCount, 1);
});

test("cash and cheque payees are excluded from the file but still counted", () => {
  const run = build([
    payee(),
    payee({ employeeId: "e2", empCode: "KA0002", mode: "cash", netPaise: L(12000) }),
    payee({ employeeId: "e3", empCode: "KA0003", mode: "cheque", netPaise: L(8000) }),
  ]);
  assert.equal(run.instructions.length, 1);
  assert.equal(run.nonElectronic.length, 2);
  assert.equal(run.electronicTotalPaise, L(45000));
  assert.equal(run.nonElectronicTotalPaise, L(20000));
  assert.equal(run.totalPaise, L(65000), "the total still covers everyone");
});

test("a negative net is blocked, not instructed", () => {
  const run = build([payee({ netPaise: L(-500) })]);
  assert.equal(run.instructions.length, 0);
  assert.equal(run.blocked.length, 1);
  assert.match(run.blocked[0].reason, /takes money back/);
});

test("a zero net produces no instruction and no block", () => {
  const run = build([payee({ netPaise: 0 })]);
  assert.equal(run.instructions.length, 0);
  assert.equal(run.blocked.length, 0);
});

test("a bad IFSC blocks the employee entirely", () => {
  const run = build([payee({ accounts: [account({ ifsc: "BAD" })] })]);
  assert.equal(run.instructions.length, 0);
  assert.equal(run.blocked.length, 1);
  assert.match(run.blocked[0].reason, /not a valid code/);
});

test("a bad account number blocks the employee", () => {
  const run = build([payee({ accounts: [account({ accountNumber: "abc" })] })]);
  assert.equal(run.blocked.length, 1);
  assert.match(run.blocked[0].reason, /does not look like a bank account/);
});

test("no account on record blocks the employee", () => {
  const run = build([payee({ accounts: [] })]);
  assert.equal(run.blocked.length, 1);
  assert.match(run.blocked[0].reason, /No bank account/);
});

test("a blocked second account removes the whole payee, not half of them", () => {
  // Paying only part of someone's salary is worse than paying none.
  const run = build([
    payee({
      accounts: [
        account({ accountId: "good", allocation: { kind: "fixed", amountPaise: L(10000) }, sequence: 0 }),
        account({ accountId: "bad", ifsc: "NOPE", allocation: { kind: "remainder" }, sequence: 1 }),
      ],
    }),
  ]);
  assert.equal(run.instructions.length, 0, "the good half is withdrawn too");
  assert.equal(run.blocked.length, 1);
});

test("a split payee produces one instruction per account", () => {
  const run = build([
    payee({
      accounts: [
        account({ accountId: "savings", accountNumber: "50100111111111", allocation: { kind: "fixed", amountPaise: L(10000) }, sequence: 0 }),
        account({ accountId: "salary", allocation: { kind: "remainder" }, sequence: 1 }),
      ],
    }),
  ]);
  assert.equal(run.instructions.length, 2);
  assert.equal(run.electronicTotalPaise, L(45000));
});

test("a long beneficiary name is truncated where the format demands it", () => {
  const run = buildPaymentRun({
    payees: [
      payee({
        accounts: [
          account({ accountHolderName: "Aarav Venkataraman Subramanian Nair" }),
        ],
      }),
    ],
    disbursingIfsc: "HDFC0000001",
    nameMaxLength: 20,
  });
  assert.equal(run.instructions[0].accountHolderName.length, 20);
  assert.ok(run.instructions[0].warnings.some((w) => w.includes("truncated")));
});

/* ---------------- reconciliation ---------------- */

test("an intact run reconciles to the register", () => {
  const run = build([payee(), payee({ employeeId: "e2", empCode: "KA0002", mode: "cash", netPaise: L(5000) })]);
  const r = reconcilePaymentRun({ run, registerNetPaise: L(50000) });
  assert.equal(r.matches, true);
  assert.equal(r.differencePaise, 0);
});

test("a blocked employee makes the file short, and the note says why", () => {
  const run = build([payee(), payee({ employeeId: "e2", empCode: "KA0002", accounts: [] })]);
  const r = reconcilePaymentRun({ run, registerNetPaise: L(90000) });
  assert.equal(r.matches, false);
  assert.match(r.note, /1 employee\(s\) are blocked/);
  assert.match(r.note, /do not release a partial file/i);
});

test("a shortfall with nothing blocked is called out as unexplained", () => {
  const run = build([payee()]);
  const r = reconcilePaymentRun({ run, registerNetPaise: L(50000) });
  assert.equal(r.matches, false);
  assert.match(r.note, /with nothing blocked/);
});

/* ---------------- file formats ---------------- */

const formatArgs = {
  instructions: build([payee()]).instructions,
  companyName: "Meridian Labs",
  debitAccountNumber: "00110022003300",
  valueDate: "2026-10-01",
  reference: "SAL-2026-09",
};

test("the generic format carries a header and one row per instruction", () => {
  const file = formatBankFile({ ...formatArgs, format: "generic_csv" });
  const rows = file.content.trimEnd().split("\n");
  assert.equal(rows.length, 2);
  assert.ok(rows[0].startsWith("Employee Code,"));
  assert.equal(file.lineCount, 1);
});

test("amounts are written in rupees and paise, not paise integers", () => {
  const file = formatBankFile({ ...formatArgs, format: "generic_csv" });
  assert.ok(file.content.includes("45000.00"), file.content);
});

test("each bank format has its own column order", () => {
  const hdfc = formatBankFile({ ...formatArgs, format: "hdfc" });
  const icici = formatBankFile({ ...formatArgs, format: "icici" });
  assert.ok(hdfc.content.startsWith("Transaction Type,"));
  assert.ok(icici.content.startsWith("PYMT_MODE,"));
  assert.notEqual(hdfc.content, icici.content);
});

test("internal and interbank transfers are marked differently", () => {
  const internal = formatBankFile({
    ...formatArgs,
    instructions: build([payee({ accounts: [account({ ifsc: "HDFC0009999" })] })]).instructions,
    format: "hdfc",
  });
  const external = formatBankFile({
    ...formatArgs,
    instructions: build([payee({ accounts: [account({ ifsc: "ICIC0001111" })] })]).instructions,
    format: "hdfc",
  });
  assert.ok(internal.content.includes("\nI,"));
  assert.ok(external.content.includes("\nN,"));
});

test("RTGS below the floor is flagged rather than silently rejected by the bank", () => {
  const file = formatBankFile({
    ...formatArgs,
    instructions: build([payee({ netPaise: L(15000) })]).instructions,
    format: "rtgs",
  });
  assert.ok(file.warnings.some((w) => w.includes("RTGS floor")));
});

test("RTGS above the floor passes without warning", () => {
  const file = formatBankFile({
    ...formatArgs,
    instructions: build([payee({ netPaise: RTGS_MINIMUM_PAISE })]).instructions,
    format: "rtgs",
  });
  assert.equal(file.warnings.length, 0);
});

test("the file total equals the instructions it contains", () => {
  const run = build([
    payee(),
    payee({ employeeId: "e2", empCode: "KA0002", netPaise: L(31000) }),
  ]);
  const file = formatBankFile({ ...formatArgs, instructions: run.instructions, format: "neft" });
  assert.equal(file.totalPaise, L(76000));
  assert.equal(file.lineCount, 2);
});

test("a comma in a beneficiary name does not break the row", () => {
  const run = build([
    payee({ accounts: [account({ accountHolderName: "Nair, Aarav" })] }),
  ]);
  const file = formatBankFile({ ...formatArgs, instructions: run.instructions, format: "neft" });
  const row = file.content.trimEnd().split("\n")[1];
  assert.ok(row.includes('"Nair, Aarav"'));
  assert.equal(row.split(",").length, 8, "the quoted comma adds no field");
});
