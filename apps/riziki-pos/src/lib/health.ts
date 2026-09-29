/**
 * Things worth a second look.
 *
 * WHY THIS EXISTS. The shop found a day that made no sense, and working out why
 * took an export, a spreadsheet and somebody who knew what to compare against
 * what. The errors behind it were all the same shape — a quantity or a
 * container size typed wrong on a delivery — and not one of them announced
 * itself. A cost price is just a number; nothing about 2,000 a kilo looks
 * wrong until you know the next drum came in at 132.
 *
 * So the comparisons are in the app now, and the shop can run them. Nothing
 * here is clever: each check is a question somebody would ask if they had the
 * time to look, asked of every row instead of the one that happened to be on
 * screen.
 *
 * WHAT IT IS CAREFUL NOT TO DO. It never changes anything, and it never says
 * something IS wrong — it says it is worth checking, because the shop has the
 * delivery note and this does not. A 0.42 kg delivery of EDTA is bizarre and
 * might be a genuine sample. The judgement stays with the person holding the
 * paper.
 */

import { all, get } from "./db.ts";
import { currentVersion, scaleFormula } from "./production.ts";
import { stockSource } from "./mixing.ts";

const MILLI = 1000;

/**
 * How much a delivery has to be over the asking price before it is worth
 * saying. Two thousand shillings is about the smallest errand the shop would
 * thank you for; below it the check would be reporting rounding.
 */
const OVER_PAID_FLOOR_CENTS = 200_000;

/**
 * How far under cost a product has to have been sold, across the whole month,
 * before it is worth an errand.
 *
 * A hundred shillings, which sounds low until you run it over a real month:
 * September had exactly two products sold under cost at all, and only one of
 * them over a hundred. This check is not sifting a pile — it is finding the one
 * line in eighteen hundred where somebody typed the 500 ml price against a full
 * litre. Set higher it finds nothing; set at zero it starts reporting rounding.
 */
const UNDERCHARGE_FLOOR_CENTS = 10_000;

export type Severity = "high" | "medium" | "low";

export interface Finding {
  /** Stable, so a screen can key rows and a person can refer to one. */
  id: string;
  severity: Severity;
  /** What kind of thing this is, for grouping. */
  kind: string;
  title: string;
  /** What was seen, in figures. */
  detail: string;
  /** What to do about it, where there is a clear answer. */
  fix?: string;
  href?: string;
  /** The product this is about, where it is about exactly one. */
  item?: number;
}

