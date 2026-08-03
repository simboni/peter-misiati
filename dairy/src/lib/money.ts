/**
 * Money and quantity helpers.
 *
 * Drizzle returns `numeric` columns as strings, which is correct — KES amounts
 * must never round-trip through a float. Everything here converts explicitly at
 * the edges and keeps arithmetic in integer minor units where it matters.
 */

/** Parse a numeric column (or null) into a number. Null and "" become 0. */
export function num(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Format for a numeric column: fixed decimal string, never scientific notation. */
export function dec(v: number, scale = 2): string {
  if (!Number.isFinite(v)) return (0).toFixed(scale);
  return v.toFixed(scale);
}

/** Round money to cents, avoiding the classic 0.1 + 0.2 drift. */
export function money(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** KES for display. Whole shillings by default — nobody quotes cents for milk. */
export function kes(v: number | string | null | undefined, decimals = 0): string {
  const n = num(v);
  return `KES ${n.toLocaleString("en-KE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/** Litres for display. Two decimals only when they carry information. */
export function litres(v: number | string | null | undefined): string {
  const n = num(v);
  const s = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return `${s} L`;
}

/**
 * Convert a purchase or issue line to kilograms.
 *
 * This is where feed cost accuracy is won or lost. A Kenyan hay bale runs
 * 12–25 kg and a round bale 300–500; dairy meal comes in 70 kg *and* 50 kg bags
 * at very different prices. Quantity alone is meaningless.
 */
export function toKg(quantity: number | string, unitWeightKg: number | string): number {
  return money(num(quantity) * num(unitWeightKg));
}

/** Cost per kilogram of a purchase line. */
export function costPerKg(totalCostKes: number | string, totalKg: number | string): number {
  const kg = num(totalKg);
  return kg === 0 ? 0 : money(num(totalCostKes) / kg);
}

/** Cost per kilogram of DRY MATTER — the figure rations are actually built on. */
export function costPerKgDm(costPerKgAsFed: number, dmPct: number | string): number {
  const dm = num(dmPct);
  return dm === 0 ? 0 : money(costPerKgAsFed / (dm / 100));
}
