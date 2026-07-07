// ---------------------------------------------------------------------------
// Money & quantity helpers. Money is ALWAYS integer minor units (KES cents).
// Quantities are integer thousandths (2.5 => 2500) to allow fractional units.
// These functions are pure and unit-tested (see test/).
// ---------------------------------------------------------------------------

/** Round-half-up integer division of a*b/den (keeps money deterministic). */
export function mulDiv(a: number, b: number, den: number): number {
  if (den === 0) return 0;
  const v = (a * b) / den;
  return Math.round(v);
}

/** Format minor units as a human string, e.g. 123456 -> "1,234.56". */
export function formatAmount(minor: number): string {
  const neg = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const whole = Math.floor(abs / 100);
  const cents = abs % 100;
  const withSep = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${withSep}.${cents.toString().padStart(2, "0")}`;
}

/** Format with a currency code prefix, e.g. formatMoney(123456,"KES") -> "KES 1,234.56". */
export function formatMoney(minor: number, currency = "KES"): string {
  return `${currency} ${formatAmount(minor)}`;
}

/** Parse a user-entered amount ("1,234.56" or "1234.5") into minor units. */
export function parseAmount(input: unknown): number {
  if (input === null || input === undefined || input === "") return 0;
  const s = String(input).replace(/[^0-9.-]/g, "");
  if (s === "" || s === "-" || s === ".") return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** Quantity thousandths -> display string ("2500" -> "2.5", "1000" -> "1"). */
export function formatQty(milli: number): string {
  const n = milli / 1000;
  return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(3)));
}

/** Parse a user-entered quantity ("2.5") into thousandths. */
export function parseQty(input: unknown): number {
  if (input === null || input === undefined || input === "") return 0;
  const s = String(input).replace(/[^0-9.-]/g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000);
}

/** VAT basis points -> percent string ("1600" -> "16"). */
export function formatRate(bps: number): string {
  const n = bps / 100;
  return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(2)));
}

/** Percent string ("16") -> basis points (1600). */
export function parseRate(input: unknown): number {
  if (input === null || input === undefined || input === "") return 0;
  const n = Number(String(input).replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/**
 * Split `total` into integer parts proportional to `weights`, summing EXACTLY
 * to `total` (largest-remainder method). Used to allocate a global discount
 * across lines without cent drift.
 */
export function allocateProportional(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const floors = raw.map((r) => Math.floor(r));
  let remainder = total - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  const result = [...floors];
  for (let k = 0; k < order.length && remainder > 0; k++) {
    result[order[k].i] += 1;
    remainder -= 1;
  }
  return result;
}
