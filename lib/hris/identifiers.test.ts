import test from "node:test";
import assert from "node:assert/strict";
import {
  normaliseMobile,
  normalisePan,
  normaliseIfsc,
  normaliseUan,
  normaliseBankAccount,
  MOBILE_RE,
  IFSC_RE,
  BANK_ACCOUNT_RE,
  PAN_RE,
  UAN_RE,
} from "./identifiers";

test("a mobile arrives however it was written down", () => {
  for (const written of [
    "9876543210",
    "98765 43210",
    "98765-43210",
    " 9876543210 ",
    "+91 98765 43210",
    "+919876543210",
    "0091 9876543210",
    "919876543210",
    "09876543210",
  ]) {
    assert.equal(normaliseMobile(written), "9876543210", `"${written}"`);
    assert.match(normaliseMobile(written)!, MOBILE_RE);
  }
});

test("a mobile that is genuinely wrong stays wrong", () => {
  assert.doesNotMatch(normaliseMobile("12345")!, MOBILE_RE, "too short");
  assert.doesNotMatch(normaliseMobile("1234567890")!, MOBILE_RE, "landline-style leading 1");
  assert.doesNotMatch(normaliseMobile("98765 4321O")!, MOBILE_RE, "letter O for zero");
});

test("an IFSC keeps its shape but loses its spacing", () => {
  assert.equal(normaliseIfsc("hdfc 0000123"), "HDFC0000123");
  assert.equal(normaliseIfsc("HDFC-0000123"), "HDFC0000123");
  assert.match(normaliseIfsc("hdfc0000123")!, IFSC_RE);
  assert.doesNotMatch(normaliseIfsc("HDFC1000123")!, IFSC_RE, "fifth character must be zero");
  assert.doesNotMatch(normaliseIfsc("HDF00000123")!, IFSC_RE, "four letters, not three");
});

test("an account number is digits, however the passbook prints it", () => {
  assert.equal(normaliseBankAccount("5010 0234 5678 91"), "501002345678 91".replace(" ", ""));
  assert.match(normaliseBankAccount("5010 0234 5678 91")!, BANK_ACCOUNT_RE);
  assert.doesNotMatch(normaliseBankAccount("50100-ABC-678")!, BANK_ACCOUNT_RE, "letters are not an account");
  assert.doesNotMatch(normaliseBankAccount("12345678")!, BANK_ACCOUNT_RE, "eight digits is too short");
});

test("PAN and UAN normalise the same way", () => {
  assert.equal(normalisePan(" abcde1234f "), "ABCDE1234F");
  assert.match(normalisePan("abcde1234f")!, PAN_RE);
  assert.equal(normaliseUan("1234 5678 9012"), "123456789012");
  assert.match(normaliseUan("1234 5678 9012")!, UAN_RE);
});

test("blank stays blank rather than becoming an empty string", () => {
  for (const fn of [normaliseMobile, normalisePan, normaliseIfsc, normaliseUan, normaliseBankAccount]) {
    assert.equal(fn(""), null);
    assert.equal(fn("   "), null);
    assert.equal(fn(null), null);
    assert.equal(fn(undefined), null);
  }
});
