/**
 * Point-of-sale tests.
 *
 * RIZIKI_DB is pointed at a throwaway file BEFORE anything is imported, because
 * `db.ts` reads it at module load — importing first would open the shop's real
 * database, and these tests post stock movements that can never be deleted.
 *
 * The fixture is hand-built rather than seeded so the expected totals are
 * obvious at a glance: an 800-shilling sale really is 80000 cents.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "riziki-sales-")), "test.db");

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const { get, all, run, postMovement, stockOf } = await import("../src/lib/db.ts");
const { hashPin } = await import("../src/lib/pin.ts");
const {
  recordSale,
  voidSale,
  cartTotal,
  lineTotal,
  priceFor,
  creditStatus,
  customerOutstanding,
  authoriseOwnerPin,
  listSales,
  saleLinesFor,
  topSellerItemIds,
  SaleError,
} = await import("../src/lib/sales.ts");

// ------------------------------------------------------------------ fixture

const OWNER = 1;
const STAFF = 2;

run(`INSERT INTO users (id, name, role, pin_hash) VALUES (?, ?, 'owner', ?)`, OWNER, "Owner", hashPin("1234"));
run(`INSERT INTO users (id, name, role, pin_hash) VALUES (?, ?, 'staff', ?)`, STAFF, "Attendant", hashPin("1111"));

function makeItem(opts: {
  name: string;
  kind: "finished" | "pack" | "packaging";
  sizeMilli: number;
  retail: number;
  wholesale: number;
  floor: number;
  openingUnits?: number;
  sellable?: number;
}): number {
  const { lastInsertRowid: id } = run(
    `INSERT INTO items (name, kind, canonical_unit, size_milli, unit_label, sellable,
                        retail_cents, wholesale_cents, floor_cents, cost_cents)
     VALUES (?, ?, 'L', ?, 'bottle', ?, ?, ?, ?, ?)`,
    opts.name,
    opts.kind,
    opts.sizeMilli,
    opts.sellable ?? 1,
    opts.retail,
    opts.wholesale,
    opts.floor,
    opts.floor,
  );
  if (opts.openingUnits) {
    postMovement({
      itemId: id,
      deltaMilli: opts.openingUnits * opts.sizeMilli,
      reason: "opening",
      userId: OWNER,
    });
  }
  return id;
}

// KES 100 retail / KES 80 wholesale, 1 L bottle
const SOAP = makeItem({
  name: "Test Laundry Soap 1 L",
  kind: "finished",
  sizeMilli: 1000,
  retail: 10000,
  wholesale: 8000,
  floor: 7000,
  openingUnits: 50,
});

// KES 500 retail / KES 450 wholesale, 5 kg repack
const PACK = makeItem({
  name: "Test Ungerol — 5 kg",
  kind: "pack",
  sizeMilli: 5000,
  retail: 50000,
  wholesale: 45000,
  floor: 40000,
  openingUnits: 20,
});

// Priced so one unit is exactly the KES 800 sale the split-payment test needs.
const EIGHT_HUNDRED = makeItem({
  name: "Test Bundle 800",
  kind: "finished",
  sizeMilli: 1000,
  retail: 80000,
  wholesale: 80000,
  floor: 60000,
  openingUnits: 10,
});

const { lastInsertRowid: CUSTOMER } = run(
  `INSERT INTO customers (name, phone, kind, credit_limit_cents) VALUES (?, '', 'wholesale', ?)`,
  "Mama Njeri",
  100000, // KES 1,000 limit
);

function uuid(): string {
  return randomUUID();
}

// ------------------------------------------------------------- pure maths

test("cartTotal is the exact integer sum of unit_price × units", () => {
  assert.equal(lineTotal({ unitPriceCents: 10000, units: 2 }), 20000);
  assert.equal(
    cartTotal([
      { unitPriceCents: 10000, units: 2 },
      { unitPriceCents: 50000, units: 1 },
    ]),
    70000,
  );
  assert.throws(() => cartTotal([{ unitPriceCents: 10000, units: 1.5 }]), SaleError);
  assert.throws(() => cartTotal([{ unitPriceCents: 99.5, units: 1 }]), SaleError);
});

test("priceFor picks the tier price, falling back to retail when no wholesale is set", () => {
  assert.equal(priceFor({ retail_cents: 10000, wholesale_cents: 8000 }, "retail"), 10000);
  assert.equal(priceFor({ retail_cents: 10000, wholesale_cents: 8000 }, "wholesale"), 8000);
  assert.equal(priceFor({ retail_cents: 10000, wholesale_cents: 0 }, "wholesale"), 10000);
});

// -------------------------------------------------------------------- (a)

test("(a) a two-line sale totals exactly and drops stock by size_milli × units", () => {
  const soapBefore = stockOf(SOAP);
  const packBefore = stockOf(PACK);

  const result = recordSale({
    clientUuid: uuid(),
    userId: STAFF,
    tier: "retail",
    lines: [
      { itemId: SOAP, units: 2, unitPriceCents: 10000 },
      { itemId: PACK, units: 1, unitPriceCents: 50000 },
    ],
    tenders: [{ method: "cash", amountCents: 70000 }],
  });

  assert.equal(result.totalCents, 70000);
  assert.equal(result.paidCents, 70000);
  assert.equal(result.outstandingCents, 0);

  // The stored total must equal the sum of the stored lines.
  const sum = get<{ s: number }>(
    `SELECT SUM(line_total_cents) AS s FROM sale_lines WHERE sale_id = ?`,
    result.saleId,
  )!.s;
  assert.equal(sum, result.totalCents);

  assert.equal(stockOf(SOAP), soapBefore - 2 * 1000);
  assert.equal(stockOf(PACK), packBefore - 1 * 5000);

  // Prices and names are snapshotted, not re-joined.
  const lines = all<{ name_snapshot: string; unit_price_cents: number; qty_milli: number }>(
    `SELECT name_snapshot, unit_price_cents, qty_milli FROM sale_lines WHERE sale_id = ? ORDER BY id`,
    result.saleId,
  );
  assert.equal(lines[0].name_snapshot, "Test Laundry Soap 1 L");
  assert.equal(lines[0].unit_price_cents, 10000);
  assert.equal(lines[0].qty_milli, 2000);
  assert.equal(lines[1].qty_milli, 5000);
});

// -------------------------------------------------------------------- (b)

test("(b) the same cart costs less at wholesale than at retail", () => {
  const cart = [
    { itemId: SOAP, units: 2 },
    { itemId: PACK, units: 1 },
  ];

  const priced = (tier: "retail" | "wholesale") =>
    cart.map((c) => {
      const item = get<{ retail_cents: number; wholesale_cents: number }>(
        `SELECT retail_cents, wholesale_cents FROM items WHERE id = ?`,
        c.itemId,
      )!;
      return { itemId: c.itemId, units: c.units, unitPriceCents: priceFor(item, tier) };
    });

  const retailLines = priced("retail");
  const wholesaleLines = priced("wholesale");

  const retailTotal = cartTotal(retailLines);
  const wholesaleTotal = cartTotal(wholesaleLines);

  assert.equal(retailTotal, 70000);
  assert.equal(wholesaleTotal, 61000); // 2 × 8000 + 45000
  assert.ok(wholesaleTotal < retailTotal);

  const sale = recordSale({
    clientUuid: uuid(),
    userId: STAFF,
    tier: "wholesale",
    lines: wholesaleLines,
    tenders: [{ method: "cash", amountCents: wholesaleTotal }],
  });
  assert.equal(sale.totalCents, 61000);

  const row = get<{ tier: string }>(`SELECT tier FROM sales WHERE id = ?`, sale.saleId)!;
  assert.equal(row.tier, "wholesale");
});

// -------------------------------------------------------------------- (c)

test("(c) 300 cash + 500 M-Pesa fully covers an 800 sale and writes two payment rows", () => {
  const sale = recordSale({
    clientUuid: uuid(),
    userId: STAFF,
    tier: "retail",
    lines: [{ itemId: EIGHT_HUNDRED, units: 1, unitPriceCents: 80000 }],
    tenders: [
      { method: "cash", amountCents: 30000 },
      { method: "mpesa", amountCents: 50000, mpesaCode: "QGH7X1TEST" },
    ],
  });

  assert.equal(sale.totalCents, 80000);
  assert.equal(sale.paidCents, 80000);
  assert.equal(sale.outstandingCents, 0);

  const pays = all<{ method: string; amount_cents: number; mpesa_code: string | null }>(
    `SELECT method, amount_cents, mpesa_code FROM payments WHERE sale_id = ? ORDER BY id`,
    sale.saleId,
  );
  assert.equal(pays.length, 2);
  assert.deepEqual(
    pays.map((p) => [p.method, p.amount_cents]),
    [
      ["cash", 30000],
      ["mpesa", 50000],
    ],
  );
  assert.equal(pays[1].mpesa_code, "QGH7X1TEST");
});

// -------------------------------------------------------------------- (d)

test("(d) reusing an M-Pesa code is refused, and the second sale is not recorded", () => {
  const before = get<{ n: number }>(`SELECT COUNT(*) AS n FROM sales`)!.n;

  assert.throws(
    () =>
      recordSale({
        clientUuid: uuid(),
        userId: STAFF,
        tier: "retail",
        lines: [{ itemId: SOAP, units: 1, unitPriceCents: 10000 }],
        tenders: [{ method: "mpesa", amountCents: 10000, mpesaCode: "qgh7x1test" }],
      }),
    (err: unknown) =>
      err instanceof SaleError &&
      err.code === "mpesa_code_reused" &&
      /already been used/.test(err.message),
  );

  // The whole transaction rolled back — no orphan sale, no orphan stock move.
  assert.equal(get<{ n: number }>(`SELECT COUNT(*) AS n FROM sales`)!.n, before);

  // The same code twice inside ONE sale is refused too.
  assert.throws(
    () =>
      recordSale({
        clientUuid: uuid(),
        userId: STAFF,
        tier: "retail",
        lines: [{ itemId: SOAP, units: 1, unitPriceCents: 10000 }],
        tenders: [
          { method: "mpesa", amountCents: 5000, mpesaCode: "SAMECODE1" },
          { method: "mpesa", amountCents: 5000, mpesaCode: "SAMECODE1" },
        ],
      }),
    (err: unknown) => err instanceof SaleError && err.code === "mpesa_code_reused",
  );

  // And an M-Pesa tender with no code at all.
  assert.throws(
    () =>
      recordSale({
        clientUuid: uuid(),
        userId: STAFF,
        tier: "retail",
        lines: [{ itemId: SOAP, units: 1, unitPriceCents: 10000 }],
        tenders: [{ method: "mpesa", amountCents: 10000 }],
      }),
    (err: unknown) => err instanceof SaleError && err.code === "mpesa_code_required",
  );
});

// -------------------------------------------------------------------- (e)

test("(e) a part-payment leaves total − paid outstanding against the customer", () => {
  const owedBefore = customerOutstanding(CUSTOMER);

  const sale = recordSale({
    clientUuid: uuid(),
    userId: STAFF,
    tier: "retail",
    lines: [{ itemId: EIGHT_HUNDRED, units: 1, unitPriceCents: 80000 }],
    tenders: [{ method: "cash", amountCents: 30000 }],
    customerId: CUSTOMER,
  });

  assert.equal(sale.totalCents, 80000);
  assert.equal(sale.paidCents, 30000);
  assert.equal(sale.outstandingCents, 50000);

  const row = get<{ total_cents: number; paid_cents: number }>(
    `SELECT total_cents, paid_cents FROM sales WHERE id = ?`,
    sale.saleId,
  )!;
  assert.equal(row.total_cents - row.paid_cents, 50000);
  assert.equal(customerOutstanding(CUSTOMER), owedBefore + 50000);

  // An unpaid balance with nobody to chase is refused.
  assert.throws(
    () =>
      recordSale({
        clientUuid: uuid(),
        userId: STAFF,
        tier: "retail",
        lines: [{ itemId: SOAP, units: 1, unitPriceCents: 10000 }],
        tenders: [{ method: "cash", amountCents: 4000 }],
      }),
    (err: unknown) => err instanceof SaleError && err.code === "customer_required",
  );

  // A credit tender needs a named customer as well.
  assert.throws(
    () =>
      recordSale({
        clientUuid: uuid(),
        userId: STAFF,
        tier: "retail",
        lines: [{ itemId: SOAP, units: 1, unitPriceCents: 10000 }],
        tenders: [{ method: "credit", amountCents: 10000 }],
      }),
    (err: unknown) => err instanceof SaleError && err.code === "credit_needs_customer",
  );
});

test("credit tenders are debt, not takings, and the limit warns", () => {
  const sale = recordSale({
    clientUuid: uuid(),
    userId: STAFF,
    tier: "wholesale",
    lines: [{ itemId: PACK, units: 1, unitPriceCents: 45000 }],
    tenders: [{ method: "credit", amountCents: 45000 }],
    customerId: CUSTOMER,
  });
  assert.equal(sale.paidCents, 0);
  assert.equal(sale.outstandingCents, 45000);

  const status = creditStatus(CUSTOMER, 0)!;
  assert.equal(status.outstandingCents, 95000); // 50000 from (e) + 45000
  assert.equal(status.exceeds, false);

  const stretched = creditStatus(CUSTOMER, 20000)!;
  assert.equal(stretched.afterCents, 115000);
  assert.equal(stretched.exceeds, true); // limit is 100000
  assert.equal(stretched.needsApproval, true);
});

test("a customer with no limit agreed cannot take credit without the owner", () => {
  // This is the case that used to be silently unlimited: `exceeds` was only ever
  // true when a limit had been set, so a zero limit — the default every new
  // customer starts with — waved any amount through.
  const { lastInsertRowid: stranger } = run(
    `INSERT INTO customers (name, phone, kind, credit_limit_cents) VALUES (?, '', 'retail', 0)`,
    "Stranger With A Jerrican",
  );

  const status = creditStatus(Number(stranger), 500)!;
  assert.equal(status.limitCents, 0);
  assert.equal(status.noLimitAgreed, true);
  assert.equal(status.exceeds, false, "nothing to exceed — but that is not permission");
  assert.equal(status.needsApproval, true, "no agreed limit means the owner decides");

  // And a customer inside an agreed limit is still waved through, because most
  // of this shop's trade is exactly that and it must not need a PIN.
  const easy = creditStatus(CUSTOMER, 1000)!;
  assert.equal(easy.needsApproval, false);
});

// -------------------------------------------------------------------- (f)

test("(f) voiding returns stock exactly and keeps the sale row, marked voided", () => {
  const soapBefore = stockOf(SOAP);
  const packBefore = stockOf(PACK);

  const sale = recordSale({
    clientUuid: uuid(),
    userId: STAFF,
    tier: "retail",
    lines: [
      { itemId: SOAP, units: 3, unitPriceCents: 10000 },
      { itemId: PACK, units: 2, unitPriceCents: 50000 },
    ],
    tenders: [{ method: "cash", amountCents: 130000 }],
  });

  assert.equal(stockOf(SOAP), soapBefore - 3000);
  assert.equal(stockOf(PACK), packBefore - 10000);

  voidSale(sale.saleId, OWNER, "customer changed their mind");

  assert.equal(stockOf(SOAP), soapBefore);
  assert.equal(stockOf(PACK), packBefore);

  const row = get<{
    id: number;
    status: string;
    void_reason: string;
    voided_by: number;
    voided_at: string;
    total_cents: number;
  }>(`SELECT id, status, void_reason, voided_by, voided_at, total_cents FROM sales WHERE id = ?`, sale.saleId);
  assert.ok(row, "the voided sale row must still exist");
  assert.equal(row!.status, "voided");
  assert.equal(row!.void_reason, "customer changed their mind");
  assert.equal(row!.voided_by, OWNER);
  assert.ok(row!.voided_at);
  assert.equal(row!.total_cents, 130000);

  // The return is a compensating ledger entry, not an edit.
  const returns = all<{ delta_milli: number; reason: string }>(
    `SELECT delta_milli, reason FROM stock_movements WHERE ref_type = 'sale' AND ref_id = ? AND reason = 'sale_void'`,
    sale.saleId,
  );
  assert.equal(returns.length, 2);
  assert.deepEqual(
    returns.map((r) => r.delta_milli).sort((a, b) => a - b),
    [3000, 10000],
  );

  // Voiding twice is refused rather than double-returning stock.
  assert.throws(
    () => voidSale(sale.saleId, OWNER, "again"),
    (err: unknown) => err instanceof SaleError && err.code === "already_voided",
  );

  // A void with no reason is refused.
  assert.throws(
    () => voidSale(sale.saleId, OWNER, "   "),
    (err: unknown) => err instanceof SaleError && err.code === "reason_required",
  );
});

// -------------------------------------------------------------------- (g)

test("(g) replaying the same client_uuid does not create a second sale", () => {
  const id = uuid();
  const payload = {
    clientUuid: id,
    userId: STAFF,
    tier: "retail" as const,
    lines: [{ itemId: SOAP, units: 1, unitPriceCents: 10000 }],
    tenders: [{ method: "cash" as const, amountCents: 10000 }],
  };

  const stockBefore = stockOf(SOAP);
  const first = recordSale(payload);
  const stockAfterFirst = stockOf(SOAP);
  const second = recordSale(payload);

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.saleId, first.saleId);
  assert.equal(second.totalCents, first.totalCents);

  assert.equal(get<{ n: number }>(`SELECT COUNT(*) AS n FROM sales WHERE client_uuid = ?`, id)!.n, 1);
  assert.equal(
    get<{ n: number }>(`SELECT COUNT(*) AS n FROM payments WHERE sale_id = ?`, first.saleId)!.n,
    1,
  );
  // Crucially the replay must not deduct stock a second time.
  assert.equal(stockAfterFirst, stockBefore - 1000);
  assert.equal(stockOf(SOAP), stockBefore - 1000);
});

// ------------------------------------------------------- haggling & floors

test("a price below the floor is refused for staff and allowed with owner approval", () => {
  assert.throws(
    () =>
      recordSale({
        clientUuid: uuid(),
        userId: STAFF,
        tier: "retail",
        lines: [{ itemId: SOAP, units: 1, unitPriceCents: 6000 }], // floor is 7000
        tenders: [{ method: "cash", amountCents: 6000 }],
      }),
    (err: unknown) => err instanceof SaleError && err.code === "below_floor",
  );

  // Down to the floor exactly needs nobody's permission.
  const haggled = recordSale({
    clientUuid: uuid(),
    userId: STAFF,
    tier: "retail",
    lines: [{ itemId: SOAP, units: 1, unitPriceCents: 7000 }],
    tenders: [{ method: "cash", amountCents: 7000 }],
  });
  assert.equal(haggled.totalCents, 7000);

  const ownerId = authoriseOwnerPin("1234");
  assert.equal(ownerId, OWNER);
  assert.equal(authoriseOwnerPin("9999"), null);
  assert.equal(authoriseOwnerPin("1111"), null); // the attendant's PIN is not an approval

  const approved = recordSale({
    clientUuid: uuid(),
    userId: STAFF,
    tier: "retail",
    lines: [{ itemId: SOAP, units: 1, unitPriceCents: 6000 }],
    tenders: [{ method: "cash", amountCents: 6000 }],
    floorOverrideBy: ownerId,
  });
  assert.equal(approved.totalCents, 6000);

  const entry = get<{ action: string; detail: string }>(
    `SELECT action, detail FROM audit_log WHERE entity = 'sale_line' AND entity_id = ? ORDER BY id DESC LIMIT 1`,
    approved.saleId,
  );
  assert.ok(entry, "a below-floor override must be audited");
  assert.equal(entry!.action, "price_override_below_floor");
  assert.match(entry!.detail, /KES 100 → KES 60/);
  assert.match(entry!.detail, new RegExp(`authorised by user ${OWNER}`));
});

test("overpaying is refused so paid_cents can never exceed the sale", () => {
  assert.throws(
    () =>
      recordSale({
        clientUuid: uuid(),
        userId: STAFF,
        tier: "retail",
        lines: [{ itemId: SOAP, units: 1, unitPriceCents: 10000 }],
        tenders: [{ method: "cash", amountCents: 15000 }],
      }),
    (err: unknown) => err instanceof SaleError && err.code === "overpaid",
  );
});

test("an empty cart is refused", () => {
  assert.throws(
    () => recordSale({ clientUuid: uuid(), userId: STAFF, tier: "retail", lines: [], tenders: [] }),
    (err: unknown) => err instanceof SaleError && err.code === "empty_cart",
  );
});

// -------------------------------------------------------------- history

test("listSales pages newest first and never returns the whole table", () => {
  const first = listSales(1, 3);
  assert.equal(first.rows.length, 3);
  assert.ok(first.total > 3);
  assert.ok(first.pages > 1);
  assert.ok(first.rows[0].id > first.rows[2].id, "newest sale must come first");

  const second = listSales(2, 3);
  assert.equal(second.page, 2);
  assert.ok(second.rows.every((r) => !first.rows.some((f) => f.id === r.id)));

  // Out-of-range pages clamp instead of returning nothing.
  assert.equal(listSales(9999, 3).page, first.pages);

  const voided = listSales(1, 100).rows.find((r) => r.status === "voided");
  assert.ok(voided, "voided sales stay visible in history");
  assert.ok(voided!.void_reason);

  const split = listSales(1, 100).rows.find((r) => (r.methods ?? "").includes(","));
  assert.ok(split, "a split payment shows both methods");

  // Lines for a whole page come back in one query, not one per sale.
  const ids = first.rows.map((r) => r.id);
  const pageLines = saleLinesFor(ids);
  assert.ok(pageLines.length >= ids.length);
  assert.ok(pageLines.every((l) => ids.includes(l.sale_id)));
  assert.deepEqual(saleLinesFor([]), []);
});

test("top sellers come from the shop's own day and fall back to the week", () => {
  const top = topSellerItemIds(6);
  assert.ok(top.length > 0, "the grid needs a top-sellers row to shortcut");
  assert.ok(top.length <= 6);
  assert.equal(top[0], SOAP, "the most-sold item leads the row");
  assert.ok(new Set(top).size === top.length, "no item appears twice");
});
