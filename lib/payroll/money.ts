/**
 * Currency is handled in paise (integer) throughout the engine.
 * Floating point rupees are never used for a stored or compared amount.
 */

export type Paise = number;

export type RoundingMode = "nearest" | "up" | "down";

export function rupeesToPaise(rupees: number): Paise {
  return Math.round(rupees * 100);
}

export function paiseToRupees(paise: Paise): number {
  return paise / 100;
}

/** Round a paise amount to whole rupees under the company's rounding mode. */
export function roundToRupee(paise: Paise, mode: RoundingMode = "nearest"): Paise {
  const rupees = paise / 100;
  const whole =
    mode === "up"
      ? Math.ceil(rupees)
      : mode === "down"
        ? Math.floor(rupees)
        : Math.round(rupees);
  return whole * 100;
}

/**
 * Apportion `total` across `weights` so the parts sum exactly to `total`.
 * The largest-remainder method: without it, rounding each part independently
 * leaves a stray paisa and the components stop summing to the stated gross.
 */
export function apportion(total: Paise, weights: number[]): Paise[] {
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0) return weights.map(() => 0);

  const exact = weights.map((w) => (total * w) / weightSum);
  const floors = exact.map((v) => Math.floor(v));
  let remainder = total - floors.reduce((a, b) => a + b, 0);

  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);

  const out = [...floors];
  for (let k = 0; k < order.length && remainder > 0; k++) {
    out[order[k].i] += 1;
    remainder -= 1;
  }
  return out;
}

export function formatINR(paise: Paise): string {
  const negative = paise < 0;
  const rupees = Math.abs(paise) / 100;
  const [whole, frac] = rupees.toFixed(2).split(".");

  // Indian grouping: last three digits, then pairs.
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest
    ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3
    : last3;

  return `${negative ? "−" : ""}₹${grouped}.${frac}`;
}
