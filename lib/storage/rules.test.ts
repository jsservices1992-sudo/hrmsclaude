import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkUpload,
  storageKeyFor,
  isSafeKey,
  downloadNameFor,
  assessExpiry,
  buildChecklist,
  MAX_FILE_BYTES,
  ALLOWED_TYPES,
} from "./rules";

const PDF_HEAD = "255044462d312e34";
const JPEG_HEAD = "ffd8ffe000104a46";
const PNG_HEAD = "89504e470d0a1a0a";

const upload = (over: Partial<Parameters<typeof checkUpload>[0]> = {}) =>
  checkUpload({
    declaredMime: "application/pdf",
    sizeBytes: 120_000,
    headHex: PDF_HEAD,
    originalName: "pan-card.pdf",
    ...over,
  });

/* ---------------- upload validation ---------------- */

test("a genuine PDF is accepted", () => {
  const r = upload();
  assert.equal(r.ok, true);
  assert.equal(r.extension, "pdf");
  assert.deepEqual(r.errors, []);
});

test("JPEG and PNG are accepted on their own magic bytes", () => {
  assert.equal(
    upload({ declaredMime: "image/jpeg", headHex: JPEG_HEAD }).ok,
    true,
  );
  assert.equal(
    upload({ declaredMime: "image/png", headHex: PNG_HEAD }).ok,
    true,
  );
});

test("an executable is refused however it is labelled", () => {
  const r = upload({ declaredMime: "application/x-msdownload", headHex: "4d5a90" });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("not accepted")));
});

test("a file lying about its type is refused, not stored under either", () => {
  // An executable renamed and relabelled as a PDF.
  const r = upload({ declaredMime: "application/pdf", headHex: "4d5a9000" });
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some((e) => e.includes("its contents are not")),
    r.errors.join("; "),
  );
});

test("a zip disguised as a PNG is refused", () => {
  const r = upload({ declaredMime: "image/png", headHex: "504b0304" });
  assert.equal(r.ok, false);
});

test("an empty file is refused", () => {
  const r = upload({ sizeBytes: 0 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("empty")));
});

test("a file over the limit is refused with its actual size", () => {
  const r = upload({ sizeBytes: MAX_FILE_BYTES + 1 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("The limit is 5MB")));
});

test("a file exactly at the limit is accepted", () => {
  assert.equal(upload({ sizeBytes: MAX_FILE_BYTES }).ok, true);
});

test("an absurd filename is refused", () => {
  const r = upload({ originalName: "a".repeat(300) + ".pdf" });
  assert.equal(r.ok, false);
});

test("no type is allowed that could execute or carry a macro", () => {
  const risky = ["application/x-msdownload", "text/html", "application/vnd.ms-excel", "image/svg+xml"];
  for (const mime of risky) {
    assert.ok(
      !ALLOWED_TYPES.some((t) => t.mime === mime),
      `${mime} should not be allowed`,
    );
  }
});

/* ---------------- storage keys ---------------- */

test("the key is built from ids, never from the uploaded name", () => {
  const key = storageKeyFor({
    employeeId: "emp_0001",
    documentId: "11111111-2222-3333-4444-555555555555",
    extension: "pdf",
  });
  assert.equal(key, "emp_0001/11111111-2222-3333-4444-555555555555.pdf");
});

test("a document id with underscores is accepted, same as an employee id", () => {
  // Onboarding seeds human-readable ids like "jdoc_joiner_0002_AADHAAR" —
  // this must not be rejected just because it isn't a UUID.
  const key = storageKeyFor({
    employeeId: "joiner_0002",
    documentId: "jdoc_joiner_0002_AADHAAR",
    extension: "png",
  });
  assert.equal(key, "joiner_0002/jdoc_joiner_0002_AADHAAR.png");
  assert.ok(isSafeKey(key));
});

test("a traversal attempt in an id is refused rather than sanitised", () => {
  assert.throws(
    () =>
      storageKeyFor({
        employeeId: "../../etc",
        documentId: "11111111-2222-3333-4444-555555555555",
        extension: "pdf",
      }),
    /not a safe path segment/,
  );
});

test("a crafted extension is refused", () => {
  assert.throws(
    () =>
      storageKeyFor({
        employeeId: "emp_0001",
        documentId: "11111111-2222-3333-4444-555555555555",
        extension: "../sh",
      }),
    /not a safe path segment/,
  );
});

test("safe keys pass and unsafe ones do not", () => {
  assert.ok(isSafeKey("emp_0001/abc-123.pdf"));
  assert.ok(!isSafeKey("../emp_0001/abc.pdf"));
  assert.ok(!isSafeKey("/etc/passwd"));
  assert.ok(!isSafeKey("emp_0001/../../secret.pdf"));
  assert.ok(!isSafeKey("emp_0001/abc.pdf\0.png"));
  assert.ok(!isSafeKey("emp_0001/abc"), "no extension");
});

test("a download name is derived safely from the label", () => {
  const name = downloadNameFor({
    label: 'PAN "card" / 2024',
    empCode: "KA0001",
    extension: "pdf",
  });
  assert.ok(!name.includes("/"));
  assert.ok(!name.includes('"'));
  assert.ok(name.startsWith("KA0001-"));
  assert.ok(name.endsWith(".pdf"));
});

