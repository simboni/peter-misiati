/**
 * The checks that would have found it.
 *
 * The shop hit a day that made no sense and working out why took an export, a
 * spreadsheet and somebody who knew what to compare against what. Every error
 * behind it was the same shape — a quantity or a container size typed wrong on
 * a delivery — and not one announced itself. A cost price is just a number;
 * nothing about 2,000 a kilo looks wrong until you know the next drum came in
 * at 132.
 *
 * So these are written from the real errors, with the real figures. If a check
 * stops catching the thing it was built for, that is what fails here.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "riziki-health-")), "test.db");

import test from "node:test";
import assert from "node:assert/strict";

const { seed } = await import("../src/lib/seed.ts");
const { get, all, run, stockOf, postMovement } = await import("../src/lib/db.ts");
const { createSupplier, recordPurchase } = await import("../src/lib/purchasing.ts");
const { checkBooks } = await import("../src/lib/health.ts");
const { createFormula, currentVersion } = await import("../src/lib/production.ts");

seed();
for (const it of all<{ id: number }>(`SELECT id FROM items WHERE active = 1`)) {
  const q = stockOf(it.id);
  if (q !== 0) postMovement({ itemId: it.id, deltaMilli: -q, reason: "stocktake", userId: 1 });
  run(`UPDATE items SET cost_cents = 0 WHERE id = ?`, it.id);
}
const supplier = createSupplier({ name: "Chemi Traders Ltd" }, 1);

/** A product of our own, so the figures below are exactly the shop's. */
function product(name: string, unit: "kg" | "L" | "pcs", usualSizeKg: number, priceKes: number) {
  run(
    `INSERT INTO items (chemical_id, name, kind, canonical_unit, size_milli, unit_label,
                        sellable, price_basis, price_cents, cost_cents)
     VALUES (NULL, ?, 'bulk', ?, ?, 'drum', 1, 'unit', ?, 0)`,
    name,
    unit,
    Math.round(usualSizeKg * 1000),
    Math.round(priceKes * 100),
  );
  return get<{ id: number }>(`SELECT id FROM items WHERE name = ?`, name)!.id;
}

/** A delivery, in the shop's own terms: how many containers, how big, what it cost. */
function delivery(itemId: number, units: number, eachKg: number, totalKes: number, ref: string) {
  return recordPurchase({
    supplierId: supplier,
    ref,
    transportCents: 0,
    userId: 1,
    lines: [
      {
        itemId,
        units,
        sizeMilli: Math.round(eachKg * 1000),
        costCents: Math.round(totalKes * 100),
      },
    ],
  });
}

const titles = () => checkBooks().findings.map((f) => f.title);
const kinds = (needle: string) =>
  checkBooks().findings.filter((f) => f.title.includes(needle)).map((f) => f.kind);

// --------------------------------------------- the errors that were really there

test("BLUE: one delivery at fifteen times the rate of the other", () => {
  // 23 kg for 46,000 → 2,000/kg, against 51 kg for 6,760 → 132.55/kg.
  const blue = product("BLUE", "kg", 25, 250);
  delivery(blue, 1, 23, 46000, "INV-B1");
  delivery(blue, 1, 51, 6760, "INV-B2");

  /*
    Named by the price check, not by comparing the two deliveries: with only
    two there is no way to tell from the figures alone which is the odd one,
    and guessing got it backwards. The shop always knows what it charges.
  */
  const found = checkBooks().findings.filter((f) => f.title.startsWith("BLUE on"));
  assert.equal(found.length, 1, "one finding, about one delivery");
  assert.ok(found[0].title.includes("2,000.00"), "and it is the 2,000 a kilo one");
  assert.equal(found[0].kind, "Delivery dearer than the selling price");
});

test("AFRIC SALT: the container size typed as 5 kg instead of 50", () => {
  // 5 × 5 kg for 4,750 → 190/kg, where 5 × 50 kg → 19/kg.
  const salt = product("AFRIC SALT (SPECIAL)", "kg", 50, 25);
  delivery(salt, 5, 5, 4750, "INV-A1");
  delivery(salt, 1, 225, 4750, "INV-A2");
  delivery(salt, 10, 50, 9500, "INV-A3");

  assert.ok(
    kinds("AFRIC SALT").includes("Container size unlike the usual"),
    "a 5 kg container of something that comes in 50 is the finding",
  );
});

