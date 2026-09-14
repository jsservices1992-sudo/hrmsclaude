import test from "node:test";
import assert from "node:assert/strict";
import {
  checkSignup,
  checkPassword,
  normaliseEmail,
  normaliseCompanyName,
  signupEnabled,
  MIN_PASSWORD_LENGTH,
  type SignupDraft,
} from "./signup";

const draft = (over: Partial<SignupDraft> = {}): SignupDraft => ({
  companyName: "Acme Private Limited",
  adminName: "Ops Lead",
  email: "ops@acme.in",
  password: "correct horse battery",
  confirmPassword: "correct horse battery",
  ...over,
});

test("a complete registration has nothing to object to", () => {
  assert.deepEqual(checkSignup(draft()), []);
});

test("length is the password rule, not punctuation", () => {
  assert.equal(checkPassword("a".repeat(MIN_PASSWORD_LENGTH) + "b"), null);
  assert.match(checkPassword("short1!")!, /at least 12 characters/);
});

test("a long but obvious password is refused", () => {
  for (const bad of ["password1234", "PASSWORD1234", "qwertyuiop12"]) {
    assert.match(checkPassword(bad)!, /first passwords anyone would try/, bad);
  }
  assert.match(checkPassword("aaaaaaaaaaaaaa")!, /same character repeated/);
});

test("a password cannot contain the email or the company name", () => {
  assert.match(
    checkPassword("santosh-and-more", { email: "santosh@acme.in" }) ?? "",
    /not contain your email/,
  );
  assert.match(
    checkPassword("acmeprivatelimited", { companyName: "Acme Private Limited" }) ?? "",
    /not contain your company/,
  );
});

test("a short email local part is not treated as a substring rule", () => {
  // "ops" would otherwise ban any password containing those three letters,
  // which rules out far too much ordinary English.
  assert.equal(checkPassword("developments here", { email: "ops@acme.in" }), null);
  assert.equal(checkPassword("this is a fine one", { email: "hi@acme.in" }), null);
});

test("mismatched confirmation is caught, but only once the password is sound", () => {
  const mismatch = checkSignup(draft({ confirmPassword: "something else here" }));
  assert.deepEqual(mismatch.map((i) => i.field), ["confirmPassword"]);

  // A weak password reports the weakness rather than also the mismatch,
  // so the person fixes one thing at a time.
  const weak = checkSignup(draft({ password: "short", confirmPassword: "nope" }));
  assert.deepEqual(weak.map((i) => i.field), ["password"]);
});

test("each missing field is reported against itself", () => {
  const issues = checkSignup(draft({ companyName: " ", adminName: "", email: "nope" }));
  assert.deepEqual(issues.map((i) => i.field).sort(), ["adminName", "companyName", "email"]);
});

test("email and company name are normalised so the same one cannot register twice", () => {
  assert.equal(normaliseEmail("  OPS@Acme.IN "), "ops@acme.in");
  assert.equal(normaliseCompanyName("  Acme   Private  Limited "), "Acme Private Limited");
});

test("registration is open unless explicitly switched off", () => {
  assert.equal(signupEnabled({}), true);
  assert.equal(signupEnabled({ SIGNUP_ENABLED: "true" }), true);
  for (const off of ["false", "FALSE", "0", "off", " Off "]) {
    assert.equal(signupEnabled({ SIGNUP_ENABLED: off }), false, off);
  }
});
