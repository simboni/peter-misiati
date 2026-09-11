/**
 * The money paths, recomputed by hand and compared.
 *
 * Everything here is arithmetic the shop will be doing with real shillings from
 * tomorrow: what a delivery costs once transport is spread across it, what that
 * does to a weighted average, what a sale then books as profit, and whether the
 * day's figures add up to the sales that made them.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "money-")), "t.db");

import test from "node:test";
import assert from "node:assert/strict";
const { seed } = await import("../src/lib/seed.ts");
const { get, all, run, stockOf } = await import("../src/lib/db.ts");
const { createProduct } = await import("../src/lib/catalog.ts");
const { recordPurchase, createSupplier } = await import("../src/lib/purchasing.ts");
const { recordSale } = await import("../src/lib/sales.ts");
const { dayTotals } = await import("../src/lib/reports.ts");

seed();
const OWNER = 1;
const supplier = createSupplier({ name: "Pre-flight Supplies", phone: "", note: "" }, OWNER);

const a = createProduct({ name: "Sweep Caustic", unit: "kg", containerValue: 25, containerLabel: "bag",
  price: 220, floor: 0, ceiling: 0, aliases: "", byUserId: OWNER });
const b = createProduct({ name: "Sweep Ungerol", unit: "kg", containerValue: 20, containerLabel: "drum",
  price: 500, floor: 0, ceiling: 0, aliases: "", byUserId: OWNER });

test("transport is spread across a delivery BY VALUE, not evenly", () => {
  // 2 bags of caustic at 4,000 each = 8,000. 1 drum of ungerol at 12,000.
  // Goods 20,000. Transport 1,000. By value: caustic 8/20 = 400, ungerol 12/20 = 600.
  const res = recordPurchase({
    supplierId: supplier,
    transportCents: 100_000,
    lines: [
      { itemId: a, units: 2, sizeMilli: 25_000, costCents: 800_000 },
      { itemId: b, units: 1, sizeMilli: 20_000, costCents: 1_200_000 },
    ],
    userId: OWNER,
  });
  assert.equal(res.goodsCents, 2_000_000, "goods");
  assert.equal(res.transportCents, 100_000, "transport");
  assert.equal(res.totalCents, 2_100_000, "total");

  /*
    `purchase_lines.cost_cents` is the LANDED cost of the line, not the goods
    cost as typed: the transport has already been spread into it. That is the
    right place for it — the line's true cost is what the item's average is
    built from — and it is what makes the two lines sum to the whole bill
    rather than to the goods.
  */
  const lines = all<{ item_id: number; cost_cents: number; qty_milli: number }>(
    `SELECT item_id, cost_cents, qty_milli FROM purchase_lines WHERE purchase_id = ? ORDER BY item_id`,
    res.purchaseId,
  );
  const la = lines.find((l) => l.item_id === a)!;
  const lb = lines.find((l) => l.item_id === b)!;
  console.log(`  caustic landed ${la.cost_cents / 100} on ${la.qty_milli / 1000} kg`);
  console.log(`  ungerol landed ${lb.cost_cents / 100} on ${lb.qty_milli / 1000} kg`);
  assert.equal(la.qty_milli, 50_000, "2 bags × 25 kg");
  assert.equal(lb.qty_milli, 20_000, "1 drum × 20 kg");
  assert.equal(la.cost_cents, 840_000, "caustic: 8,000 goods + its 8/20 share of the 1,000");
  assert.equal(lb.cost_cents, 1_260_000, "ungerol: 12,000 goods + its 12/20 share");
  assert.equal(la.cost_cents + lb.cost_cents, res.totalCents, "and the two come to the whole bill");
  // Evenly split would have been 500 each — 8,500 and 12,500. It is not.
  assert.notEqual(la.cost_cents, 850_000, "spread by value, not evenly");
});

test("stock rose by what arrived, and the cost is the LANDED rate", () => {
  assert.equal(stockOf(a), 50_000, "2 bags × 25 kg");
  assert.equal(stockOf(b), 20_000, "1 drum × 20 kg");
  const ca = get<{ cost_cents: number }>(`SELECT cost_cents FROM items WHERE id = ?`, a)!.cost_cents;
  const cb = get<{ cost_cents: number }>(`SELECT cost_cents FROM items WHERE id = ?`, b)!.cost_cents;
  console.log(`  caustic cost ${ca / 100}/kg   ungerol cost ${cb / 100}/kg`);
  assert.equal(ca, Math.round(840_000 / 50), "840,000c over 50 kg = 16,800c/kg");
  assert.equal(cb, Math.round(1_260_000 / 20), "1,260,000c over 20 kg = 63,000c/kg");
});

test("a second delivery at a different price makes a weighted average", () => {
  // 50 kg already at 168.00. Add 50 kg at 200.00 flat, no transport.
  recordPurchase({
    supplierId: supplier,
    lines: [{ itemId: a, units: 2, sizeMilli: 25_000, costCents: 1_000_000 }],
    userId: OWNER,
  });
  const cost = get<{ cost_cents: number }>(`SELECT cost_cents FROM items WHERE id = ?`, a)!.cost_cents;
  // (50 × 16800 + 50 × 20000) / 100 = (840000 + 1000000)/100 = 18400
  console.log(`  50 kg at 168.00 + 50 kg at 200.00 -> ${cost / 100}/kg on ${stockOf(a) / 1000} kg`);
  assert.equal(stockOf(a), 100_000);
  assert.equal(cost, 18_400, "the weighted average of the two, not the latest price");
});

test("a sale books the cost of what it took, so the profit is honest", () => {
  const before = get<{ cost_cents: number }>(`SELECT cost_cents FROM items WHERE id = ?`, a)!.cost_cents;
  const res = recordSale({
    clientUuid: `money-${Math.random()}`,
    lines: [{ itemId: a, units: 1, qtyMilli: 10_000, unitPriceCents: 22_000 }],
    tenders: [{ method: "cash", amountCents: 220_000 }],
    userId: OWNER,
    tier: "retail",
  } as never);
  const line = get<{ line_total_cents: number; cost_cents: number }>(
    `SELECT line_total_cents, cost_cents FROM sale_lines WHERE sale_id = ?`, res.saleId)!;
  console.log(`  sold 10 kg for ${line.line_total_cents / 100}, cost ${line.cost_cents / 100}, profit ${(line.line_total_cents - line.cost_cents) / 100}`);
  assert.equal(line.line_total_cents, 220_000, "10 kg at 220");
  assert.equal(line.cost_cents, Math.round((before * 10_000) / 1000), "10 kg at the weighted average");
  assert.equal(line.line_total_cents - line.cost_cents, 220_000 - 184_000);
});

test("the day's figures equal the sales that made them", () => {
  const d = dayTotals();
  const sales = all<{ total_cents: number; paid_cents: number }>(
    `SELECT total_cents, paid_cents FROM sales WHERE status = 'completed' AND date(at) = date('now','+3 hours')`,
  );
  const mine = sales.reduce((n, s) => n + s.total_cents, 0);
  const paid = sales.reduce((n, s) => n + s.paid_cents, 0);
  console.log(`  reports say ${JSON.stringify({ sales: d.salesCents, paid: (d as never as Record<string, number>).paidCents })}`);
  console.log(`  raw tables say sales ${mine / 100}, paid ${paid / 100}, over ${sales.length} sale(s)`);
  assert.equal(d.salesCents, mine, "takings match the sale rows exactly");
});