const kes = (cents: number) =>
  "KES " + (cents / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const qty = (milli: number, unit: string) =>
  `${(milli / MILLI).toLocaleString("en-KE", { maximumFractionDigits: 3 })} ${unit}`;

/** The order a person would want to be told, worst first. */
const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

// ------------------------------------------------------- price against cost

/**
 * Sold for at or under what it costs.
 *
 * The plainest loss there is, and invisible on every screen that shows one
 * number or the other but never both.
 */
function pricedUnderCost(): Finding[] {
  return all<{
    id: number;
    name: string;
    price_cents: number;
    cost_cents: number;
    canonical_unit: string;
  }>(
    `SELECT id, name, price_cents, cost_cents, canonical_unit
       FROM items
      WHERE active = 1 AND sellable = 1 AND price_cents > 0 AND cost_cents >= price_cents
      ORDER BY (cost_cents - price_cents) DESC`,
  ).map((i) => ({
    id: `under-cost:${i.id}`,
    severity: "high" as const,
    kind: "Priced under cost",
    title: `${i.name} costs more than it is sold for`,
    detail:
      `Asking ${kes(i.price_cents)} a ${i.canonical_unit}, costed at ${kes(i.cost_cents)} — ` +
      `losing ${kes(i.cost_cents - i.price_cents)} every ${i.canonical_unit} sold.`,
    fix: "Either the price is too low or the cost on file is wrong. Check the last delivery before moving the price.",
    href: `/stock/${i.id}`,
  }));
}

/** On the shelf and for sale, with no price on it. It cannot be sold. */
function notPriced(): Finding[] {
  return all<{ id: number; name: string }>(
    `SELECT id, name FROM items
      WHERE active = 1 AND sellable = 1 AND price_cents = 0
      ORDER BY name`,
  ).map((i) => ({
    id: `no-price:${i.id}`,
    severity: "medium" as const,
    kind: "Not priced",
    title: `${i.name} has no price`,
    detail: "It is on the sellable list with nothing to charge for it.",
    fix: "Set a price under Products and prices, or mark it not for sale.",
    href: "/items",
  }));
}

/**
 * Held in quantity with no cost at all.
 *
 * Everything sold from it counts as pure profit, which it is not — and the day
 * it is finally costed, every one of those sales is re-valued at once.
 */
function heldWithNoCost(): Finding[] {
  return all<{ id: number; name: string; held: number; unit: string }>(
    `SELECT i.id, i.name, i.canonical_unit AS unit,
            COALESCE((SELECT SUM(m.delta_milli) FROM stock_movements m WHERE m.item_id = i.id), 0) AS held
       FROM items i
      WHERE i.active = 1 AND i.cost_cents = 0
      ORDER BY held DESC`,
  )
    .filter((i) => i.held > 0)
    .map((i) => ({
      id: `no-cost:${i.id}`,
      severity: "medium" as const,
      kind: "No cost on file",
      title: `${i.name} is on the shelf with no cost`,
      detail: `${qty(i.held, i.unit)} held, costed at nothing. Anything sold from it reads as pure profit.`,
      fix: "Record what the last delivery cost, under Suppliers and purchases.",
      href: `/stock/${i.id}`,
    }));
}

/**
 * Sold further than it ever arrived.
 *
 * WHY IT IS NOT ENOUGH to leave this to the counter's own stock warning. That
 * warning fires at the moment of the sale, to somebody with a customer in front
 * of them and a good reason to carry on — the drum IS in the store, the delivery
 * simply has not been typed in yet. Which is fine, and the shop allows it on
 * purpose. What is not fine is that nobody ever comes back.
 *
 * "Ocean breeze mild" was sold nine times over a fortnight and never once
 * delivered against, because a second product of the same name — spelled with a
 * zero for the O — was holding every litre. Nothing said so. The shelf said
 * minus four and a half litres, and because the product also had no cost, all
 * 1,800 shillings of it was booked as pure profit.
 *
 * So a count below zero is reported as what it is: a sale that has been made
 * out of stock the books have never seen.
 */
function soldBelowZero(): Finding[] {
  return all<{ id: number; name: string; held: number; unit: string; arrivals: number }>(
    `SELECT i.id, i.name, i.canonical_unit AS unit,
            COALESCE((SELECT SUM(m.delta_milli) FROM stock_movements m WHERE m.item_id = i.id), 0) AS held,
            (SELECT COUNT(*) FROM purchase_lines pl WHERE pl.item_id = i.id) AS arrivals
       FROM items i
      WHERE i.active = 1
      ORDER BY held ASC`,
  )
    .filter((i) => i.held < 0)
    .map((i) => ({
      id: `below-zero:${i.id}`,
      severity: "high" as const,
      kind: "Sold below zero",
      title: `${i.name} is ${qty(-i.held, i.unit)} short on the shelf`,
      detail: i.arrivals
        ? `More has been sold than has ever been delivered. Either a delivery was never ` +
          `typed in, or it went in against a different product of nearly the same name.`
        : `More has been sold than has ever been delivered, and there is no delivery ` +
          `against this product at all — not one. Whatever is being sold, the stock for it ` +
          `is sitting somewhere else.`,
      fix: "Find the delivery. If it went in against another product, move the stock with a stock take and retire the one that is not used.",
      href: `/stock/${i.id}`,
    }));
}

/**
 * Two products the same name would reach.
 *
 * A zero for an O is invisible on a screen and invisible in a search box, and
 * it splits a product in two: the deliveries land on one, the sales come off
 * the other, and both halves lie — one holds stock it never sells, the other
 * sells stock it never had. The shop has no way to see it, because the two rows
 * read identically.
 *
 * Only the characters that are genuinely confusable are folded — a zero for an
 * O, a one for an l — so HYPOCHLORITE (10%) and HYPOCHLORITE (12%) stay the two
 * different chemicals they are.
 */
function twinNames(): Finding[] {
  const rows = all<{ id: number; name: string; held: number; unit: string }>(
    `SELECT i.id, i.name, i.canonical_unit AS unit,
            COALESCE((SELECT SUM(m.delta_milli) FROM stock_movements m WHERE m.item_id = i.id), 0) AS held
       FROM items i WHERE i.active = 1 ORDER BY i.id`,
  );

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = r.name.toLowerCase().replace(/0/g, "o").replace(/1/g, "l").replace(/\s+/g, " ").trim();
    const found = groups.get(key);
    if (found) found.push(r);
    else groups.set(key, [r]);
  }

  const out: Finding[] = [];
  for (const twins of groups.values()) {
    if (twins.length < 2) continue;
    const [first] = twins;
    out.push({
      id: `twin:${first.id}`,
      severity: "high",
      kind: "Two products, one name",
      title: `${twins.length} products are called ${first.name}`,
      detail:
        `Nothing on any screen tells them apart: ` +
        twins.map((t) => `"${t.name}" holding ${qty(t.held, t.unit)}`).join(", ") +
        `. Deliveries go in against one and sales come off the other, so one runs ` +
        `below zero while the other never moves.`,
      fix: "Keep the one that is spelled right, move the stock onto it with a stock take, and mark the other not for sale.",
      href: `/stock/${first.id}`,
    });
  }
  return out;
}

