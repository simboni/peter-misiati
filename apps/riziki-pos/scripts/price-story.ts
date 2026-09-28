/**
 * Two drums at two prices, and a selling price that moves under the stock.
 *
 *   rm -rf /tmp/prices && mkdir -p /tmp/prices
 *   RIZIKI_DB=/tmp/prices/pos.db node --experimental-strip-types scripts/price-story.ts
 *
 * The question this answers is the one every shop asks about a running average:
 * a drum is bought at one price, half of it is sold, and the next drum costs
 * something else. What is the stock worth now, what does the next sale cost the
 * shop, and what happens to the sales already made? And the same question from
 * the other side: the asking price changes while the same drum is still on the
 * floor.
 *
 * Every figure printed is the system's own — the same functions the counter and
 * the reports call — so nothing here is a claim about the code. It is output of
 * the code. Worth re-running whenever the costing or pricing rules are touched:
 * if a number moves, either the change was wrong or COSTING.md is now out of
 * date.
 */

import { get, all, run, db, stockOf, postMovement } from "../src/lib/db.ts";
import { seed } from "../src/lib/seed.ts";
import { createSupplier, recordPurchase } from "../src/lib/purchasing.ts";
import { recordSale } from "../src/lib/sales.ts";
import { applyPrices } from "../src/lib/pricing.ts";
import { profitSummary, profitPerProduct } from "../src/lib/reports.ts";
import { fromCents } from "../src/lib/units.ts";

db();
seed();

