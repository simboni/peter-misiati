/**
 * Money and quantity arithmetic.
 *
 * Two rules make the whole system reconcile:
 *   money    — integer cents of KES, never a float
 *   quantity — integer thousandths ("milli") of kg / L / pcs
 *
 * Every total the shop sees is computed from these integers. Floats are only
 * ever produced at the last moment for display.
 */

export const MILLI = 1000;
export const CENTS = 100;

/** 1.5 (kg) -> 1500 */
export function toMilli(value: number): number {
  return Math.round(value * MILLI);
}

/** 1500 -> 1.5 */
export function fromMilli(milli: number): number {
  return milli / MILLI;
}

/** 120 (KES) -> 12000 */
export function toCents(shillings: number): number {
  return Math.round(shillings * CENTS);
}

/** 12000 -> 120 */
export function fromCents(cents: number): number {
  return cents / CENTS;
}

/**
 * Scale a quantity by a ratio without losing exactness to floating point.
 * Used by the batch calculator: qty per reference batch -> qty for this batch.
 */
export function scaleMilli(qtyMilli: number, targetMilli: number, refMilli: number): number {
  if (refMilli <= 0) throw new Error("reference batch size must be positive");
  return Math.round((qtyMilli * targetMilli) / refMilli);
}

/** Money formatted the way the shop reads it: "KES 1,250" */
export function formatKes(cents: number): string {
  const shillings = cents / CENTS;
  const whole = Number.isInteger(shillings);
  return (
    "KES " +
    shillings.toLocaleString("en-KE", {
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    })
  );
}

/**
 * The same money, to the nearest shilling.
 *
 * For headline figures only. "KES 1,008,641.01" on a summary tile is two
 * characters of precision nobody reads and a line wrap everybody does; the exact
 * cents still appear on the rows the figure is a total of.
 */
export function formatKesRounded(cents: number): string {
  return "KES " + Math.round(cents / CENTS).toLocaleString("en-KE");
}

/** Bare number, no currency word — for table columns that already say KES. */
export function formatAmount(cents: number): string {
  const shillings = cents / CENTS;
  return shillings.toLocaleString("en-KE", {
    minimumFractionDigits: Number.isInteger(shillings) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Quantity in the unit a person would say out loud.
 * Small kg amounts become grams, small litres become millilitres — matching how
 * the client's own formula sheets are written ("20 G", "50 ML", "1.5 KG").
 */
export function formatQty(milli: number, unit: string): string {
  const abs = Math.abs(milli);
  if (unit === "kg" && abs > 0 && abs < MILLI) {
    return `${trim(abs)} g`;
  }
  if (unit === "L" && abs > 0 && abs < MILLI) {
    return `${trim(abs)} ml`;
  }
  if (unit === "pcs") {
    return `${trim(milli / MILLI)} pcs`;
  }
  return `${trim(milli / MILLI)} ${unit}`;
}

function trim(n: number): string {
  return Number(n.toFixed(3)).toLocaleString("en-KE", { maximumFractionDigits: 3 });
}

/**
 * How many whole units (drums, packs, bottles) a quantity represents.
 * The client counts stock in units; we store it in milli of substance.
 */
export function unitsFromMilli(qtyMilli: number, sizeMilli: number): number {
  if (sizeMilli <= 0) return 0;
  return qtyMilli / sizeMilli;
}

export function formatUnits(qtyMilli: number, sizeMilli: number, unitLabel: string): string {
  const units = unitsFromMilli(qtyMilli, sizeMilli);
  const shown = Number(units.toFixed(2));
  const plural = Math.abs(shown) === 1 ? unitLabel : pluralise(unitLabel);
  return `${shown.toLocaleString("en-KE", { maximumFractionDigits: 2 })} ${plural}`;
}

function pluralise(word: string): string {
  if (word.endsWith("s")) return word;
  if (word.endsWith("y")) return word.slice(0, -1) + "ies";
  return word + "s";
}

// ------------------------------------------------------------------ time

/**
 * The shop is in Nairobi (UTC+3, no daylight saving). Grouping sales by a UTC
 * date would push every evening sale onto the wrong day and make the owner's
 * cash count disagree with the report — so business dates are always computed
 * in Africa/Nairobi.
 */
export const SHOP_TZ = "Africa/Nairobi";

/** "2026-08-03" for a given instant, in shop time. */
export function businessDate(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return parts;
}

/** "3 Aug 2026, 14:05" in shop time. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: SHOP_TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function formatDate(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: SHOP_TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

/** Percentage difference, guarded against divide-by-zero. */
export function pct(part: number, whole: number): number {
  if (whole === 0) return 0;
  return (part / whole) * 100;
}