/**
 * A size sold for less than the chemical inside it costs.
 *
 * THE GAP THIS CLOSES. "Priced under cost" reads an item's own price against
 * its own cost, which is right for a kilogramme of chlorine — the shop asks 350
 * and pays 255 and nothing is wrong. It cannot see a BUNDLE, because a bundle
 * is a price on the parent and carries no cost of its own. A 45 kg drum of that
 * same chlorine was on the till at 7,000, which is 155 a kilo, and it went out
 * three times over six days before anybody noticed.
 *
 * Both kinds are checked, because both can be wrong the same way. An item
 * bundle is a size of something on the shelf, so its contents cost the item's
 * cost times the size. A formula bundle is a size of something mixed to order,
 * so its contents cost whatever the recipe takes — the same arithmetic the
 * mixing board does, borrowed rather than rewritten so the two cannot drift.
 *
 * Silent where it cannot know: a bundle whose parent has no cost yet, or a
 * recipe with an ingredient nothing is stocked for, is not evidence of anything.
 */
export function bundleUnderContents(): Finding[] {
  const out: Finding[] = [];

  for (const b of all<{
    id: number;
    item_id: number;
    name: string;
    unit: string;
    size_milli: number;
    price_cents: number;
    cost_cents: number;
  }>(
    `SELECT b.id, b.size_milli, b.price_cents,
            i.id AS item_id, i.name, i.canonical_unit AS unit, i.cost_cents
       FROM bundles b
       JOIN items i ON i.id = b.item_id
      WHERE b.active = 1 AND i.active = 1 AND b.price_cents > 0 AND i.cost_cents > 0`,
  )) {
    const inside = Math.round((b.cost_cents * b.size_milli) / MILLI);
    if (b.price_cents > inside) continue;
    out.push({
      id: `bundle:${b.id}`,
      severity: "high",
      kind: "Sold for less than it holds",
      title: `${b.name} — ${qty(b.size_milli, b.unit)} is on the till at ${kes(b.price_cents)}`,
      detail:
        `The ${qty(b.size_milli, b.unit)} inside it cost ${kes(inside)} at ${kes(b.cost_cents)} a ` +
        `${b.unit}, so every one sold loses ${kes(inside - b.price_cents)}. Loose, the shop ` +
        `charges ${kes(Math.round((priceOfItem(b.item_id) * b.size_milli) / MILLI))} for the same amount.`,
      fix: "Fix the price on this size under Products and prices. Until it is changed, the next person to tap it sells another one.",
      href: `/items/${b.item_id}`,
      item: b.item_id,
    });
  }

  for (const b of all<{
    id: number;
    formula_id: number;
    name: string;
    size_milli: number;
    price_cents: number;
  }>(
    `SELECT b.id, b.size_milli, b.price_cents, f.id AS formula_id, f.name
       FROM bundles b
       JOIN formulas f ON f.id = b.formula_id
      WHERE b.active = 1 AND b.price_cents > 0`,
  )) {
    const version = currentVersion(b.formula_id);
    if (!version) continue;

    let inside = 0;
    let known = true;
    for (const line of scaleFormula(version.id, b.size_milli)) {
      const source = stockSource(line.chemicalId);
      if (!source || source.cost_cents === 0) {
        known = false;
        break;
      }
      inside += Math.round((source.cost_cents * line.neededMilli) / MILLI);
    }
    if (!known || inside === 0 || b.price_cents > inside) continue;

    out.push({
      id: `bundle:${b.id}`,
      severity: "high",
      kind: "Sold for less than it holds",
      title: `${b.name} — ${qty(b.size_milli, version.ref_unit)} is on the till at ${kes(b.price_cents)}`,
      detail:
        `The chemicals the recipe takes for that size cost ${kes(inside)}, so every one mixed ` +
        `loses ${kes(inside - b.price_cents)} before anybody is paid for mixing it.`,
      fix: "Either the size's price is too low or an ingredient's cost is wrong. Check the last delivery of each ingredient before moving the price.",
      href: `/formulas/${b.formula_id}`,
    });
  }

  return out;
}

