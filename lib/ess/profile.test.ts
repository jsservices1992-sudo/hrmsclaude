import test from "node:test";
import assert from "node:assert/strict";
import {
  PROFILE_FIELDS,
  isRequestableField,
  validateProfileChange,
  maskAccount,
} from "./profile";

const base = { currentValue: null, hasProof: true };

test("only listed fields can be requested", () => {
  assert.equal(isRequestableField("mobile"), true);
  for (const forbidden of ["empCode", "companyId", "dateOfJoining", "status", "gradeId", "managerId"]) {
    assert.equal(isRequestableField(forbidden), false, forbidden);
  }
});

test("an unlisted field is refused even if the form says otherwise", () => {
  const r = validateProfileChange({ ...base, field: "dateOfJoining", requestedValue: "2020-01-01" });
  assert.equal(r.ok, false);
});

test("mobile numbers are normalised, not just accepted", () => {
  for (const input of ["9876543210", "+91 98765 43210", "98765-43210"]) {
    const r = validateProfileChange({ ...base, field: "mobile", requestedValue: input });
    assert.equal(r.ok, true, input);
    assert.equal(r.ok && r.value, "9876543210");
  }
});

test("a number that is not an Indian mobile is refused", () => {
  for (const bad of ["1234567890", "987654321", "98765432101", "5876543210"]) {
    const r = validateProfileChange({ ...base, field: "mobile", requestedValue: bad });
    assert.equal(r.ok, false, bad);
  }
});

test("IFSC and PAN are upper-cased and shape-checked", () => {
  const ifsc = validateProfileChange({ ...base, field: "ifsc", requestedValue: "hdfc0001234" });
  assert.deepEqual(ifsc, { ok: true, value: "HDFC0001234" });
  assert.equal(validateProfileChange({ ...base, field: "ifsc", requestedValue: "HDFC1001234" }).ok, false);

  const pan = validateProfileChange({ ...base, field: "pan", requestedValue: "abcpd1234e" });
  assert.deepEqual(pan, { ok: true, value: "ABCPD1234E" });
  assert.equal(validateProfileChange({ ...base, field: "pan", requestedValue: "ABCD1234EF" }).ok, false);
});

test("a bank account is 9 to 18 digits", () => {
  assert.equal(validateProfileChange({ ...base, field: "bankAccount", requestedValue: "50181003001" }).ok, true);
  assert.equal(validateProfileChange({ ...base, field: "bankAccount", requestedValue: "12345678" }).ok, false);
  assert.equal(validateProfileChange({ ...base, field: "bankAccount", requestedValue: "50181003001X" }).ok, false);
});

test("a sensitive field cannot be requested without evidence on file", () => {
  for (const field of ["bankAccount", "ifsc", "pan"]) {
    const r = validateProfileChange({
      field,
      requestedValue: field === "pan" ? "ABCPD1234E" : field === "ifsc" ? "HDFC0001234" : "50181003001",
      currentValue: null,
      hasProof: false,
    });
    assert.equal(r.ok, false, field);
    assert.match(r.ok === false ? r.error : "", /evidence/);
  }
});

test("an ordinary field needs no evidence", () => {
  const r = validateProfileChange({
    field: "city",
    requestedValue: "Pune",
    currentValue: "Bengaluru",
    hasProof: false,
  });
  assert.equal(r.ok, true);
});

test("asking for what the record already says is refused", () => {
  const r = validateProfileChange({
    ...base,
    field: "city",
    requestedValue: " Pune ",
    currentValue: "Pune",
  });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /already says/);
});

test("a blank value is not a change", () => {
  const r = validateProfileChange({ ...base, field: "city", requestedValue: "   " });
  assert.equal(r.ok, false);
});

test("PIN codes are six digits and never start with zero", () => {
  assert.equal(validateProfileChange({ ...base, field: "pincode", requestedValue: "560001" }).ok, true);
  assert.equal(validateProfileChange({ ...base, field: "pincode", requestedValue: "060001" }).ok, false);
  assert.equal(validateProfileChange({ ...base, field: "pincode", requestedValue: "56001" }).ok, false);
});

test("marital status must be one of the offered options", () => {
  assert.equal(validateProfileChange({ ...base, field: "maritalStatus", requestedValue: "married" }).ok, true);
  assert.equal(validateProfileChange({ ...base, field: "maritalStatus", requestedValue: "divorced" }).ok, false);
});

test("account masking shows the last four and nothing else", () => {
  assert.equal(maskAccount("50181003001"), "••••3001");
  assert.equal(maskAccount(null), "Not on record");
  assert.equal(maskAccount(""), "Not on record");
  assert.equal(maskAccount("123"), "••••");
});

test("every sensitive field demands proof", () => {
  for (const f of PROFILE_FIELDS.filter((f) => f.sensitive)) {
    assert.equal(f.needsProof, true, f.field);
  }
});

test("acronym fields read correctly mid-sentence", () => {
  const pan = PROFILE_FIELDS.find((f) => f.field === "pan")!;
  assert.equal(pan.sentenceLabel, "PAN", "lower-casing the label would give 'pan'");
  const ifsc = PROFILE_FIELDS.find((f) => f.field === "ifsc")!;
  assert.match(ifsc.sentenceLabel, /IFSC/);
  const pincode = PROFILE_FIELDS.find((f) => f.field === "pincode")!;
  assert.match(pincode.sentenceLabel, /PIN/);
});

test("the evidence message names the field the way a person would", () => {
  const r = validateProfileChange({
    field: "pan",
    requestedValue: "ABCPD1234E",
    currentValue: null,
    hasProof: false,
  });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /your PAN\.$/);
});

test("every field carries a sentence form", () => {
  for (const f of PROFILE_FIELDS) {
    assert.equal(typeof f.sentenceLabel, "string", f.field);
    assert.notEqual(f.sentenceLabel, "", f.field);
  }
});