const kes = (c: number) =>
  "KES " + (c / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (m: number, u = "kg") => (m / 1000).toLocaleString("en-KE") + " " + u;
const say = (s = "") => console.log(s);
const rule = (t: string) => {
  say();
  say("── " + t + " " + "─".repeat(Math.max(0, 70 - t.length)));
};

interface ItemRow {
  id: number;
  name: string;
  cost_cents: number;
  price_cents: number;
}
const named = (n: string): ItemRow =>
  get<ItemRow>(`SELECT id, name, cost_cents, price_cents FROM items WHERE name = ? AND active = 1`, n)!;

// The books start: every shelf at zero, no cost on file, nothing sold.
for (const it of all<{ id: number }>(`SELECT id FROM items WHERE active = 1`)) {
  const q = stockOf(it.id);
  if (q !== 0) {
    postMovement({ itemId: it.id, deltaMilli: -q, reason: "stocktake", userId: 1, note: "books started" });
  }
  run(`UPDATE items SET cost_cents = 0 WHERE id = ?`, it.id);
}
run(`INSERT INTO settings (key, value) VALUES ('books_start', date('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`);

const supplier = createSupplier({ name: "Chemi Traders Ltd" }, 1);
let ungerol = named("Ungerol");
// Room to move the asking price without the owner's band getting in the way.
run(`UPDATE items SET floor_cents = 30000, ceiling_cents = 80000 WHERE id = ?`, ungerol.id);

/** Sell a quantity at whatever the shelf price is today. */
function sell(tag: string, qtyMilli: number) {
  const item = named("Ungerol");
  const total = Math.round((item.price_cents * qtyMilli) / 1000);
  const { saleId } = recordSale({
    clientUuid: tag,
    userId: 1,
    tier: "retail",
    lines: [{ itemId: item.id, units: 1, qtyMilli, unitPriceCents: item.price_cents }],
    tenders: [{ method: "cash", amountCents: total }],
  });
  return { saleId, item };
}

interface LineRow {
  sale_id: number;
  qty_milli: number;
  rate_cents: number;
  line_total_cents: number;
  cost_cents: number;
}
const lineOf = (saleId: number) =>
  get<LineRow>(
    `SELECT sale_id, qty_milli, rate_cents, line_total_cents, cost_cents
       FROM sale_lines WHERE sale_id = ?`,
    saleId,
  )!;

function showSale(title: string, l: LineRow) {
  const profit = l.line_total_cents - l.cost_cents;
  say(`${title}`);
  say(`    charged  ${qty(l.qty_milli)} × ${kes(l.rate_cents)} = ${kes(l.line_total_cents)}`);
  say(
    `    cost     ${qty(l.qty_milli)} × ${kes(Math.round((l.cost_cents * 1000) / l.qty_milli))}` +
      ` = ${kes(l.cost_cents)}`,
  );
  say(`    profit   ${kes(profit)}   (${((profit / l.line_total_cents) * 100).toFixed(1)}% margin)`);
}

function shelf() {
  const item = named("Ungerol");
  const held = stockOf(item.id);
  say(
    `SHELF  ${qty(held)} on hand · costed at ${kes(item.cost_cents)} a kilo · ` +
      `worth ${kes(Math.round((held * item.cost_cents) / 1000))}`,
  );
  say(`ASKING ${kes(item.price_cents)} a kilo`);
}

// ───────────────────────────────────────────────── 1 · the first drum
rule("1 · THE FIRST DRUM");
const one = recordPurchase({
  supplierId: supplier,
  ref: "INV-5501",
  transportCents: 200000,
  lines: [{ itemId: ungerol.id, units: 1, sizeMilli: 250000, costCents: 7800000 }],
  userId: 1,
});
say(`One 250 kg drum   supplier  ${kes(one.goodsCents)}`);
say(`                  transport ${kes(one.transportCents)}`);
say(`                  landed    ${kes(one.lines[0].landedCents)} for ${qty(250000)}`);
shelf();

// ───────────────────────────────────────────────── 2 · half of it sold
rule("2 · 90 kg SOLD FROM IT");
const saleA = sell("price-story-a", 90000);
showSale("Sale A", lineOf(saleA.saleId));
shelf();

// ──────────────────────────────────── 3 · the next drum costs more
rule("3 · THE NEXT DRUM COSTS MORE — THE SAME CHEMICAL, A DEARER LORRY");
const heldBefore = stockOf(ungerol.id);
const costBefore = named("Ungerol").cost_cents;
const two = recordPurchase({
  supplierId: supplier,
  ref: "INV-5622",
  transportCents: 300000,
  lines: [{ itemId: ungerol.id, units: 1, sizeMilli: 250000, costCents: 9500000 }],
  userId: 1,
});
say(`One 250 kg drum   supplier  ${kes(two.goodsCents)}`);
say(`                  transport ${kes(two.transportCents)}`);
say(`                  landed    ${kes(two.lines[0].landedCents)} for ${qty(250000)}`);
say();
say(`Held before   ${qty(heldBefore)} at ${kes(costBefore)} = ${kes(Math.round((heldBefore * costBefore) / 1000))}`);
say(`Arriving      ${qty(250000)} at ${kes(Math.round((two.lines[0].landedCents * 1000) / 250000))} = ${kes(two.lines[0].landedCents)}`);
const blended = named("Ungerol").cost_cents;
say(
  `BLENDED       ${kes(Math.round((heldBefore * costBefore) / 1000) + two.lines[0].landedCents)}` +
    ` ÷ ${qty(heldBefore + 250000)} = ${kes(blended)} a kilo`,
);
say();
say("Sale A has not moved:");
showSale("Sale A, looked at again", lineOf(saleA.saleId));
shelf();

// ───────────────────────────────── 4 · sold again, same asking price
rule("4 · 90 kg SOLD AGAIN — THE SAME PRICE, THE NEW COST");
const saleB = sell("price-story-b", 90000);
showSale("Sale B", lineOf(saleB.saleId));
say(
  `    The customer paid the same as sale A. The shop earned ` +
    `${kes(lineOf(saleA.saleId).line_total_cents - lineOf(saleA.saleId).cost_cents - (lineOf(saleB.saleId).line_total_cents - lineOf(saleB.saleId).cost_cents))} less,` +
    ` because the chemical now costs more.`,
);
shelf();

// ─────────────────────────────── 5 · the asking price is put up
rule("5 · THE ASKING PRICE IS PUT UP — SAME STOCK, NEW PRICE");
const before = named("Ungerol").price_cents;
const raised = applyPrices(
  [{ itemId: ungerol.id, price: fromCents(56000) }],
  1,
  { source: "admin" },
);
say(raised.lines.join("\n"));
say(`Nothing on the shelf changed: still ${qty(stockOf(ungerol.id))} at ${kes(named("Ungerol").cost_cents)} a kilo.`);
say();
say("The change is on the record, with who made it:");
for (const p of all<{ at: string; old_price: number; new_price: number; who: string; source: string }>(
  `SELECT pc.at, pc.old_price, pc.new_price, COALESCE(u.name,'?') AS who, pc.source
     FROM price_changes pc LEFT JOIN users u ON u.id = pc.user_id
    WHERE pc.item_id = ? ORDER BY pc.at`,
  ungerol.id,
)) {
  say(`    ${p.at}  ${kes(p.old_price)} → ${kes(p.new_price)}  by ${p.who} (${p.source})`);
}
say();
say(`Sales A and B were rung at ${kes(before)} and still say so.`);

// ─────────────────────────────── 6 · sold at the new price
rule("6 · 90 kg SOLD AT THE NEW PRICE");
const saleC = sell("price-story-c", 90000);
showSale("Sale C", lineOf(saleC.saleId));
shelf();

// ─────────────────────────────────────────────── 7 · what the books say
rule("7 · WHAT THE BOOKS SAY");
const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const range = { from: today, to: today };
const s = profitSummary(range);
say(`Sales        ${kes(s.salesCents)}`);
say(`Cost of goods ${kes(s.cogsCents)}`);
say(`GROSS PROFIT  ${kes(s.grossProfitCents)}   (${((s.grossProfitCents / s.salesCents) * 100).toFixed(1)}% margin)`);
say();
say("Every sale keeps its own two numbers:");
for (const [tag, id] of [["A", saleA.saleId], ["B", saleB.saleId], ["C", saleC.saleId]] as const) {
  const l = lineOf(id);
  say(
    `    ${tag}  sold at ${kes(l.rate_cents)}/kg, costed at ` +
      `${kes(Math.round((l.cost_cents * 1000) / l.qty_milli))}/kg → ${kes(l.line_total_cents - l.cost_cents)}`,
  );
}
const rows = profitPerProduct(range, 10);
const rowTotal = rows.reduce((n, r) => n + r.profit_cents, 0);
say();
say(`Product report adds up to the total: ${rowTotal === s.grossProfitCents}`);
const held = stockOf(named("Ungerol").id);
say();
say(
  `STILL ON THE SHELF  ${qty(held)} at ${kes(named("Ungerol").cost_cents)} a kilo = ` +
    `${kes(Math.round((held * named("Ungerol").cost_cents) / 1000))} of the shop's money.`,
);