test("PURECARE SALT: a missing zero on the total", () => {
  // Three deliveries at 14.00/kg, then 500 kg for 700 instead of 7,000.
  const salt = product("PURECARE SALT", "kg", 50, 20);
  delivery(salt, 15, 50, 10500, "INV-P1");
  delivery(salt, 15, 50, 10500, "INV-P2");
  delivery(salt, 10, 50, 7000, "INV-P3");
  delivery(salt, 10, 50, 700, "INV-P4");

  assert.ok(
    titles().some((t) => t.startsWith("PURECARE SALT on") && t.includes("1.40")),
    "the tenth-of-the-price delivery is named",
  );
});

test("EDTA: bought once at 0.42 kg, with nothing to compare it against", () => {
  /*
    The check that earns its place. Comparing an item's deliveries against each
    other cannot see this one — there is only one delivery. What gives it away
    is the container: 0.42 kg of something that comes in 5 kg lots.
  */
  const edta = product("EDTA", "kg", 5, 700);
  delivery(edta, 1, 0.42, 600, "INV-E1");

  assert.ok(
    kinds("EDTA").includes("Container size unlike the usual"),
    "caught on the container, not on the rate",
  );
});

test("CITRIC ACID: priced at 50 and costing 330", () => {
  const acid = product("CITRIC ACID", "kg", 25, 50);
  delivery(acid, 1, 0.91, 300, "INV-C1");

  const found = checkBooks().findings.filter((f) => f.title.includes("CITRIC ACID"));
  assert.ok(
    found.some((f) => f.kind === "Priced under cost"),
    "the plainest loss there is, and invisible on any screen showing one number",
  );
});

// ------------------------------------------------- how it behaves as a list

test("one mistake is one row, not two", () => {
  /*
    A wrong container size also produces a wrong rate, so it trips both checks.
    Telling somebody twice about one mistake makes the list look worse than the
    shop is, which is how a list like this stops being read. The cause wins over
    the symptom.
  */
  // One finding about that delivery, not one per check it trips.
  const rows = checkBooks().findings.filter((f) => /AFRIC SALT \(SPECIAL\) on/.test(f.title));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "Container size unlike the usual");
});

test("the worst is first", () => {
  const order = checkBooks().findings.map((f) => f.severity);
  const rank = { high: 0, medium: 1, low: 2 };
  for (let i = 1; i < order.length; i++) {
    assert.ok(rank[order[i]] >= rank[order[i - 1]], "severity never goes back up the list");
  }
});

test("every finding says what was seen and where to put it right", () => {
  for (const f of checkBooks().findings) {
    assert.ok(f.title.length > 10, `${f.id} has no title`);
    assert.ok(f.detail.length > 20, `${f.id} says nothing about what was seen`);
    assert.ok(f.href, `${f.id} leads nowhere`);
  }
});

test("a delivery booked in at nothing is worth knowing about", () => {
  const free = product("OCEAN BREEZE MILD", "L", 20, 400);
  delivery(free, 1, 16.5, 0, "INV-F1");
  assert.ok(
    checkBooks().findings.some((f) => f.title.includes("OCEAN BREEZE MILD") && f.kind === "Delivery with no cost"),
  );
});

test("an ordinary shop produces an empty list", () => {
  // The check has to be able to say nothing is wrong, or it is just noise.
  const fine = product("PLAIN SOAP", "kg", 25, 200);
  delivery(fine, 4, 25, 10000, "INV-OK1");
  delivery(fine, 4, 25, 10400, "INV-OK2");

  assert.equal(
    checkBooks().findings.filter((f) => f.title.includes("PLAIN SOAP")).length,
    0,
    "two sensible deliveries of a sensibly priced thing raise nothing",
  );
});

// ------------------------------------- bought for more than it is sold for