/** What the shop asks for one kg / L / pcs of an item, for comparing against. */
function priceOfItem(itemId: number): number {
  return get<{ price_cents: number }>(`SELECT price_cents FROM items WHERE id = ?`, itemId)?.price_cents ?? 0;
}

/**
 * Charged less at the counter than the thing cost.
 *
 * EVERY CHECK ABOVE READS THE PRICE LIST. None of them reads what was actually
 * taken. A price list can be perfect and the shop still lose money, because the
 * figure on the till is a starting point and the counter may type over it — for
 * a friend, for a wholesale customer, or by accident. A litre of Peach mild
 * went out at 300 on a day it cost 450, because somebody charged the 500 ml
 * price for a full litre. Nothing said a word.
 *
 * Grouped per product rather than per sale, because one row per discount would
 * bury the screen, and because the pattern is the useful part: once is a
 * customer, nine times is a price that needs changing.
 *
 * It says nothing about a product whose COST is already known to be wrong —
 * that finding is above, and this one would only be the same mistake seen from
 * the other side.
 */
export function chargedUnderCost(sinceDays = 30): Finding[] {
  return all<{
    item_id: number;
    name: string;
    times: number;
    short_cents: number;
    took_cents: number;
  }>(
    `SELECT l.item_id,
            i.name,
            COUNT(*) AS times,
            SUM(l.cost_cents - l.line_total_cents) AS short_cents,
            SUM(l.line_total_cents) AS took_cents
       FROM sale_lines l
       JOIN sales s ON s.id = l.sale_id
       JOIN items i ON i.id = l.item_id
      WHERE s.voided_at IS NULL
        AND l.line_total_cents > 0
        AND l.cost_cents > l.line_total_cents
        AND i.active = 1
        AND i.price_cents > i.cost_cents
        AND s.at >= datetime('now', ?)
      GROUP BY l.item_id
      ORDER BY short_cents DESC`,
    `-${Math.max(1, Math.round(sinceDays))} days`,
  )
    .filter((r) => r.short_cents >= UNDERCHARGE_FLOOR_CENTS)
    .map((r) => ({
      id: `charged:${r.item_id}`,
      severity: "medium" as const,
      kind: "Charged under cost",
      title:
        r.times === 1
          ? `${r.name} was sold once below what it cost`
          : `${r.name} was sold below cost ${r.times} times`,
      detail:
        `${kes(r.took_cents)} was taken for goods that cost ${kes(r.took_cents + r.short_cents)} — ` +
        `${kes(r.short_cents)} short. The price on the list is above cost, so this was typed over ` +
        `at the counter.`,
      fix: "Look at the sales on the product's own screen. A one-off is a customer; a habit is a price the counter does not believe.",
      href: `/stock/${r.item_id}`,
      item: r.item_id,
    }));
}

// --------------------------------------------------------- the deliveries

interface LineRow {
  line_id: number;
  purchase_id: number;
  item_id: number;
  item: string;
  unit: string;
  usual_size: number;
  at: string;
  units: number;
  size_milli: number;
  qty_milli: number;
  cost_cents: number;
}

function deliveryLines(): LineRow[] {
  return all<LineRow>(
    `SELECT pl.id AS line_id, pl.purchase_id, pl.item_id,
            i.name AS item, i.canonical_unit AS unit, i.size_milli AS usual_size,
            p.at, pl.units, pl.size_milli, pl.qty_milli, pl.cost_cents
       FROM purchase_lines pl
       JOIN purchases p ON p.id = pl.purchase_id
       JOIN items i ON i.id = pl.item_id
      ORDER BY pl.item_id, p.at`,
  );
}