test("an empty label still yields a usable filename", () => {
  const name = downloadNameFor({ label: "///", empCode: "KA0001", extension: "pdf" });
  assert.equal(name, "KA0001-document.pdf");
});

/* ---------------- expiry ---------------- */

test("no expiry is not a problem", () => {
  const r = assessExpiry({ expiresOn: null, today: "2026-09-11" });
  assert.equal(r.status, "none");
  assert.equal(r.daysRemaining, null);
});

test("a document well in date is valid", () => {
  const r = assessExpiry({ expiresOn: "2028-01-01", today: "2026-09-11" });
  assert.equal(r.status, "valid");
});

test("a document inside the warning window is expiring", () => {
  const r = assessExpiry({ expiresOn: "2026-10-11", today: "2026-09-11" });
  assert.equal(r.status, "expiring");
  assert.equal(r.daysRemaining, 30);
  assert.match(r.note, /Expires in 30 day/);
});

test("a past expiry is expired, and says how long ago", () => {
  const r = assessExpiry({ expiresOn: "2026-08-11", today: "2026-09-11" });
  assert.equal(r.status, "expired");
  assert.match(r.note, /Expired 31 day\(s\) ago/);
});

test("expiring today counts as expiring, not expired", () => {
  const r = assessExpiry({ expiresOn: "2026-09-11", today: "2026-09-11" });
  assert.equal(r.status, "expiring");
  assert.equal(r.daysRemaining, 0);
});

/* ---------------- checklist ---------------- */

const held = (over: Partial<{ docType: string; verified: boolean; expiresOn: string | null; hasFile: boolean }> = {}) => ({
  docType: "PAN",
  verified: true,
  expiresOn: null,
  hasFile: true,
  ...over,
});

test("a permanent employee with nothing on file has every mandatory item missing", () => {
  const r = buildChecklist({
    employmentType: "permanent",
    held: [],
    today: "2026-09-11",
  });
  assert.ok(r.mandatoryMissing.length > 0);
  assert.equal(r.completionBps, 0);
  assert.equal(r.readyForDayOne, false);
});

test("PAN missing raises the 206AA warning specifically", () => {
  const r = buildChecklist({
    employmentType: "permanent",
    held: [],
    today: "2026-09-11",
  });
  assert.ok(r.warnings.some((w) => w.includes("206AA")));
});

test("a row with no file behind it does not count as held", () => {
  // The case that lets somebody tick a box without uploading anything.
  const r = buildChecklist({
    employmentType: "permanent",
    held: [held({ hasFile: false })],
    today: "2026-09-11",
  });
  const pan = r.items.find((i) => i.requirement.docType === "PAN")!;
  assert.equal(pan.present, false);
  assert.equal(pan.status, "missing");
});

test("an uploaded but unverified document is not complete", () => {
  const r = buildChecklist({
    employmentType: "permanent",
    held: [held({ verified: false })],
    today: "2026-09-11",
  });
  const pan = r.items.find((i) => i.requirement.docType === "PAN")!;
  assert.equal(pan.status, "unverified");
  assert.equal(r.unverified.length, 1);
});

test("an expired document is expired even when verified", () => {
  const r = buildChecklist({
    employmentType: "permanent",
    held: [held({ docType: "PASSPORT", expiresOn: "2026-01-01" })],
    today: "2026-09-11",
  });
  const passport = r.items.find((i) => i.requirement.docType === "PASSPORT")!;
  assert.equal(passport.status, "expired");
  assert.equal(r.readyForDayOne, false);
  assert.ok(r.warnings.some((w) => w.includes("need renewing")));
});

test("requirements differ by employment type", () => {
  const permanent = buildChecklist({
    employmentType: "permanent",
    held: [],
    today: "2026-09-11",
  });
  const consultant = buildChecklist({
    employmentType: "consultant",
    held: [],
    today: "2026-09-11",
  });
  assert.ok(
    consultant.mandatoryMissing.length < permanent.mandatoryMissing.length,
    "a consultant needs fewer documents than a permanent employee",
  );
  assert.ok(
    !consultant.items.find((i) => i.requirement.docType === "RELIEVING")!.mandatory,
    "a relieving letter is not required of a consultant",
  );
});

test("all mandatory documents present and verified is ready for day one", () => {
  const required = buildChecklist({
    employmentType: "permanent",
    held: [],
    today: "2026-09-11",
  }).items.filter((i) => i.mandatory);

  const r = buildChecklist({
    employmentType: "permanent",
    held: required.map((i) => held({ docType: i.requirement.docType })),
    today: "2026-09-11",
  });

  assert.equal(r.readyForDayOne, true);
  assert.equal(r.completionBps, 10000);
  assert.equal(r.mandatoryMissing.length, 0);
});

test("completion counts only mandatory items, not optional extras", () => {
  const r = buildChecklist({
    employmentType: "consultant",
    held: [held({ docType: "PAYSLIP" }), held({ docType: "FORM16" })],
    today: "2026-09-11",
  });
  assert.equal(r.completionBps, 0, "two optional documents move nothing");
});
