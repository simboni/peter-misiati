/**
 * Offline outbox tests.
 *
 * RIZIKI_DB is pointed at a throwaway file BEFORE anything is imported, because
 * `db.ts` reads it at module load — importing first would open the shop's real
 * database, and a replayed sale posts stock movements that can never be deleted.
 *
 * The browser half (IndexedDB) is not exercised here; everything that decides
 * whether money is recorded, dropped or kept lives in the pure functions, which
 * is exactly why they are pure.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "riziki-offline-")), "test.db");

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Type-only, so it is erased before Node ever loads the module and cannot
// reopen the database ahead of RIZIKI_DB being set.
import type { QueuedSale, QueuedSalePayload } from "../src/lib/offline.ts";

const { get, all, run, postMovement, stockOf } = await import("../src/lib/db.ts");
const { hashPin } = await import("../src/lib/pin.ts");
const { recordSale, authoriseOwnerPin } = await import("../src/lib/sales.ts");
const {
  OutboxError,
  applySyncResults,
  parseQueue,
  parseQueuedSale,
  serialiseQueue,
  sortOldestFirst,
  summariseOutcomes,
  syncQueuedSales,
  toWire,
} = await import("../src/lib/offline.ts");

// ------------------------------------------------------------------ fixture

const OWNER = 1;
const STAFF = 2;

run(`INSERT INTO users (id, name, role, pin_hash) VALUES (?, ?, 'owner', ?)`, OWNER, "Owner", hashPin("1234"));
run(`INSERT INTO users (id, name, role, pin_hash) VALUES (?, ?, 'staff', ?)`, STAFF, "Attendant", hashPin("1111"));

function makeItem(name: string, retail: number, floor: number, openingUnits: number): number {
  const { lastInsertRowid: id } = run(
    `INSERT INTO items (name, kind, canonical_unit, size_milli, unit_label, sellable,
                        retail_cents, wholesale_cents, floor_cents, cost_cents)
     VALUES (?, 'finished', 'L', 1000, 'bottle', 1, ?, ?, ?, ?)`,
    name,
    retail,
    retail,
    floor,
    floor,
  );
  postMovement({ itemId: id, deltaMilli: openingUnits * 1000, reason: "opening", userId: OWNER });
  return id;
}

// KES 123.45 exactly — an amount that only survives if nothing ever turns it
// into a float on the way through the queue.
const ODD = makeItem("Test Odd-Priced 1 L", 12345, 9000, 200);
const SOAP = makeItem("Test Offline Soap 1 L", 10000, 7000, 200);

const { lastInsertRowid: CUSTOMER } = run(
  `INSERT INTO customers (name, phone, kind, credit_limit_cents) VALUES (?, '', 'wholesale', ?)`,
  "Mama Njeri",
  10_000_000,
);

/** A sale exactly as the counter would put it in the outbox. */
function queued(over: Partial<QueuedSalePayload> = {}): QueuedSalePayload {
  const lines = over.lines ?? [{ itemId: SOAP, units: 2, unitPriceCents: 10000 }];
  const totalCents = lines.reduce((s, l) => s + l.unitPriceCents * l.units, 0);
  return {
    clientUuid: randomUUID(),
    tier: "retail",
    lines,
    tenders: [{ method: "cash", amountCents: totalCents }],
    customerId: null,
    queuedAt: "2026-08-03T09:15:00.000Z",
    totalCents,
    ...over,
    ...(over.lines ? { lines, totalCents: over.totalCents ?? totalCents } : {}),
  };
}

function sync(sales: unknown[], floorOverrideBy: number | null = null) {
  return syncQueuedSales(sales, { userId: STAFF, record: recordSale, floorOverrideBy });
}

function saleCount(clientUuid: string): number {
  return get<{ n: number }>(`SELECT COUNT(*) AS n FROM sales WHERE client_uuid = ?`, clientUuid)!.n;
}

// -------------------------------------------------------------------- (a)

