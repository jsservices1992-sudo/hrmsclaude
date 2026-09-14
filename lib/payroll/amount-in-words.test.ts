import test from "node:test";
import assert from "node:assert/strict";
import { numberToIndianWords, rupeesInWords } from "./amount-in-words";

test("zero and the small numbers that have their own words", () => {
  assert.equal(numberToIndianWords(0), "Zero");
  assert.equal(numberToIndianWords(7), "Seven");
  assert.equal(numberToIndianWords(13), "Thirteen");
  assert.equal(numberToIndianWords(19), "Nineteen");
  assert.equal(numberToIndianWords(20), "Twenty");
  assert.equal(numberToIndianWords(21), "Twenty One");
  assert.equal(numberToIndianWords(99), "Ninety Nine");
});

test("hundreds do not gain a stray 'and'", () => {
  assert.equal(numberToIndianWords(100), "One Hundred");
  assert.equal(numberToIndianWords(105), "One Hundred Five");
  assert.equal(numberToIndianWords(250), "Two Hundred Fifty");
});

test("counts on the Indian scale, not the western one", () => {
  assert.equal(numberToIndianWords(1_000), "One Thousand");
  assert.equal(numberToIndianWords(45_000), "Forty Five Thousand");
  // 1,00,000 is a lakh, not "one hundred thousand".
  assert.equal(numberToIndianWords(100_000), "One Lakh");
  assert.equal(numberToIndianWords(1_08_229), "One Lakh Eight Thousand Two Hundred Twenty Nine");
  // 1,00,00,000 is a crore, not "ten million".
  assert.equal(numberToIndianWords(10_000_000), "One Crore");
  assert.equal(numberToIndianWords(2_40_00_000), "Two Crore Forty Lakh");
});

test("skips empty places rather than saying them", () => {
  // No "zero thousand" between the lakh and the hundreds.
  assert.equal(numberToIndianWords(1_00_500), "One Lakh Five Hundred");
  assert.equal(numberToIndianWords(1_00_00_001), "One Crore One");
});

test("a payslip amount reads as rupees and paise", () => {
  assert.equal(rupeesInWords(0), "Rupees Zero Only");
  assert.equal(rupeesInWords(1_08_229_00), "Rupees One Lakh Eight Thousand Two Hundred Twenty Nine Only");
  assert.equal(
    rupeesInWords(1_08_228_65),
    "Rupees One Lakh Eight Thousand Two Hundred Twenty Eight and Sixty Five Paise Only",
  );
  assert.equal(rupeesInWords(50_05), "Rupees Fifty and Five Paise Only");
});

test("a negative net is spelled as such rather than silently dropped", () => {
  assert.equal(rupeesInWords(-500_00), "Minus Rupees Five Hundred Only");
});

test("paise are rounded to whole paise, never left as a fraction", () => {
  assert.equal(rupeesInWords(100_50.4), "Rupees One Hundred and Fifty Paise Only");
});
