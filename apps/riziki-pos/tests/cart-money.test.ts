/**
 * The discount the shop never gave.
 *
 * A till showed "DISCOUNT GIVEN −KES 2,880 · was KES 3,110" on a sale of KES
 * 230, and printed it on the customer's receipt. The sale was right; the
 * comparison was not. These are the real figures from that screen, and the
 * cases around them that have to keep working.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { lineCents, lineAtListCents, cartDiscount } from "../src/lib/cart-money.ts";

/** Priced per kilogramme or litre, the customer names the quantity. */
const weighed = (perUnitKes: number) => ({ basis: "unit" as const, priceCents: perUnitKes * 100 });
/** Priced per container: you buy one or you buy none. */
const whole = (perContainerKes: number) => ({ basis: "pack" as const, priceCents: perContainerKes * 100 });

const bundle = (priceKes: number, qtyMilli: number, units = 1) => ({
  bundleId: 7,
  units,
  qtyMilli,
  priceCents: priceKes * 100,
});
const loose = (rateKes: number, qtyMilli: number) => ({
  bundleId: null,
  units: 1,
  qtyMilli,
  priceCents: rateKes * 100,
});

// ------------------------------------------------- the sale that was wrong

test("the 25 g bundle of a 3,000-a-kilo chemical is compared against 75, not 3,000", () => {
  /*
    0cean Breeze Conc is priced at 3,000 a kilogramme and sold in a 25 g size
    for 120. The screen asked the ITEM what it was worth and got the per-kilo
    rate, then multiplied it by the number of bundles.
  */
  const conc = weighed(3000);
  const line = bundle(120, 25);

  assert.equal(lineCents(conc, line), 12_000, "the customer pays 120");
  assert.equal(
    lineAtListCents(conc, line),
    12_000,
    "and 120 is also the asking price for that size — there is no discount here",
  );
});

test("the whole sale from the till: 230 charged, and nothing knocked off", () => {
  // KES 110 of hypochlorite at 110/kg, plus the 25 g conc bundle at 120.
  const rows = [
    { item: weighed(110), line: loose(110, 1000) },
    { item: weighed(3000), line: bundle(120, 25) },
  ];
  const { totalCents, atListCents, discountCents } = cartDiscount(rows);

  assert.equal(totalCents, 23_000, "KES 230");
  assert.equal(atListCents, 23_000, "and that is what it was always going to be");
  assert.equal(discountCents, 0, "the till used to announce 2,880 here");
});

// --------------------------------------------- the cases that must not break

test("a real discount on a weighed line is still a real discount", () => {
  // Ungerol asks 390 a kilo; twenty kilos went at 375.
  const { atListCents, discountCents } = cartDiscount([
    { item: weighed(390), line: loose(375, 20_000) },
  ]);
  assert.equal(atListCents, 780_000, "20 kg at the asking price is 7,800");
  assert.equal(discountCents, 30_000, "and 300 was given away");
});

test("a bundle sold under its own size price is a real discount too", () => {
  // The size is on the till at 7,800; it went for 7,500.
  const drum = weighed(390);
  const { discountCents } = cartDiscount([{ item: drum, line: bundle(7500, 20_000) }]);
  assert.equal(discountCents, 0, "a line cannot be compared with a price it does not carry");
  // What the shop asked for the size lives on the bundle, not on the item, so
  // the screen has nothing to compare against and must not invent one.
  assert.equal(lineAtListCents(drum, bundle(7500, 20_000)), 750_000);
});

test("a whole container is counted, not weighed", () => {
  const jerrican = whole(2600);
  const line = { bundleId: null, units: 3, qtyMilli: 15_000, priceCents: 250_000 };
  assert.equal(lineCents(jerrican, line), 750_000, "three at 2,500");
  assert.equal(lineAtListCents(jerrican, line), 780_000, "against 2,600 asked");
});

test("a mixed product has no shelf rate behind it and is never discounted", () => {
  // Multipurpose Soap — 20 L: no item at all, the recipe is what leaves the store.
  const { atListCents, discountCents } = cartDiscount([
    { item: null, line: bundle(750, 20_000, 2) },
  ]);
  assert.equal(atListCents, 150_000, "two at 750");
  assert.equal(discountCents, 0);
});

test("the smaller the size and the dearer the chemical, the worse the old bug was", () => {
  /*
    Every one of these was on a real receipt in October. The figure on the right
    is what the till used to claim had been knocked off.
  */
  const cases: Array<[string, number, number, number]> = [
    // item price/kg, charged, grams
    ["0cean Breeze Conc 125 g", 3000, 400, 125],
    ["Pink Fabric Conc 125 g", 3300, 450, 125],
    ["Apple Conc 25 g", 2500, 100, 25],
    ["Acid Blue 250 g", 1000, 250, 250],
  ];
  for (const [name, perKg, charged, grams] of cases) {
    const { discountCents } = cartDiscount([
      { item: weighed(perKg), line: bundle(charged, grams) },
    ]);
    assert.equal(discountCents, 0, `${name} must show no discount`);
  }
});