test("(a) replaying the same queued sale twice records exactly one sale", () => {
  const sale = queued({ lines: [{ itemId: SOAP, units: 3, unitPriceCents: 10000 }] });
  const stockBefore = stockOf(SOAP);

  const first = sync([sale]);
  assert.equal(first.length, 1);
  assert.equal(first[0].status, "accepted");
  assert.equal(first[0].index, 0);
  assert.equal(first[0].clientUuid, sale.clientUuid);
  assert.equal(first[0].totalCents, 30000);

  const stockAfterFirst = stockOf(SOAP);
  assert.equal(stockAfterFirst, stockBefore - 3000);

  // The device never heard the first answer, so it sends the very same row again.
  const second = sync([sale]);
  assert.equal(second[0].status, "duplicate");
  assert.equal(second[0].saleId, first[0].saleId);
  assert.equal(second[0].totalCents, first[0].totalCents);

  // One sale row, one set of payments, and — the dangerous one — stock deducted
  // once, not twice.
  assert.equal(saleCount(sale.clientUuid), 1);
  assert.equal(
    get<{ n: number }>(`SELECT COUNT(*) AS n FROM payments WHERE sale_id = ?`, first[0].saleId!)!.n,
    1,
  );
  assert.equal(stockOf(SOAP), stockAfterFirst);

  // And a third time, because a bad morning replays more than twice.
  assert.equal(sync([sale])[0].status, "duplicate");
  assert.equal(saleCount(sale.clientUuid), 1);
  assert.equal(stockOf(SOAP), stockAfterFirst);
});

test("(a2) a duplicate settles out of the queue exactly like an acceptance", () => {
  const sale = queued();
  const row: QueuedSale = { ...sale, seq: 1, attempts: 1, lastError: null };

  sync([toWire(row)]);
  const results = sync([toWire(row)]);
  assert.equal(results[0].status, "duplicate");

  const settlement = applySyncResults([row], results);
  assert.equal(settlement.drop.length, 1, "an already-recorded sale must leave the queue");
  assert.equal(settlement.keep.length, 0);
});

// -------------------------------------------------------------------- (b)

test("(b) one malformed sale in a batch does not cost the good ones", () => {
  const good1 = queued({ lines: [{ itemId: SOAP, units: 1, unitPriceCents: 10000 }] });
  const good2 = queued({ lines: [{ itemId: ODD, units: 2, unitPriceCents: 12345 }] });

  // Half a unit of soap: the kind of thing only a corrupted row produces.
  const broken = { ...queued(), lines: [{ itemId: SOAP, units: 1.5, unitPriceCents: 10000 }] };
  // A sale for an item that no longer exists.
  const missing = queued({ lines: [{ itemId: 999_999, units: 1, unitPriceCents: 10000 }] });
  // Not an object at all.
  const rubbish = "not a sale";

  const before = get<{ n: number }>(`SELECT COUNT(*) AS n FROM sales`)!.n;
  const results = sync([good1, broken, good2, missing, rubbish]);

  assert.equal(results.length, 5);
  assert.deepEqual(
    results.map((r) => r.status),
    ["accepted", "failed", "accepted", "failed", "failed"],
  );
  assert.deepEqual(
    results.map((r) => r.index),
    [0, 1, 2, 3, 4],
  );

  // Both good sales landed; the two bad ones wrote nothing at all.
  assert.equal(get<{ n: number }>(`SELECT COUNT(*) AS n FROM sales`)!.n, before + 2);
  assert.equal(saleCount(good1.clientUuid), 1);
  assert.equal(saleCount(good2.clientUuid), 1);
  assert.equal(saleCount(broken.clientUuid), 0);
  assert.equal(saleCount(missing.clientUuid), 0);

  // Each failure carries a reason the counter can read, and an actionable code.
  assert.equal(results[1].code, "bad_units");
  assert.equal(results[3].code, "unknown_item");
  assert.ok(results[1].error && results[1].error.length > 0);

  // A sale too broken to name itself is still answered, by position.
  assert.equal(results[4].clientUuid, "");
  assert.equal(results[4].index, 4);

  assert.deepEqual(summariseOutcomes(results), { accepted: 2, duplicate: 0, failed: 3 });

  // The queue keeps the failures — with the reason — and forgets the rest.
  const batch: QueuedSale[] = [good1, broken as QueuedSalePayload, good2, missing, rubbish].map(
    (s, i) =>
      ({
        ...(typeof s === "object" ? s : queued()),
        seq: i,
        attempts: 0,
        lastError: null,
      }) as QueuedSale,
  );
  const settlement = applySyncResults(batch, results);
  assert.equal(settlement.drop.length, 2);
  assert.equal(settlement.keep.length, 3);
  assert.ok(settlement.keep.every((s) => s.lastError && s.attempts === 1));
});

