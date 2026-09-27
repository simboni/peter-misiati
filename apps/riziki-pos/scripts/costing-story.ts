/**
 * How cost and profit are worked out, shown by doing it.
 *
 *   rm -rf /tmp/story && mkdir -p /tmp/story
 *   RIZIKI_DB=/tmp/story/pos.db node --experimental-strip-types scripts/costing-story.ts
 *
 * It clears a fresh database, buys a chemical, sells some, buys more at a
 * higher price, mixes a batch, sells the product, sells the same recipe the
 * other way, and prints the books. Every figure it prints is the system's own —
 * the same functions the counter and the reports call — so nothing in
 * COSTING.md is a claim about the code. It is output of the code.
 *
 * Worth re-running whenever the costing rules are touched: if the numbers move,
 * either the change was wrong or the documentation is now out of date.
 */

import { get, all, run, db, stockOf, postMovement } from "../src/lib/db.ts";
import { seed } from "../src/lib/seed.ts";
import { createSupplier, recordPurchase } from "../src/lib/purchasing.ts";
import { recordSale } from "../src/lib/sales.ts";
import { setFormulaOutput, planMix, recordMix } from "../src/lib/mixing.ts";
import { currentVersion, scaleFormula } from "../src/lib/production.ts";
import { saveBundles, formulaBundles } from "../src/lib/bundles.ts";
import { profitSummary, profitPerProduct } from "../src/lib/reports.ts";

db();
seed();