/*
  The check the first version did not have, written from the delivery that cost
  the shop its worst day. Everything below is the real UNGEROL figures.
*/

test("UNGEROL: 1,125 kg at 450 against a 395 asking price", () => {
  const ungerol = product("UNGEROL", "kg", 170, 395);
  delivery(ungerol, 1, 170, 61200, "INV-U1"); // 360/kg, the ordinary one
  delivery(ungerol, 5, 225, 506250, "INV-U2"); // 450/kg

  const found = checkBooks().findings.filter((f) => f.title.startsWith("UNGEROL on"));
  assert.equal(found.length, 1, "the 450 delivery, and only that one");
  assert.equal(found[0].kind, "Bought for more than it sells for");
  assert.ok(found[0].detail.includes("55.00"), "says how much a kilo over it is");
  assert.ok(found[0].detail.includes("61,875.00"), "and what that is in shillings across the drum");
});

test("a thin margin is the shop's business and is not reported", () => {
  // 390 against a 395 price is 1.3% — the kind of week a chemicals shop has.
  const thin = product("THIN MARGIN SOAP", "kg", 200, 395);
  delivery(thin, 5, 200, 390000, "INV-T1");

  assert.equal(
    checkBooks().findings.filter((f) => f.title.includes("THIN MARGIN SOAP")).length,
    0,
    "under the asking price, however narrowly, says nothing",
  );
});

test("a small quantity bought dear is not an errand", () => {
  // 2 kg at 20 over the price is 40 shillings. Reporting it would be noise.
  // Sold in 1 kg tins, so the container check has nothing to say about it and
  // what is left is this check alone.
  const tiny = product("TINY OVERPAY", "kg", 1, 400);
  delivery(tiny, 2, 1, 840, "INV-Y1");

  assert.equal(
    checkBooks().findings.filter((f) => f.title.startsWith("TINY OVERPAY on")).length,
    0,
    "above the price but only by pocket change",
  );
});

test("a delivery half again the price is still the older, blunter finding", () => {
  // One mistake, one row: the 1.5× check speaks first and this one stays quiet.
  const wild = product("WILD RATE POWDER", "kg", 50, 100);
  delivery(wild, 10, 50, 400000, "INV-W1"); // 800/kg, eight times the price

  const found = checkBooks().findings.filter((f) => f.title.startsWith("WILD RATE POWDER on"));
  assert.equal(found.length, 1, "told once");
  assert.equal(found[0].kind, "Delivery dearer than the selling price");
});

// ------------------------------------------- one product wearing two names

/*
  The fortnight nobody noticed. "Ocean breeze mild" was sold nine times and
  never delivered against once, because a second product of the same name —
  spelled with a zero for the O — was holding every litre. The figures below
  are the shop's.
*/

test("Ocean breeze: the deliveries land on one spelling and the sales come off the other", () => {
  const zero = product("0cean breeze mild", "L", 5, 600); // a zero, not an O
  const oh = product("Ocean breeze mild", "L", 5, 600);
  delivery(zero, 1, 5.5, 2475, "INV-OB1");
  delivery(zero, 2, 5, 4500, "INV-OB2");
  // Every sale came off the other one, which never saw a drum.
  for (const litres of [0.5, 1, 1, 0.5, 0.25, 0.25, 1]) {
    postMovement({ itemId: oh, deltaMilli: -Math.round(litres * 1000), reason: "sale", userId: 1 });
  }

  const found = checkBooks().findings;

  const twin = found.find(
    (f) => f.kind === "Two products, one name" && f.detail.includes("0cean breeze mild"),
  );
  assert.ok(twin, "the two names are reported as one product wearing two");
  assert.ok(twin.detail.includes("Ocean breeze mild"), "and both spellings are quoted");

  const short = found.find((f) => f.kind === "Sold below zero" && f.title.startsWith("Ocean breeze mild"));
  assert.ok(short, "and the half that has gone below zero is named");
  assert.ok(short.title.includes("4.5 L"), `says how far short it is, got: ${short.title}`);
  assert.ok(short.detail.includes("not one"), "and that nothing was ever delivered against it");
});