test("(b2) a refused sale stays queued with its reason, and clears once approved", () => {
  // Haggled below the floor while the line was down. The counter never sees
  // `floor_cents`, so this can only be caught here.
  const sale = queued({ lines: [{ itemId: SOAP, units: 1, unitPriceCents: 6000 }] });

  const refused = sync([sale]);
  assert.equal(refused[0].status, "failed");
  assert.equal(refused[0].code, "below_floor");
  assert.equal(saleCount(sale.clientUuid), 0);

  const row: QueuedSale = { ...sale, seq: 10, attempts: 0, lastError: null };
  const kept = applySyncResults([row], refused).keep;
  assert.equal(kept.length, 1);
  assert.match(kept[0].lastError!, /below the minimum price/);

  // The owner types their PIN at send time — it was never stored on the phone.
  const ownerId = authoriseOwnerPin("1234");
  assert.equal(ownerId, OWNER);

  const approved = sync([toWire(kept[0])], ownerId);
  assert.equal(approved[0].status, "accepted");
  assert.equal(saleCount(sale.clientUuid), 1);
  assert.equal(applySyncResults(kept, approved).drop.length, 1);
});

// -------------------------------------------------------------------- (c)

test("(c) the queued payload round-trips exactly — integer cents in, same cents stored", () => {
  const sale = queued({
    lines: [
      { itemId: ODD, units: 3, unitPriceCents: 12345 },
      { itemId: SOAP, units: 1, unitPriceCents: 9999 },
    ],
    tenders: [
      { method: "cash", amountCents: 100 },
      { method: "credit", amountCents: 46934 },
    ],
    customerId: CUSTOMER,
  });
  assert.equal(sale.totalCents, 12345 * 3 + 9999); // 47034

  // Through JSON, exactly as IndexedDB and the network would carry it.
  const overTheWire: unknown = JSON.parse(JSON.stringify(toWire(sale)));
  const parsed = parseQueuedSale(overTheWire);
  assert.deepEqual(parsed, sale);

  const results = sync([overTheWire]);
  assert.equal(results[0].status, "accepted");
  assert.equal(results[0].totalCents, 47034);

  const stored = all<{ unit_price_cents: number; units: number; line_total_cents: number }>(
    `SELECT unit_price_cents, units, line_total_cents FROM sale_lines WHERE sale_id = ? ORDER BY id`,
    results[0].saleId!,
  );
  assert.deepEqual(stored, [
    { unit_price_cents: 12345, units: 3, line_total_cents: 37035 },
    { unit_price_cents: 9999, units: 1, line_total_cents: 9999 },
  ]);
  assert.ok(stored.every((l) => Number.isInteger(l.unit_price_cents)));

  const head = get<{ total_cents: number; paid_cents: number; note: string }>(
    `SELECT total_cents, paid_cents, note FROM sales WHERE id = ?`,
    results[0].saleId!,
  )!;
  assert.equal(head.total_cents, 47034);
  assert.equal(head.paid_cents, 100, "credit is debt, not takings — even when it arrives late");
  assert.match(head.note, /Offline sale, taken 2026-08-03T09:15:00\.000Z/);
});

test("(c2) a payload whose total disagrees with its lines is refused, not re-priced", () => {
  // The one corruption that could quietly change what a customer was charged.
  const tampered = { ...queued(), totalCents: 1 };
  const results = sync([tampered]);
  assert.equal(results[0].status, "failed");
  assert.equal(results[0].code, "bad_price");
  assert.equal(saleCount(tampered.clientUuid), 0);

  assert.throws(() => parseQueuedSale(tampered), OutboxError);
});

// -------------------------------------------------------------------- (d)

