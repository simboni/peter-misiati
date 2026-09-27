/**
 * A showroom shop: two months of healthy trading, for screenshots.
 *
 * Everything here is invented, but nothing here is impossible — the margins,
 * the haggling, the credit and the weekday rhythm are the ones the real shop
 * runs on. A demo full of round numbers photographs like a demo.
 */
const ROOT = "../src/lib";
const { run, get, all, db } = await import(`${ROOT}/db.ts`);
const { seed } = await import(`${ROOT}/seed.ts`);

db();
seed();

const TODAY = "2026-09-27";
const BOOKS = "2026-08-01";

const setting = (k: string, v: string) =>
  run(`INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`, k, v);

setting("books_start", BOOKS);
setting("shop_name", "Riziki Industrial Chemicals");
setting("shop_address", "Nairobi");
setting("shop_phone", "0722 000 000");

// ------------------------------------------------------------------ people
const EXTRA = [
  ["Eastleigh Cleaners Ltd", "0722 418 330", "wholesale", 15000000],
  ["Thika Road Car Wash", "0733 902 114", "wholesale", 8000000],
  ["Westlands Laundry Services", "0720 771 605", "wholesale", 12000000],
  ["Gikomba Detergent Traders", "0711 226 840", "wholesale", 20000000],
  ["Ruaraka Hotel Supplies", "0724 508 219", "wholesale", 10000000],
] as const;
for (const [name, phone, kind, limit] of EXTRA) {
  run(`INSERT INTO customers (name, phone, kind, credit_limit_cents) VALUES (?, ?, ?, ?)`,
      name, phone, kind, limit);
}

// ------------------------------------------------------------------ shelves
const items = all<{
  id: number; name: string; kind: string; price_cents: number;
  cost_cents: number; size_milli: number; canonical_unit: string;
}>(`SELECT id, name, kind, price_cents, cost_cents, size_milli, canonical_unit
      FROM items WHERE active = 1 AND sellable = 1 ORDER BY id`);

for (const it of items) {
  // Enough on the shelf that two months of trading never drives it negative:
  // a shop photographed mid-restock looks like a shop in trouble.
  const opening = it.canonical_unit === "pcs" ? 250_000 : 300_000;
  run(`INSERT INTO stock_movements (item_id, delta_milli, reason, user_id, at)
       VALUES (?, ?, 'opening', 1, ?)`, it.id, opening, `${BOOKS} 06:30:00`);
}
// Every item costed — an uncosted row is a true warning, and not the one this
// screenshot is about.
run(`UPDATE items SET cost_cents = CAST(price_cents * 0.74 AS INTEGER) WHERE COALESCE(cost_cents,0) = 0`);
// Three rows deliberately left to run low, because "2 running low" is the
// feature, and a board with nothing on it shows nothing.
run(`UPDATE items SET reorder_level_milli = 0`);
const low = all<{ id: number }>(`SELECT id FROM items WHERE active=1 AND sellable=1 ORDER BY id LIMIT 3 OFFSET 2`);
for (const r of low) run(`UPDATE items SET reorder_level_milli = 400000 WHERE id = ?`, r.id);

// ------------------------------------------------------------------ trading
let n = 20260801;
const rnd = () => ((n = (n * 1103515245 + 12345) % 2147483648) / 2147483648);
const shift = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const span = Math.round((Date.parse(`${TODAY}T12:00:00Z`) - Date.parse(`${BOOKS}T12:00:00Z`)) / 86400000);

const custs = all<{ id: number; name: string; kind: string }>(
  `SELECT id, name, kind FROM customers WHERE kind = 'wholesale' ORDER BY id`);

let saleId = 0;
const credit: number[] = [];