test("two chemicals that differ by a digit are left alone", () => {
  /*
    The check folds a zero into an O and a one into an l, because those are the
    two that a person cannot see. It must not go further: 10% and 12% are
    different chemicals and the shop sells both.
  */
  const ten = product("HYPOCHLORITE (10%)", "kg", 23, 110);
  const twelve = product("HYPOCHLORITE (12%)", "kg", 24, 105);
  delivery(ten, 2, 23, 4150, "INV-H10");
  delivery(twelve, 1, 24, 2250, "INV-H12");

  assert.equal(
    checkBooks().findings.filter(
      (f) => f.kind === "Two products, one name" && f.title.includes("HYPOCHLORITE (1"),
    ).length,
    0,
    "10% and 12% are two chemicals, not one name typed twice",
  );
});

test("short on a product that HAS been delivered reads differently", () => {
  // The counter is allowed to sell past the book when the drum is in the store
  // and the delivery is not typed yet. What must not happen is nobody going back.
  const marina = product("MARINA SALT", "kg", 50, 20);
  delivery(marina, 10, 50, 6500, "INV-M1");
  postMovement({ itemId: marina, deltaMilli: -501_000, reason: "sale", userId: 1 });

  const short = checkBooks().findings.find(
    (f) => f.kind === "Sold below zero" && f.title.startsWith("MARINA SALT"),
  );
  assert.ok(short, "still reported");
  assert.ok(short.detail.includes("nearly the same name"), "but as a missing delivery, not a missing product");
  assert.ok(!short.detail.includes("not one"));
});

test("the twin check does not cry wolf across the whole catalogue", () => {
  /*
    Every other product this file has made, plus the shop's own starting
    catalogue, and the only pairs it may name are the ones that really are one
    product typed twice.
  */
  for (const f of checkBooks().findings.filter((f) => f.kind === "Two products, one name")) {
    assert.match(
      f.title,
      /(cean breeze mild|AFRIC SALT|BLUE|CAUSTIC SODA|CHLORINE|EDTA|FLAKES|HCL|MAGADI|MARINA SALT|PURECARE SALT|UFACID|UNGEROL|OCEAN BREEZE MILD|CITRIC ACID)/i,
      `unexpected pair: ${f.title} — ${f.detail}`,
    );
  }
});

// ------------------------- a size that costs more than it is sold for

/** A size of something on the shelf, at a price of its own. */
function bundle(itemId: number, sizeKg: number, priceKes: number) {
  run(
    `INSERT INTO bundles (item_id, size_milli, price_cents) VALUES (?, ?, ?)`,
    itemId,
    Math.round(sizeKg * 1000),
    Math.round(priceKes * 100),
  );
}