test("(d) validation refuses everything that is not a whole-cent, whole-unit sale", () => {
  const base = queued();
  const bad: [string, unknown][] = [
    ["not an object", 42],
    ["no uuid", { ...base, clientUuid: "  " }],
    ["no tier", { ...base, tier: "trade" }],
    ["empty cart", { ...base, lines: [], totalCents: 0 }],
    ["fractional cents", { ...base, lines: [{ itemId: SOAP, units: 1, unitPriceCents: 99.5 }] }],
    ["negative price", { ...base, lines: [{ itemId: SOAP, units: 1, unitPriceCents: -100 }] }],
    ["zero units", { ...base, lines: [{ itemId: SOAP, units: 0, unitPriceCents: 100 }] }],
    ["unknown tender", { ...base, tenders: [{ method: "barter", amountCents: 100 }] }],
    ["fractional tender", { ...base, tenders: [{ method: "cash", amountCents: 10.5 }] }],
    ["impossible customer", { ...base, customerId: -3 }],
  ];

  for (const [why, value] of bad) {
    assert.throws(() => parseQueuedSale(value), OutboxError, `${why} must be refused`);
  }

  // And the good one survives untouched, including a trimmed M-Pesa code.
  const withCode = parseQueuedSale({
    ...base,
    tenders: [{ method: "mpesa", amountCents: base.totalCents, mpesaCode: "  QGH7X1OFF  " }],
  });
  assert.equal(withCode.tenders[0].mpesaCode, "QGH7X1OFF");
  assert.equal(withCode.totalCents, base.totalCents);
});

test("(d2) the outbox drains oldest first and survives serialisation", () => {
  const rows: QueuedSale[] = [
    { ...queued(), clientUuid: "c", seq: 300, attempts: 0, lastError: null },
    { ...queued(), clientUuid: "a", seq: 100, attempts: 2, lastError: "The till did not answer." },
    { ...queued(), clientUuid: "b", seq: 200, attempts: 0, lastError: null },
    // Two sales taken in the same millisecond still have a stable order.
    { ...queued(), clientUuid: "b2", seq: 200, attempts: 0, lastError: null },
  ];

  assert.deepEqual(
    sortOldestFirst(rows).map((r) => r.clientUuid),
    ["a", "b", "b2", "c"],
  );
  // Sorting must not mutate the caller's array — the pill re-renders from it.
  assert.equal(rows[0].clientUuid, "c");

  const restored = parseQueue(serialiseQueue(rows));
  assert.deepEqual(
    restored.map((r) => r.clientUuid),
    ["a", "b", "b2", "c"],
  );
  assert.equal(restored[0].attempts, 2);
  assert.equal(restored[0].lastError, "The till did not answer.");
  assert.equal(restored[0].totalCents, rows[1].totalCents);

  // `toWire` sheds the device-only bookkeeping so it can never reach the till.
  const wire = toWire(restored[0]) as unknown as Record<string, unknown>;
  assert.equal(wire.attempts, undefined);
  assert.equal(wire.seq, undefined);
  assert.equal(wire.lastError, undefined);
});

test("(d3) an unanswered sale is kept, never dropped", () => {
  const rows: QueuedSale[] = [
    { ...queued(), clientUuid: "x", seq: 1, attempts: 0, lastError: null },
    { ...queued(), clientUuid: "y", seq: 2, attempts: 0, lastError: null },
  ];

  // A truncated reply: the second sale has no verdict at all.
  const settlement = applySyncResults(rows, [
    { index: 0, clientUuid: "x", status: "accepted", saleId: 1 },
  ]);
  assert.deepEqual(settlement.drop.map((s) => s.clientUuid), ["x"]);
  assert.deepEqual(settlement.keep.map((s) => s.clientUuid), ["y"]);

  // A reply whose uuid does not match the slot it claims is not trusted either.
  const mismatched = applySyncResults(rows, [
    { index: 0, clientUuid: "somebody-else", status: "accepted", saleId: 2 },
  ]);
  assert.equal(mismatched.drop.length, 0);
  assert.equal(mismatched.keep.length, 2);
});

test("(d4) an empty batch is a no-op, not an error", () => {
  assert.deepEqual(sync([]), []);
  assert.deepEqual(syncQueuedSales(null, { userId: STAFF, record: recordSale }), []);
  assert.deepEqual(applySyncResults([], []), { drop: [], keep: [] });
});