const rateOf = (l: LineRow) => (l.qty_milli > 0 ? (l.cost_cents * MILLI) / l.qty_milli : 0);
const day = (at: string) => at.slice(0, 10);

/**
 * A delivery that landed at far more than the thing is sold for.
 *
 * THE STRONGEST CHECK HERE, and the one that needs no neighbours. Comparing an
 * item's deliveries against each other cannot see a mistake on an item bought
 * once; comparing against the asking price can, because the shop always knows
 * what it charges. BLUE landing at 2,000 a kilo against a 250 asking price is
 * not a judgement call.
 *
 * The bar is one and a half times the price rather than merely above it: a
 * genuinely thin margin is the shop's business and this must not nag about it.
 */
export function landedAbovePrice(lines: LineRow[]): Finding[] {
  return all<{ id: number; price_cents: number }>(
    `SELECT id, price_cents FROM items WHERE price_cents > 0`,
  ).flatMap((item) =>
    lines
      .filter((l) => l.item_id === item.id && rateOf(l) >= item.price_cents * 1.5)
      .map((l) => {
        const rate = Math.round(rateOf(l));
        return {
          id: `overprice:${l.line_id}`,
          severity: "high" as const,
          kind: "Delivery dearer than the selling price",
          title: `${l.item} on ${day(l.at)} landed at ${kes(rate)} a ${l.unit}`,
          detail:
            `The shop asks ${kes(item.price_cents)} a ${l.unit} for it — this delivery cost ` +
            `${(rate / item.price_cents).toFixed(1)} times that. ${l.units} × ` +
            `${qty(l.size_milli || Math.round(l.qty_milli / Math.max(1, l.units)), l.unit)} for ` +
            `${kes(l.cost_cents)}.`,
          fix: "Check the delivery note against the quantity and the total. A wrong container size or a missing zero both land here.",
          href: "/purchases",
        };
      }),
  );
}

/**
 * A delivery bought for more than the shop charges for it.
 *
 * WHY THIS IS SEPARATE from the check above. That one is looking for a typing
 * mistake and so it waits until a delivery is half again the asking price;
 * below that bar it keeps quiet, because a thin margin is the shop's business
 * and a check that nags about thin margins stops being read.
 *
 * But there is a line beneath a thin margin, and it is not a judgement call:
 * paying MORE for a drum than you sell it for. UNGEROL is a third of this
 * shop's turnover, it asks 395 a kilo, and on 18 September 1,125 kg of it
 * landed at 450 — under the other check's bar at 1.14 times the price, so
 * nothing was said, and it dragged the average cost of every kilo on the shelf
 * above the asking price for the next six days. The day the shop asked about
 * was one of those six.
 *
 * So this says nothing about margin and only ever fires above the price — and
 * only when the money at stake is worth an errand, because a 0.42 kg sample
 * bought dear is not news. What it reports is the shillings, not the ratio:
 * "55 a kilo over, 1,125 kg, 61,875 down" is a sentence somebody can act on.
 */
export function boughtAboveShelf(lines: LineRow[]): Finding[] {
  return all<{ id: number; price_cents: number }>(
    `SELECT id, price_cents FROM items WHERE price_cents > 0`,
  ).flatMap((item) =>
    lines
      .filter((l) => {
        const rate = rateOf(l);
        // Above the asking price, but under the other check's bar, which has
        // already spoken for anything dearer than that.
        return rate > item.price_cents && rate < item.price_cents * 1.5 && l.item_id === item.id;
      })
      .map((l) => {
        const rate = Math.round(rateOf(l));
        const over = rate - item.price_cents;
        const bleed = Math.round((over * l.qty_milli) / MILLI);
        return { l, rate, over, bleed };
      })
      .filter((x) => x.bleed >= OVER_PAID_FLOOR_CENTS)
      .map(({ l, rate, over, bleed }) => ({
        id: `dear:${l.line_id}`,
        severity: "high" as const,
        kind: "Bought for more than it sells for",
        title: `${l.item} on ${day(l.at)} landed at ${kes(rate)} a ${l.unit}`,
        detail:
          `The shop asks ${kes(item.price_cents)} a ${l.unit} — this delivery is ` +
          `${kes(over)} a ${l.unit} over it. ${qty(l.qty_milli, l.unit)} came in, ` +
          `so ${kes(bleed)} is lost if it all sells at the asking price. It also pulls the ` +
          `average cost of the stock already on the shelf up with it.`,
        fix: "Check the delivery note. If the price is right, the asking price has to move before this drum is sold.",
        href: `/stock/${l.item_id}`,
      })),
  );
}