/** A completed sale of one line, with what was really charged and really cost. */
function sold(itemId: number, name: string, qtyKg: number, tookKes: number, costKes: number) {
  run(
    `INSERT INTO sales (client_uuid, at, total_cents, paid_cents)
     VALUES (?, datetime('now'), ?, ?)`,
    `t-${name}-${qtyKg}-${tookKes}`,
    Math.round(tookKes * 100),
    Math.round(tookKes * 100),
  );
  const sale = get<{ id: number }>(`SELECT MAX(id) AS id FROM sales`)!.id;
  run(
    `INSERT INTO sale_lines (sale_id, item_id, name_snapshot, units, qty_milli,
                             unit_price_cents, line_total_cents, cost_cents)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
    sale,
    itemId,
    name,
    Math.round(qtyKg * 1000),
    Math.round(tookKes * 100),
    Math.round(tookKes * 100),
    Math.round(costKes * 100),
  );
}

test("the chlorine drum: 45 kg on the till at 7,000 when the chlorine cost 11,500", () => {
  /*
    The real one. Loose chlorine asks 350 a kilo and costs 255.56, so every
    check that reads the price list says this product is fine. The 45 kg size
    was 7,000 — 155.56 a kilo — and it went out three times over six days.
  */
  const chlorine = product("CHLORINE", "kg", 45, 350);
  delivery(chlorine, 2, 45, 23000, "INV-CL1");
  bundle(chlorine, 45, 7000);

  const found = checkBooks().findings.filter((f) => f.kind === "Sold for less than it holds");
  assert.equal(found.length, 1, "one size, one finding");
  assert.ok(found[0].title.includes("CHLORINE"), found[0].title);
  assert.ok(found[0].detail.includes("11,500.20"), `says what is inside it: ${found[0].detail}`);
  assert.ok(found[0].detail.includes("4,500.20"), `and what each one loses: ${found[0].detail}`);
  assert.ok(found[0].detail.includes("15,750.00"), `and what loose would have fetched: ${found[0].detail}`);
});

test("a bulk discount is not a mistake and is left alone", () => {
  /*
    The whole point of a bundle is that it is cheaper per kilo than the counter
    price. A check that cannot tell a discount from a loss would be turned off
    within a week.
  */
  // Ungerol's own figures, under a name of its own: this file already has an
  // UNGEROL, carrying the 450 a kilo delivery that the check above is about.
  const ung = product("BULK DISCOUNT DRUM", "kg", 170, 395);
  delivery(ung, 2, 170, 124100, "INV-UG1"); // 365/kg
  bundle(ung, 20, 7800); // 390/kg — under the counter price, well over cost

  assert.equal(
    checkBooks().findings.filter(
      (f) => f.kind === "Sold for less than it holds" && f.title.includes("BULK DISCOUNT DRUM"),
    ).length,
    0,
    "390 a kilo against a 365 cost is a discount, not a loss",
  );
});

test("a bundle whose parent has no cost yet says nothing", () => {
  // Silence where it cannot know. A product never delivered against proves
  // nothing about its prices.
  const unknown = product("UNCOSTED POWDER", "kg", 25, 300);
  bundle(unknown, 25, 100);

  assert.equal(
    checkBooks().findings.filter((f) => f.title.includes("UNCOSTED POWDER") && f.kind === "Sold for less than it holds").length,
    0,
  );
});

// ------------------------------- what was really charged, not what is listed

test("Peach mild: the 500 ml price typed against a full litre", () => {
  /*
    Every other check here reads the price list, and the price list is right —
    600 a litre against a 450 cost. What went wrong was at the counter: one
    litre left the shelf and 300 was taken for it, which is the price of half.
  */
  const peach = product("Peach mild", "L", 5, 600);
  delivery(peach, 1, 7, 3150, "INV-PM1"); // 450/L
  sold(peach, "Peach mild", 1, 300, 450);

  const found = checkBooks().findings.filter((f) => f.kind === "Charged under cost");
  assert.equal(found.length, 1, "one product, one row");
  assert.ok(found[0].title.includes("Peach mild"), found[0].title);
  assert.ok(found[0].title.includes("once"), `a single sale is said as once: ${found[0].title}`);
  assert.ok(found[0].detail.includes("150.00"), `and by how much: ${found[0].detail}`);
});

test("an ordinary sale at the asking price says nothing", () => {
  const plain = product("HONEST SOAP", "kg", 25, 200);
  delivery(plain, 4, 25, 10000, "INV-HS1"); // 100/kg
  sold(plain, "HONEST SOAP", 10, 2000, 1000);

  assert.equal(
    checkBooks().findings.filter((f) => f.kind === "Charged under cost" && f.title.includes("HONEST SOAP")).length,
    0,
  );
});

test("a wrong bundle price and the sale it produced are one row, not two", () => {
  /*
    Changing the price is what stops the next one, so the trap is the row worth
    acting on. The sale it already produced is the same mistake seen from the
    other side.
  */
  const hcl = product("MURIATIC", "kg", 40, 120);
  delivery(hcl, 20, 40, 36000, "INV-MU1"); // 45/kg
  bundle(hcl, 40, 1000); // 25/kg — under the 45 it costs
  sold(hcl, "MURIATIC", 40, 1000, 1800);

  const about = checkBooks().findings.filter((f) => f.title.includes("MURIATIC"));
  assert.equal(about.length, 1, `told once, got: ${about.map((f) => f.kind).join(" + ")}`);
  assert.equal(about[0].kind, "Sold for less than it holds", "and it is the trap, not the damage");
});

test("Fabric softener: the 5 L size fetches less than the flakes in it", () => {
  /*
    A recipe bundle, which carries no cost of its own at all — the chemicals
    leave the store when it is sold and they are what it costs. Three of these
    went out for 2,800 against 4,756 of flakes.

    Flakes land at 640.20 a kilo and the recipe takes 1.5 kg to make 5 L.
  */
  run(`INSERT INTO chemicals (name, canonical_unit) VALUES ('SOFTENER FLAKES', 'kg')`);
  const chem = get<{ id: number }>(`SELECT id FROM chemicals WHERE name = 'SOFTENER FLAKES'`)!.id;
  run(
    `INSERT INTO items (chemical_id, name, kind, canonical_unit, size_milli, unit_label,
                        sellable, price_basis, price_cents, cost_cents)
     VALUES (?, 'SOFTENER FLAKES', 'bulk', 'kg', 25000, 'BAG', 1, 'unit', 85000, 64020)`,
    chem,
  );
  const flakes = get<{ id: number }>(`SELECT id FROM items WHERE name = 'SOFTENER FLAKES'`)!.id;
  postMovement({ itemId: flakes, deltaMilli: 50_000, reason: "purchase", userId: 1 });

  const { formulaId } = createFormula({
    name: "Fabric softerner(Flakes)",
    refSizeMilli: 5_000,
    refUnit: "L",
    steps: "1.5 kg of flakes brought up to 5 L.",
    note: "",
    items: [{ chemicalId: chem, qtyMilli: 1_500 }],
    userId: 1,
  });
  assert.ok(currentVersion(formulaId), "the recipe has a current version");
  run(
    `INSERT INTO bundles (formula_id, size_milli, price_cents) VALUES (?, 5000, 93300)`,
    formulaId,
  );

  const found = checkBooks().findings.filter(
    (f) => f.kind === "Sold for less than it holds" && f.title.includes("Fabric softerner"),
  );
  assert.equal(found.length, 1, "the recipe's own size is checked, not just the shelf's");
  // 1.5 kg at 640.20 is 960.30 against a 933.00 price.
  assert.ok(found[0].detail.includes("960.30"), `says what the chemicals cost: ${found[0].detail}`);
  assert.ok(found[0].detail.includes("27.30"), `and what each one loses: ${found[0].detail}`);
});

test("a recipe size that pays for itself is left alone", () => {
  run(`INSERT INTO chemicals (name, canonical_unit) VALUES ('CHEAP POWDER', 'kg')`);
  const chem = get<{ id: number }>(`SELECT id FROM chemicals WHERE name = 'CHEAP POWDER'`)!.id;
  run(
    `INSERT INTO items (chemical_id, name, kind, canonical_unit, size_milli, unit_label,
                        sellable, price_basis, price_cents, cost_cents)
     VALUES (?, 'CHEAP POWDER', 'bulk', 'kg', 25000, 'BAG', 1, 'unit', 20000, 10000)`,
    chem,
  );
  const powder = get<{ id: number }>(`SELECT id FROM items WHERE name = 'CHEAP POWDER'`)!.id;
  postMovement({ itemId: powder, deltaMilli: 50_000, reason: "purchase", userId: 1 });

  const { formulaId } = createFormula({
    name: "Honest Mix",
    refSizeMilli: 20_000,
    refUnit: "L",
    steps: "2 kg of powder brought up to 20 L.",
    note: "",
    items: [{ chemicalId: chem, qtyMilli: 2_000 }],
    userId: 1,
  });
  run(`INSERT INTO bundles (formula_id, size_milli, price_cents) VALUES (?, 20000, 80000)`, formulaId);

  // 2 kg at 100.00 is 200.00 against an 800.00 price.
  assert.equal(
    checkBooks().findings.filter((f) => f.title.includes("Honest Mix")).length,
    0,
  );
});
