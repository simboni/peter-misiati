/**
 * What a cart line comes to, and what it would have come to at the asking price.
 *
 * WHY THIS IS NOT IN THE SELL SCREEN ANY MORE. It was, and it was wrong for
 * weeks without anybody being able to see it. A 25 g bundle of Ocean Breeze
 * Conc — a chemical the shop prices at 3,000 a kilo — was compared against
 * 3,000 rather than against 75, so a 230 shilling sale announced a discount of
 * 2,880 and printed it on the customer's receipt. Forty-four sales in one month
 * carried a discount nobody had given.
 *
 * The arithmetic is four lines and the bug was a missing case, which is exactly
 * the shape of thing a test catches and a reading does not. Nothing here
 * touches the DOM or the database, so it runs under plain Node.
 *
 * THE ONE IDEA. A line is priced one of three ways and they are not
 * interchangeable:
 *
 *   a bundle   — a price for the whole size, however much it weighs
 *   weighed    — a price per kilogramme or litre, times the quantity
 *   whole      — a price per container, times the number of containers
 *
 * `bundleId` decides the first; the ITEM's basis decides between the other two.
 * Asking the item alone — which is what the sell screen did — cannot see that a
 * size was sold, and treats a bundle of a weighed chemical as a rate.
 */

/** Only what the money depends on. The screen's own types are bigger. */
export interface PricedItem {
  /** 'unit' is priced per kg / L; 'pack' is priced per container. */
  basis: "pack" | "unit";
  /** What the shop asks for one kilogramme, litre or container. */
  priceCents: number;
}

export interface PricedLine {
  /** The size this was sold as, or null for loose weight / a plain container. */
  bundleId: number | null;
  /** How many: containers, or bundles. A weighed line is always one scoop. */
  units: number;
  /** Thousandths of a kg / L / pcs. */
  qtyMilli: number;
  /** What is being charged — per bundle, per container, or per kg / L. */
  priceCents: number;
}

/** What this line comes to. A null item is a mix: it has no shelf behind it. */
export function lineCents(item: PricedItem | null, line: PricedLine): number {
  // A bundle is a price for the whole size — not a rate, however it is weighed.
  // A mixed product sold by the size is the same shape and has no item at all.
  if (line.bundleId !== null) return line.priceCents * line.units;
  if (!item) return line.priceCents * line.units;
  if (item.basis === "unit") return Math.round((line.priceCents * line.qtyMilli) / 1000);
  return line.priceCents * line.units;
}

/**
 * What this line would have come to at today's asking price.
 *
 * Three cases and only one of them wants the shelf rate. A bundle's asking
 * price is the size's own, already on the line. A mix has no shelf rate behind
 * it at all. A loose or whole line is the one really being compared against
 * what the shop asks per kilogramme or per container.
 */
export function lineAtListCents(item: PricedItem | null, line: PricedLine): number {
  if (!item || line.bundleId !== null) return lineCents(item, line);
  return lineCents(item, { ...line, priceCents: item.priceCents });
}

/** The bill at the asking price, and what has been knocked off it. */
export function cartDiscount(
  rows: Array<{ item: PricedItem | null; line: PricedLine }>,
): { totalCents: number; atListCents: number; discountCents: number } {
  const totalCents = rows.reduce((s, r) => s + lineCents(r.item, r.line), 0);
  const atListCents = rows.reduce((s, r) => s + lineAtListCents(r.item, r.line), 0);
  return { totalCents, atListCents, discountCents: Math.max(0, atListCents - totalCents) };
}