const kes = (c: number) =>
  "KES " + (c / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (m: number, u = "kg") => (m / 1000).toLocaleString("en-KE") + " " + u;
const say = (s = "") => console.log(s);
const rule = (t: string) => {
  say();
  say("── " + t + " " + "─".repeat(Math.max(0, 68 - t.length)));
};

interface ItemRow {
  id: number;
  name: string;
  cost_cents: number;
  price_cents: number;
  canonical_unit: string;
}
const named = (n: string): ItemRow =>
  get<ItemRow>(
    `SELECT id, name, cost_cents, price_cents, canonical_unit
       FROM items WHERE name = ? AND active = 1`,
    n,
  )!;

/*
  The shop is cleared and the books start — which is exactly what happened to
  this shop in real life. Every shelf begins at zero and every figure below is
  one this story put there.
*/
for (const it of all<{ id: number }>(`SELECT id FROM items WHERE active = 1`)) {
  const q = stockOf(it.id);
  if (q !== 0) {
    postMovement({
      itemId: it.id,
      deltaMilli: -q,
      reason: "stocktake",
      userId: 1,
      note: "books started",
    });
  }
  run(`UPDATE items SET cost_cents = 0 WHERE id = ?`, it.id);
}
run(`INSERT INTO settings (key, value) VALUES ('books_start', date('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`);

const supplier = createSupplier({ name: "Chemi Traders Ltd" }, 1);

// ─────────────────────────────────────────────────────── 1 · the chemical arrives
rule("1 · UNGEROL ARRIVES");
const first = recordPurchase({
  supplierId: supplier,
  ref: "INV-4471",
  transportCents: 400000,
  lines: [{ itemId: named("Ungerol").id, units: 2, sizeMilli: 250000, costCents: 15600000 }],
  userId: 1,
});
say(`Two 250 kg drums at KES 78,000 each   goods     ${kes(first.goodsCents)}`);
say(`The lorry                             transport ${kes(first.transportCents)}`);
say(`                                      landed    ${kes(first.lines[0].landedCents)} for ${qty(500000)}`);
let ungerol = named("Ungerol");
say(
  `COST ON FILE  ${kes(first.lines[0].landedCents)} ÷ ${qty(500000)} = ` +
    `${kes(ungerol.cost_cents)} a kilo   ·   on the shelf ${qty(stockOf(ungerol.id))}`,
);

// ───────────────────────────────────────────────────────────── 2 · sold neat
rule("2 · 20 kg SOLD OVER THE COUNTER");
const neat = recordSale({
  clientUuid: "story-neat",
  userId: 1,
  tier: "retail",
  lines: [{ itemId: ungerol.id, units: 1, qtyMilli: 20000, unitPriceCents: ungerol.price_cents }],
  tenders: [{ method: "cash", amountCents: Math.round((ungerol.price_cents * 20000) / 1000) }],
});
const neatLine = get<{
  qty_milli: number;
  line_total_cents: number;
  cost_cents: number;
  rate_cents: number;
}>(
  `SELECT qty_milli, line_total_cents, cost_cents, rate_cents FROM sale_lines WHERE sale_id = ?`,
  neat.saleId,
)!;
say(`Charged   ${qty(neatLine.qty_milli)} × ${kes(neatLine.rate_cents)} = ${kes(neatLine.line_total_cents)}`);
say(
  `Cost      ${qty(neatLine.qty_milli)} × ${kes(ungerol.cost_cents)} = ${kes(neatLine.cost_cents)}` +
    `   ← written onto the line and never changed again`,
);
say(
  `PROFIT    ${kes(neatLine.line_total_cents - neatLine.cost_cents)}   ` +
    `(${(((neatLine.line_total_cents - neatLine.cost_cents) / neatLine.line_total_cents) * 100).toFixed(1)}% margin)`,
);
say(`Shelf     ${qty(stockOf(ungerol.id))} left`);

// ──────────────────────────────────────────────────── 3 · a dearer delivery
rule("3 · THE NEXT DRUM COSTS MORE");
const wasCost = ungerol.cost_cents;
const wasHeld = stockOf(ungerol.id);
const second = recordPurchase({
  supplierId: supplier,
  ref: "INV-4488",
  transportCents: 300000,
  lines: [{ itemId: ungerol.id, units: 1, sizeMilli: 250000, costCents: 9500000 }],
  userId: 1,
});
ungerol = named("Ungerol");
const arrivedRate = Math.round((second.lines[0].landedCents * 1000) / 250000);
const heldValue = Math.round((wasHeld * wasCost) / 1000);
say(
  `One 250 kg drum at KES 95,000 + ${kes(second.transportCents)} = ` +
    `${kes(second.lines[0].landedCents)}  →  ${kes(arrivedRate)} a kilo`,
);
say(`Held before  ${qty(wasHeld)} at ${kes(wasCost)}  =  ${kes(heldValue)} of value`);
say(`Arriving     ${qty(250000)} at ${kes(arrivedRate)}  =  ${kes(second.lines[0].landedCents)}`);
say(
  `BLENDED      ${kes(heldValue + second.lines[0].landedCents)} ÷ ${qty(wasHeld + 250000)} = ` +
    `${kes(ungerol.cost_cents)} a kilo`,
);
say(`Yesterday's sale still says ${kes(wasCost)} a kilo. Nothing already sold is rewritten.`);

// ───────────────────────────────────────────────────────── 4 · mixing a batch
rule("4 · A BATCH OF MULTIPURPOSE IS MIXED");
const formula = get<{ id: number; name: string }>(
  `SELECT id, name FROM formulas WHERE name = 'Multipurpose'`,
)!;
const version = currentVersion(formula.id)!;

// The other ingredients have to be on the shelf, and priced, before a batch can
// take them off it.
for (const need of scaleFormula(version.id, 200000)) {
  const src = get<{ id: number; price_cents: number }>(
    `SELECT id, price_cents FROM items
      WHERE chemical_id = ? AND sellable = 1 AND active = 1 AND price_basis = 'unit' LIMIT 1`,
    need.chemicalId,
  );
  if (!src || src.id === ungerol.id) continue;
  recordPurchase({
    supplierId: supplier,
    ref: "INV-stocking-up",
    lines: [
      {
        itemId: src.id,
        units: 1,
        sizeMilli: need.neededMilli * 4,
        costCents: Math.round((src.price_cents * 0.74 * need.neededMilli * 4) / 1000),
      },
    ],
    userId: 1,
  });
}

const { lastInsertRowid: madeId } = run(
  `INSERT INTO items (name, kind, canonical_unit, size_milli, unit_label, sellable,
                      price_basis, price_cents, floor_cents, ceiling_cents, cost_cents,
                      reorder_level_milli)
   VALUES ('Multipurpose Cleaner', 'bulk', 'L', 20000, 'jerrican', 1,
           'unit', 22000, 18000, 26000, 0, 40000)`,
);
setFormulaOutput(formula.id, Number(madeId), 1);

say(`The recipe, scaled to 200 L:`);
for (const ing of planMix(version.id, 200000).lines) {
  const it = get<{ name: string; cost_cents: number; canonical_unit: string }>(
    `SELECT name, cost_cents, canonical_unit FROM items WHERE id = ?`,
    ing.itemId!,
  )!;
  say(
    `   ${it.name.padEnd(20)} ${qty(ing.neededMilli, it.canonical_unit).padStart(12)}` +
      ` × ${kes(it.cost_cents).padStart(12)} = ` +
      `${kes(Math.round((it.cost_cents * ing.neededMilli) / 1000)).padStart(12)}`,
  );
}

const batch = recordMix({ versionId: version.id, targetMilli: 200000, actualMilli: 196000, userId: 1 });
say(`                                                     ────────────`);
say(`   What went in                                      ${kes(batch.totalCostCents).padStart(12)}`);
say(`   What came out          ${qty(batch.madeMilli, "L")}   (the recipe aimed at 200 L; 196 L is what it made)`);
say(
  `   COST OF THE MIX        ${kes(batch.totalCostCents)} ÷ ${qty(batch.madeMilli, "L")} = ` +
    `${kes(batch.outputCostCents)} a litre`,
);
const made = named("Multipurpose Cleaner");
say(`   On the shelf now       ${qty(stockOf(made.id), "L")} at ${kes(made.cost_cents)} a litre`);

// ─────────────────────────────────────────────────── 5 · selling the product
rule("5 · 20 L OF THE PRODUCT IS SOLD");
const sold = recordSale({
  clientUuid: "story-made",
  userId: 1,
  tier: "retail",
  lines: [{ itemId: made.id, units: 1, qtyMilli: 20000, unitPriceCents: made.price_cents }],
  tenders: [{ method: "mpesa", amountCents: Math.round((made.price_cents * 20000) / 1000) }],
});
const soldLine = get<{ line_total_cents: number; cost_cents: number }>(
  `SELECT line_total_cents, cost_cents FROM sale_lines WHERE sale_id = ?`,
  sold.saleId,
)!;
say(`Charged   ${qty(20000, "L")} × ${kes(made.price_cents)} = ${kes(soldLine.line_total_cents)}`);
say(`Cost      ${qty(20000, "L")} × ${kes(made.cost_cents)} = ${kes(soldLine.cost_cents)}`);
say(
  `PROFIT    ${kes(soldLine.line_total_cents - soldLine.cost_cents)}   ` +
    `(${(((soldLine.line_total_cents - soldLine.cost_cents) / soldLine.line_total_cents) * 100).toFixed(1)}% margin)`,
);

// ──────────────────────────────────────────────── 6 · the same recipe, to order
rule("6 · THE SAME RECIPE, MIXED TO ORDER INSTEAD");
setFormulaOutput(formula.id, null, 1);
saveBundles({ formulaId: formula.id }, [{ sizeMilli: 20000, priceCents: 440000, floorCents: 400000 }]);
const bundle = formulaBundles(formula.id)[0];
const toOrder = recordSale({
  clientUuid: "story-to-order",
  userId: 1,
  tier: "retail",
  lines: [{ bundleId: bundle.id, units: 1, unitPriceCents: bundle.priceCents }],
  tenders: [{ method: "cash", amountCents: bundle.priceCents }],
});
const orderLines = all<{
  name_snapshot: string;
  line_total_cents: number;
  cost_cents: number;
  bundle_id: number | null;
}>(
  `SELECT name_snapshot, line_total_cents, cost_cents, bundle_id
     FROM sale_lines WHERE sale_id = ? ORDER BY id`,
  toOrder.saleId,
);
for (const r of orderLines) {
  say(
    `${r.bundle_id ? "THE PRODUCT " : "  ingredient"}  ${r.name_snapshot.padEnd(26)}` +
      ` charged ${kes(r.line_total_cents).padStart(12)}   cost ${kes(r.cost_cents).padStart(11)}`,
  );
}
const orderRevenue = orderLines.reduce((n, r) => n + r.line_total_cents, 0);
const orderCost = orderLines.reduce((n, r) => n + r.cost_cents, 0);
say(`                                          ────────────────────   ────────────────`);
say(`                                          ${kes(orderRevenue).padStart(20)}   ${kes(orderCost).padStart(16)}`);
say(
  `PROFIT ${kes(orderRevenue - orderCost)}  ` +
    `(${(((orderRevenue - orderCost) / orderRevenue) * 100).toFixed(1)}% margin)` +
    `  — the report puts the two halves back together`,
);

// ───────────────────────────────────────────────────────────── 7 · the books
rule("7 · WHAT THE REPORT SAYS");
run(
  `INSERT INTO expenses (at, category, amount_cents, method, note, user_id)
   VALUES (datetime('now'), 'Transport', 120000, 'cash', 'delivery run', 1)`,
);
const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const range = { from: today, to: today };
const summary = profitSummary(range);
say(`Sales                 ${kes(summary.salesCents).padStart(14)}`);
say(`Cost of goods sold  − ${kes(summary.cogsCents).padStart(14)}`);
say(`                      ──────────────`);
say(`Gross profit          ${kes(summary.grossProfitCents).padStart(14)}`);
say(`Expenses            − ${kes(summary.expensesCents).padStart(14)}`);
say(`                      ──────────────`);
say(
  `NET PROFIT            ${kes(summary.netProfitCents).padStart(14)}` +
    `    ${((summary.netProfitCents / summary.salesCents) * 100).toFixed(1)}% of sales`,
);
say();
say(`What earns, product by product:`);
for (const r of profitPerProduct(range, 20)) {
  say(
    `   ${r.name.padEnd(28)} sold ${kes(r.revenue_cents).padStart(12)}` +
      `   cost ${kes(r.cost_cents).padStart(11)}   profit ${kes(r.profit_cents).padStart(12)}` +
      `  ${r.margin_pct.toFixed(0).padStart(4)}%`,
  );
}
const everyRow = profitPerProduct(range, 500);
say();
say(
  `Do the rows add up to the total?  sales ` +
    `${everyRow.reduce((n, r) => n + r.revenue_cents, 0) === summary.salesCents}` +
    `   cost ${everyRow.reduce((n, r) => n + r.cost_cents, 0) === summary.cogsCents}`,
);
const left = stockOf(named("Ungerol").id);
say();
say(
  `Still on the shelf: ${qty(left)} of Ungerol at ${kes(named("Ungerol").cost_cents)} a kilo` +
    ` = ${kes(Math.round((left * named("Ungerol").cost_cents) / 1000))} of the shop's money.`,
);