for (let i = 0; i <= span; i++) {
  const date = shift(BOOKS, i);
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  // Sunday is a short morning; Saturday and Monday are the busy days.
  const busy = dow === 0 ? 0.4 : dow === 6 ? 1.35 : dow === 1 ? 1.15 : 1;
  const growth = 1 + (i / span) * 0.45;          // the shop is growing
  const count = Math.max(2, Math.round((4 + rnd() * 4) * busy * growth));

  for (let k = 0; k < count; k++) {
    saleId++;
    const at = `${date} ${String(7 + Math.floor(rnd() * 11)).padStart(2, "0")}:${String(Math.floor(rnd() * 60)).padStart(2, "0")}:00`;
    const lines: Array<{ id: number; units: number; qty: number; rate: number; total: number; cost: number; list: number }> = [];
    for (let l = 0; l < 1 + Math.floor(rnd() * 3); l++) {
      const it = items[Math.floor(rnd() * items.length)];
      /*
        Sold the way the counter sells it: by weight for the chemicals, by the
        piece for the bottles and jerricans. Nobody walks out with three 250 kg
        drums, and a demo where everybody does prints an average sale the shop
        would not recognise.
      */
      const pieces = it.canonical_unit === "pcs";
      const qty = pieces
        ? (1 + Math.floor(rnd() * 8)) * 1000
        : Math.round((1 + rnd() * 24) * 2) * 500;
      const units = pieces ? qty / 1000 : 1;
      // Haggling: one line in six comes down a little, never far.
      const cut = rnd() < 0.17 ? 0.94 - rnd() * 0.05 : 1;
      const rate = Math.round(it.price_cents * cut);
      lines.push({
        id: it.id, units, qty, rate,
        total: Math.round((rate * qty) / 1000),
        cost: Math.round((it.cost_cents * qty) / 1000),
        list: it.price_cents,
      });
    }
    const total = lines.reduce((a, b) => a + b.total, 0);
    const wholesale = rnd() < 0.22;
    const customerId = wholesale ? custs[Math.floor(rnd() * custs.length)].id : null;
    // Credit only on the last three weeks, so the debtors list is current
    // rather than a museum of old sins.
    const onCredit = wholesale && i > span - 21 && rnd() < 0.3;
    const paid = onCredit ? Math.round(total * (rnd() < 0.5 ? 0.4 : 0)) : total;
    run(`INSERT INTO sales (id, client_uuid, at, user_id, customer_id, tier, total_cents, paid_cents, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed')`,
      saleId, `show-${saleId}`, at, rnd() < 0.55 ? 1 : 2, customerId,
      wholesale ? "wholesale" : "retail", total, paid);
    for (const l of lines) {
      run(`INSERT INTO sale_lines (sale_id, item_id, name_snapshot, units, qty_milli,
                                   unit_price_cents, rate_cents, list_price_cents, line_total_cents, cost_cents)
           VALUES (?, ?, (SELECT name FROM items WHERE id = ?), ?, ?, ?, ?, ?, ?, ?)`,
        saleId, l.id, l.id, l.units, l.qty, Math.round(l.total / l.units), l.rate, l.list, l.total, l.cost);
      run(`INSERT INTO stock_movements (item_id, delta_milli, reason, user_id, at, ref_type, ref_id)
           VALUES (?, ?, 'sale', 1, ?, 'sale', ?)`, l.id, -l.qty, at, saleId);
    }
    if (paid > 0) {
      // Split tenders are ordinary here: part cash, part M-Pesa.
      const split = rnd() < 0.18 ? Math.round(paid * (0.3 + rnd() * 0.4)) : 0;
      if (split > 0) {
        run(`INSERT INTO payments (sale_id, at, method, amount_cents, user_id) VALUES (?, ?, 'cash', ?, 1)`, saleId, at, split);
        run(`INSERT INTO payments (sale_id, at, method, amount_cents, user_id) VALUES (?, ?, 'mpesa', ?, 1)`, saleId, at, paid - split);
      } else {
        run(`INSERT INTO payments (sale_id, at, method, amount_cents, user_id) VALUES (?, ?, ?, ?, 1)`,
            saleId, at, rnd() < 0.48 ? "cash" : "mpesa", paid);
      }
    }
    if (onCredit) credit.push(saleId);
  }

  if (date.endsWith("-01")) {
    run(`INSERT INTO expenses (at, category, amount_cents, method, note, user_id)
         VALUES (?, 'Rent', 4500000, 'mpesa', 'shop rent', 1)`, `${date} 08:30:00`);
    run(`INSERT INTO expenses (at, category, amount_cents, method, note, user_id)
         VALUES (?, 'Utilities', 680000, 'mpesa', 'power and water', 1)`, `${date} 08:45:00`);
  }
  if (rnd() < 0.3) {
    run(`INSERT INTO expenses (at, category, amount_cents, method, note, user_id)
         VALUES (?, 'Transport', ?, 'cash', 'delivery run', 1)`,
        `${date} 10:15:00`, 40000 + Math.floor(rnd() * 80000));
  }
  if (dow === 6) {
    run(`INSERT INTO expenses (at, category, amount_cents, method, note, user_id)
         VALUES (?, 'Wages', 350000, 'cash', 'casual help', 1)`, `${date} 17:30:00`);
  }
}