/**
 * A delivery that landed at a rate nothing like the others of the same thing.
 *
 * NEEDS THREE. With two deliveries there is no way to tell from the figures
 * alone which of them is the odd one, and this used to guess — it took the
 * larger of two as the middle and then accused the cheaper, correct delivery of
 * being wrong. Being confidently wrong is worse than being silent, so with
 * fewer than three it says nothing and leaves the job to the price check above,
 * which needs no neighbours.
 */
export function rateOutliers(lines: LineRow[]): Finding[] {
  const byItem = new Map<number, LineRow[]>();
  for (const l of lines) {
    const list = byItem.get(l.item_id);
    if (list) list.push(l);
    else byItem.set(l.item_id, [l]);
  }

  const out: Finding[] = [];
  for (const rows of byItem.values()) {
    const rates = rows.map(rateOf).filter((r) => r > 0);
    if (rates.length < 3) continue;

    const sorted = [...rates].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    const median =
      sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    if (!median) continue;

    for (const l of rows) {
      const r = rateOf(l);
      if (!r) continue;
      const ratio = r > median ? r / median : median / r;
      if (ratio < 3) continue;
      out.push({
        id: `rate:${l.line_id}`,
        severity: "high",
        kind: "Delivery priced unlike the others",
        title: `${l.item} on ${day(l.at)} landed at ${kes(Math.round(r))} a ${l.unit}`,
        detail:
          `The other deliveries of it are around ${kes(Math.round(median))} — this one is ` +
          `${ratio.toFixed(1)} times ${r > median ? "dearer" : "cheaper"}. ` +
          `${l.units} × ${qty(l.size_milli || Math.round(l.qty_milli / Math.max(1, l.units)), l.unit)} ` +
          `for ${kes(l.cost_cents)}.`,
        fix: "Check the delivery note. A wrong container size or a missing zero both land here.",
        href: "/purchases",
      });
    }
  }
  return out;
}

/**
 * A delivery whose containers are nothing like the size that thing comes in.
 *
 * This is the check that catches what comparing deliveries against each other
 * cannot: an item bought once, entered wrong, with nothing to compare against.
 * 0.42 kg of EDTA against a usual 5 kg is the shape of it.
 */
export function oddContainers(lines: LineRow[]): Finding[] {
  const out: Finding[] = [];
  for (const l of lines) {
    const each = l.size_milli > 0 ? l.size_milli : Math.round(l.qty_milli / Math.max(1, l.units));
    if (!each || !l.usual_size) continue;
    const ratio = each > l.usual_size ? each / l.usual_size : l.usual_size / each;
    if (ratio < 10) continue;
    out.push({
      id: `size:${l.line_id}`,
      severity: "high",
      kind: "Container size unlike the usual",
      title: `${l.item} on ${day(l.at)} came in ${qty(each, l.unit)} containers`,
      detail:
        `It is normally ${qty(l.usual_size, l.unit)} — this is ${ratio.toFixed(0)} times ` +
        `${each > l.usual_size ? "bigger" : "smaller"}, so ${l.units} of them booked ` +
        `${qty(l.qty_milli, l.unit)} at ${kes(Math.round(rateOf(l)))} a ${l.unit}.`,
      fix: "If the size is wrong, both the stock and the cost are wrong. Correct the delivery rather than adjusting the price.",
      href: "/purchases",
    });
  }
  return out;
}

/** Goods booked in with no money against them. */
export function freeDeliveries(lines: LineRow[]): Finding[] {
  return lines
    .filter((l) => l.cost_cents === 0 && l.qty_milli > 0)
    .map((l) => ({
      id: `free:${l.line_id}`,
      severity: "medium" as const,
      kind: "Delivery with no cost",
      title: `${l.item} on ${day(l.at)} was booked in at nothing`,
      detail: `${qty(l.qty_milli, l.unit)} arrived with no price against it.`,
      fix: "If the invoice came later, correct the delivery — everything sold from it meanwhile is costed at today's price.",
      href: "/purchases",
    }));
}

// ------------------------------------------------------------- the sales

/**
 * Sales carrying no cost of their own.
 *
 * These are the ones that move when a cost price is touched — the only route by
 * which a day already closed can change. Worth knowing how much of the book is
 * in that state.
 */
function uncostedSales(): Finding[] {
  const row = get<{ n: number; total: number; oldest: string | null }>(
    `SELECT COUNT(*) AS n,
            COALESCE(SUM(sl.line_total_cents), 0) AS total,
            MIN(date(s.at, '+3 hours')) AS oldest
       FROM sale_lines sl
       JOIN sales s ON s.id = sl.sale_id
       JOIN items i ON i.id = sl.item_id
      WHERE s.status = 'completed' AND sl.cost_cents = 0 AND sl.line_total_cents > 0`,
  );
  if (!row?.n) return [];
  return [
    {
      id: "uncosted-sales",
      severity: "medium",
      kind: "Sales with no cost of their own",
      title: `${row.n} sale line${row.n === 1 ? "" : "s"} are valued at today's cost price`,
      detail:
        `${kes(row.total)} of sales, the oldest on ${row.oldest}, carry no cost of their own — ` +
        `they were rung up before one was recorded. The reports value them at what those ` +
        `products cost today, so changing a cost moves those past days.`,
      fix: "Put the right cost on the deliveries behind them and the figures settle.",
      href: "/landed",
    },
  ];
}

// ---------------------------------------------------------------- the sweep

export interface HealthReport {
  findings: Finding[];
  counts: Record<Severity, number>;
  /** How many things were looked at, so "nothing found" means something. */
  checked: { items: number; deliveries: number };
}

export function checkBooks(): HealthReport {
  const lines = deliveryLines();

  const findings = [
    ...pricedUnderCost(),
    ...bundleUnderContents(),
    ...chargedUnderCost(),
    ...oddContainers(lines),
    ...landedAbovePrice(lines),
    ...boughtAboveShelf(lines),
    ...rateOutliers(lines),
    ...notPriced(),
    ...heldWithNoCost(),
    ...soldBelowZero(),
    ...twinNames(),
    ...freeDeliveries(lines),
    ...uncostedSales(),
  ];

  /*
    One row per thing, not one per check.

    A delivery with the wrong container size also lands at the wrong rate, so it
    trips two checks — and telling somebody twice about one mistake makes the
    list look worse than the shop is, which is how a list like this stops being
    read. The more specific finding wins: the size is the cause, the rate is the
    symptom.
  */
  /*
    The checks are listed cause-first — a wrong container size explains a wrong
    rate and a rate above the selling price — so the first finding about a
    delivery line is the most specific one, and later ones about the same line
    are the same mistake seen again.
  */
  const spokenFor = new Set<number>();
  const deduped: Finding[] = [];
  for (const f of findings) {
    const m = /^(?:size|overprice|dear|rate|free):(\d+)$/.exec(f.id);
    if (m) {
      const line = Number(m[1]);
      if (spokenFor.has(line)) continue;
      spokenFor.add(line);
    }
    deduped.push(f);
  }

  /*
    A wrong bundle price and the sale it produced are one mistake.

    "Sold for less than it holds" is the trap — a size sitting on the till at a
    price nobody will question. "Charged under cost" is what happened when
    somebody tapped it. Listing both makes the screen say twice what it means
    once, and the trap is the row worth acting on: changing the price is what
    stops the next one.
  */
  const trapped = new Set(
    deduped.filter((f) => f.id.startsWith("bundle:") && f.item).map((f) => f.item!),
  );
  const final = deduped.filter((f) => !(f.id.startsWith("charged:") && f.item && trapped.has(f.item)));

  final.sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.kind.localeCompare(b.kind));

  const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
  for (const f of final) counts[f.severity]++;

  return {
    findings: final,
    counts,
    checked: {
      items: get<{ n: number }>(`SELECT COUNT(*) AS n FROM items WHERE active = 1`)?.n ?? 0,
      deliveries: lines.length,
    },
  };
}