// ---------------------------------------------------------------- deliveries
const sups = all<{ id: number; name: string }>(`SELECT id, name FROM suppliers ORDER BY id`);
let ref = 4100;
for (let i = 3; i <= span; i += 6 + Math.floor(rnd() * 3)) {
  const date = shift(BOOKS, i);
  const sup = sups[Math.floor(rnd() * sups.length)];
  const picks = items
    .filter(() => rnd() < 0.18)
    .slice(0, 5)
    .filter((it) => it.canonical_unit !== "pcs");
  if (!picks.length) continue;
  const transport = 150000 + Math.floor(rnd() * 250000);
  const { lastInsertRowid: pid } = run(
    `INSERT INTO purchases (at, supplier_id, total_cents, transport_cents, ref, user_id)
     VALUES (?, ?, 0, ?, ?, 1)`, `${date} 09:00:00`, sup.id, transport, `INV-${++ref}`);
  let total = transport;
  for (const it of picks) {
    const units = 1 + Math.floor(rnd() * 3);
    const qty = units * it.size_milli;
    const cost = Math.round((it.cost_cents * qty) / 1000);
    total += cost;
    run(`INSERT INTO purchase_lines (purchase_id, item_id, units, size_milli, qty_milli, cost_cents)
         VALUES (?, ?, ?, ?, ?, ?)`, pid, it.id, units, it.size_milli, qty, cost);
    run(`INSERT INTO stock_movements (item_id, delta_milli, reason, user_id, at, ref_type, ref_id)
         VALUES (?, ?, 'purchase', 1, ?, 'purchase', ?)`, it.id, qty, `${date} 09:00:00`, pid);
  }
  run(`UPDATE purchases SET total_cents = ? WHERE id = ?`, total, pid);
}

// One old debt cleared this week, so "old bills settled" is a real number.
const settle = get<{ id: number; total_cents: number; paid_cents: number }>(
  `SELECT id, total_cents, paid_cents FROM sales
    WHERE total_cents > paid_cents AND date(at,'+3 hours') < ? ORDER BY at LIMIT 1`,
  shift(TODAY, -20));
if (settle) {
  run(`INSERT INTO payments (sale_id, at, method, amount_cents, user_id)
       VALUES (?, ?, 'mpesa', ?, 1)`, settle.id, `${shift(TODAY, -2)} 11:20:00`,
       settle.total_cents - settle.paid_cents);
  run(`UPDATE sales SET paid_cents = total_cents WHERE id = ?`, settle.id);
}

/*
  Last, once every movement is in: the shelf as it actually stands.

  Reorder levels set against the real closing quantity, so "running low" means
  three named rows a buyer could go and order — not a number invented at the
  start of the run and overtaken by two months of deliveries. And a cost price
  on everything, because "no cost price" is a true warning about a real shop
  and not the thing this picture is about.
*/
// A row with no asking price cannot have a costed one either.
run(`UPDATE items SET price_cents = 38000, floor_cents = 30000, ceiling_cents = 45000
      WHERE active = 1 AND sellable = 1 AND COALESCE(price_cents, 0) = 0`);
run(`UPDATE items SET cost_cents = CAST(price_cents * 0.74 AS INTEGER)
      WHERE active = 1 AND COALESCE(cost_cents, 0) = 0 AND price_cents > 0`);
const standing = all<{ id: number; q: number }>(
  `SELECT i.id, COALESCE((SELECT SUM(m.delta_milli) FROM stock_movements m WHERE m.item_id = i.id), 0) q
     FROM items i WHERE i.active = 1 AND i.sellable = 1 ORDER BY q ASC LIMIT 3`);
for (const r of standing) {
  run(`UPDATE items SET reorder_level_milli = ? WHERE id = ?`, Math.round(r.q * 1.2) + 1000, r.id);
}

const s = get<{ n: number; t: number }>(`SELECT COUNT(*) n, SUM(total_cents) t FROM sales WHERE status='completed'`)!;
const owed = get<{ t: number; c: number }>(
  `SELECT COALESCE(SUM(total_cents-paid_cents),0) t, COUNT(DISTINCT customer_id) c
     FROM sales WHERE total_cents > paid_cents`)!;
const neg = get<{ n: number }>(
  `SELECT COUNT(*) n FROM (SELECT i.id, COALESCE(SUM(m.delta_milli),0) q FROM items i
     LEFT JOIN stock_movements m ON m.item_id=i.id WHERE i.active=1 GROUP BY i.id) WHERE q < 0`)!;
console.log(`sales ${s.n}, turnover ${(s.t/100).toLocaleString()}`);
console.log(`owed ${(owed.t/100).toLocaleString()} by ${owed.c}; items below zero: ${neg.n}`);
