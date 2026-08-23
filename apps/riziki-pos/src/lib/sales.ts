/**
 * Sales — the money path.
 *
 * Everything here is deliberately framework-free so it can be unit tested under
 * plain Node. The screens in `src/app/sell` and `src/app/sales` are thin: they
 * collect taps and hand a plain object to `recordSale`.
 *
 * Three decisions are worth explaining, because they shape the whole module:
 *
 *  1. A sale carries a `client_uuid` minted on the device. Recording the same
 *     uuid twice returns the sale already stored instead of charging the
 *     customer twice. That is what makes a retry over the shop's flaky Wi-Fi —
 *     and, later, an offline replay — safe.
 *
 *  2. `paid_cents` counts cash and M-Pesa only. A `credit` tender is money the
 *     shop has *not* received, so the debt is exactly `total_cents - paid_cents`
 *     and the debtors report needs no special cases.
 *
 *  3. Prices are snapshotted onto `sale_lines`. Nothing here ever re-joins
 *     `items` for a price, so tomorrow's price rise cannot rewrite today's till.
 */

import { all, get, run, tx, postMovement, audit, type Item } from "./db.ts";
import { verifyPin } from "./pin.ts";
import { formatKes } from "./units.ts";

export type Tier = "retail" | "wholesale";
export type PayMethod = "cash" | "mpesa" | "credit";

/** Kinds that move physical stock when sold. */
const CARRIES_STOCK: ReadonlySet<Item["kind"]> = new Set<Item["kind"]>(["finished", "pack"]);

export const SALES_PAGE_SIZE = 20;

// ------------------------------------------------------------------- errors

export type SaleErrorCode =
  | "bad_request"
  | "empty_cart"
  | "bad_units"
  | "bad_price"
  | "unknown_item"
  | "below_floor"
  | "bad_amount"
  | "mpesa_code_required"
  | "mpesa_code_reused"
  | "credit_needs_customer"
  | "customer_required"
  | "overpaid"
  | "not_found"
  | "already_voided"
  | "reason_required";

/**
 * A refusal the counter can act on, as opposed to a bug. The screens switch on
 * `code`; the message is already phrased for the person holding the phone.
 */
export class SaleError extends Error {
  readonly code: SaleErrorCode;
  constructor(code: SaleErrorCode, message: string) {
    super(message);
    this.name = "SaleError";
    this.code = code;
  }
}

// ------------------------------------------------------- pure price maths

export interface PricedItem {
  retail_cents: number;
  wholesale_cents: number;
}

/**
 * The list price for a tier.
 *
 * An item with no wholesale price set falls back to retail rather than to zero —
 * flipping the tier toggle must never hand goods over for free.
 */
export function priceFor(item: PricedItem, tier: Tier): number {
  if (tier === "wholesale" && item.wholesale_cents > 0) return item.wholesale_cents;
  return item.retail_cents;
}

export interface CartLine {
  unitPriceCents: number;
  units: number;
}

/** `unit_price_cents × units`, in integer cents. */
export function lineTotal(line: CartLine): number {
  if (!Number.isInteger(line.units) || line.units <= 0) {
    throw new SaleError("bad_units", "A line must have a whole number of units.");
  }
  if (!Number.isInteger(line.unitPriceCents) || line.unitPriceCents < 0) {
    throw new SaleError("bad_price", "A price must be a whole number of cents.");
  }
  return line.unitPriceCents * line.units;
}

/** The order total is the sum of its lines. Nothing else is ever the total. */
export function cartTotal(lines: readonly CartLine[]): number {
  return lines.reduce((sum, line) => sum + lineTotal(line), 0);
}

// --------------------------------------------------------------- recording

export interface SaleLineInput {
  itemId: number;
  units: number;
  /** Snapshotted as-is. May be below the list price after haggling. */
  unitPriceCents: number;
}

export interface TenderInput {
  method: PayMethod;
  amountCents: number;
  mpesaCode?: string | null;
}

export interface RecordSaleInput {
  /** Minted on the device with crypto.randomUUID(). Replay-safe. */
  clientUuid: string;
  userId: number;
  tier: Tier;
  lines: SaleLineInput[];
  tenders: TenderInput[];
  customerId?: number | null;
  note?: string;
  /** The owner who authorised any below-floor line price. */
  floorOverrideBy?: number | null;
}

export interface RecordSaleResult {
  saleId: number;
  totalCents: number;
  paidCents: number;
  outstandingCents: number;
  /** True when this uuid had already been recorded and nothing new was written. */
  duplicate: boolean;
}

interface ResolvedLine {
  item: Item;
  units: number;
  unitPriceCents: number;
  qtyMilli: number;
  lineTotalCents: number;
  listPriceCents: number;
}

export function recordSale(input: RecordSaleInput): RecordSaleResult {
  const clientUuid = (input.clientUuid ?? "").trim();
  if (!clientUuid) throw new SaleError("bad_request", "This sale has no device reference.");
  if (!input.lines.length) throw new SaleError("empty_cart", "Add an item before taking payment.");

  return tx(() => {
    // Idempotency first: BEGIN IMMEDIATE already holds the write lock, so this
    // lookup cannot race another device replaying the same sale.
    const existing = get<{ id: number; total_cents: number; paid_cents: number }>(
      `SELECT id, total_cents, paid_cents FROM sales WHERE client_uuid = ?`,
      clientUuid,
    );
    if (existing) {
      return {
        saleId: existing.id,
        totalCents: existing.total_cents,
        paidCents: existing.paid_cents,
        outstandingCents: existing.total_cents - existing.paid_cents,
        duplicate: true,
      };
    }

    const lines = resolveLines(input);
    const totalCents = cartTotal(lines.map((l) => ({ unitPriceCents: l.unitPriceCents, units: l.units })));

    const tenders = normaliseTenders(input.tenders);
    const tenderedCents = tenders.reduce((s, t) => s + t.amountCents, 0);
    if (tenderedCents > totalCents) {
      throw new SaleError(
        "overpaid",
        `Payments come to ${formatKes(tenderedCents)} but the sale is ${formatKes(totalCents)}.`,
      );
    }

    const customerId = input.customerId ?? null;
    if (tenders.some((t) => t.method === "credit") && !customerId) {
      throw new SaleError("credit_needs_customer", "Choose the customer taking this on credit.");
    }

    // Cash and M-Pesa are money in hand. Credit is not — so it never counts here.
    const paidCents = tenders
      .filter((t) => t.method !== "credit")
      .reduce((s, t) => s + t.amountCents, 0);
    const outstandingCents = totalCents - paidCents;
    if (outstandingCents > 0 && !customerId) {
      throw new SaleError(
        "customer_required",
        `${formatKes(outstandingCents)} is unpaid — choose the customer who owes it.`,
      );
    }

    const { lastInsertRowid: saleId } = run(
      `INSERT INTO sales (client_uuid, user_id, customer_id, tier, total_cents, paid_cents, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      clientUuid,
      input.userId,
      customerId,
      input.tier,
      totalCents,
      paidCents,
      input.note ?? "",
    );

    for (const l of lines) {
      run(
        `INSERT INTO sale_lines (sale_id, item_id, name_snapshot, units, qty_milli,
                                 unit_price_cents, line_total_cents, cost_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        saleId,
        l.item.id,
        l.item.name,
        l.units,
        l.qtyMilli,
        l.unitPriceCents,
        l.lineTotalCents,
        l.item.cost_cents * l.units,
      );

      // Racing devices may both sell the last bottle. The customer is already
      // holding it, so the sale is allowed through — but the ledger records the
      // move either way, which is what turns a phantom into a visible negative.
      if (CARRIES_STOCK.has(l.item.kind)) {
        postMovement({
          itemId: l.item.id,
          deltaMilli: -l.qtyMilli,
          reason: "sale",
          refType: "sale",
          refId: saleId,
          userId: input.userId,
          note: `${l.units} × ${l.item.unit_label}`,
        });
      }

      if (l.unitPriceCents !== l.listPriceCents) {
        const belowFloor = l.unitPriceCents < l.item.floor_cents;
        audit(
          input.userId,
          belowFloor ? "price_override_below_floor" : "price_discount",
          "sale_line",
          saleId,
          `${l.item.name}: ${formatKes(l.listPriceCents)} → ${formatKes(l.unitPriceCents)}` +
            (belowFloor ? ` (below floor, authorised by user ${input.floorOverrideBy})` : ""),
        );
      }
    }

    // The total must equal the sum of what was actually written, not the sum we
    // hoped to write. A mismatch rolls the whole sale back.
    const stored = get<{ sum: number }>(
      `SELECT COALESCE(SUM(line_total_cents), 0) AS sum FROM sale_lines WHERE sale_id = ?`,
      saleId,
    );
    if ((stored?.sum ?? -1) !== totalCents) {
      throw new Error("sale total does not equal the sum of its lines");
    }

    for (const t of tenders) {
      insertPayment(saleId, t, input.userId);
    }

    return { saleId, totalCents, paidCents, outstandingCents, duplicate: false };
  });
}

function resolveLines(input: RecordSaleInput): ResolvedLine[] {
  return input.lines.map((line) => {
    const item = get<Item>(`SELECT * FROM items WHERE id = ? AND active = 1`, line.itemId);
    if (!item) throw new SaleError("unknown_item", "That item is no longer on sale.");
    if (!item.sellable) throw new SaleError("unknown_item", `${item.name} is not sold over the counter.`);

    if (!Number.isInteger(line.units) || line.units <= 0) {
      throw new SaleError("bad_units", `How many ${item.unit_label}s of ${item.name}?`);
    }
    if (!Number.isInteger(line.unitPriceCents) || line.unitPriceCents < 0) {
      throw new SaleError("bad_price", `The price for ${item.name} is not a valid amount.`);
    }

    // The floor is never sent to the counter — for repacked chemicals it equals
    // the cost price, and staff must not see cost. The price is offered, the
    // server refuses it, and only then is the owner's PIN asked for.
    if (line.unitPriceCents < item.floor_cents && !input.floorOverrideBy) {
      throw new SaleError(
        "below_floor",
        `${item.name} at ${formatKes(line.unitPriceCents)} is below the minimum price. The owner must approve it.`,
      );
    }

    return {
      item,
      units: line.units,
      unitPriceCents: line.unitPriceCents,
      qtyMilli: item.size_milli * line.units,
      lineTotalCents: line.unitPriceCents * line.units,
      listPriceCents: priceFor(item, input.tier),
    };
  });
}

interface NormalTender {
  method: PayMethod;
  amountCents: number;
  mpesaCode: string | null;
}

function normaliseTenders(tenders: readonly TenderInput[]): NormalTender[] {
  const seen = new Set<string>();

  return tenders.map((t) => {
    if (!Number.isInteger(t.amountCents) || t.amountCents <= 0) {
      throw new SaleError("bad_amount", "Enter how much is being paid.");
    }
    if (t.method !== "cash" && t.method !== "mpesa" && t.method !== "credit") {
      throw new SaleError("bad_request", "Unknown payment method.");
    }

    let mpesaCode: string | null = null;
    if (t.method === "mpesa") {
      /*
        The code is wanted, not demanded.

        Insisting on it stopped sales: the SMS arrives late, or on the customer's
        phone, or the attendant is looking at a Till confirmation on a screen
        across the counter — and none of that is a reason the shop should be
        unable to record money it has been paid. An unreferenced M-Pesa payment
        is a reconciliation chore; a sale that could not be entered is a hole in
        the day's takings and in the stock count both.

        When a code is given it is still upper-cased and still unique, so the
        protection that matters — one SMS cannot pay two bills — is unchanged.
      */
      mpesaCode = (t.mpesaCode ?? "").trim().toUpperCase() || null;
      if (mpesaCode && seen.has(mpesaCode)) {
        throw new SaleError("mpesa_code_reused", "That M-Pesa code has already been used.");
      }
      if (mpesaCode) seen.add(mpesaCode);
    }

    return { method: t.method, amountCents: t.amountCents, mpesaCode };
  });
}

function insertPayment(saleId: number, t: NormalTender, userId: number): void {
  if (t.mpesaCode) {
    // Checked here for a clean message; the unique index below is what actually
    // guarantees it, including against another device writing at the same time.
    const clash = get<{ id: number }>(`SELECT id FROM payments WHERE mpesa_code = ?`, t.mpesaCode);
    if (clash) throw new SaleError("mpesa_code_reused", "That M-Pesa code has already been used.");
  }

  try {
    run(
      `INSERT INTO payments (sale_id, method, amount_cents, mpesa_code, user_id)
       VALUES (?, ?, ?, ?, ?)`,
      saleId,
      t.method,
      t.amountCents,
      t.mpesaCode,
      userId,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/UNIQUE constraint failed/i.test(message) && /mpesa/i.test(message)) {
      throw new SaleError("mpesa_code_reused", "That M-Pesa code has already been used.");
    }
    throw err;
  }
}

// ------------------------------------------------------------------- voids

/**
 * Void a sale. The row stays; only its status changes, and the stock it took is
 * handed back by reversing the very movements the sale posted — not by
 * recomputing them, so a later price or pack-size change cannot skew the return.
 */
export function voidSale(saleId: number, userId: number, reason: string): void {
  const why = (reason ?? "").trim();
  if (!why) throw new SaleError("reason_required", "Say why this sale is being voided.");

  tx(() => {
    const sale = get<{ id: number; status: string; total_cents: number }>(
      `SELECT id, status, total_cents FROM sales WHERE id = ?`,
      saleId,
    );
    if (!sale) throw new SaleError("not_found", "That sale no longer exists.");
    if (sale.status === "voided") throw new SaleError("already_voided", "That sale is already voided.");

    const moves = all<{ item_id: number; delta_milli: number }>(
      `SELECT item_id, delta_milli FROM stock_movements
        WHERE ref_type = 'sale' AND ref_id = ? AND reason = 'sale'`,
      saleId,
    );
    for (const m of moves) {
      postMovement({
        itemId: m.item_id,
        deltaMilli: -m.delta_milli,
        reason: "sale_void",
        refType: "sale",
        refId: saleId,
        userId,
        note: why,
      });
    }

    run(
      `UPDATE sales
          SET status = 'voided', void_reason = ?, voided_by = ?, voided_at = datetime('now')
        WHERE id = ?`,
      why,
      userId,
      saleId,
    );

    audit(userId, "void_sale", "sale", saleId, `${formatKes(sale.total_cents)} voided: ${why}`);
  });
}

// ------------------------------------------------------------------ credit

export interface CreditStatus {
  customerId: number;
  name: string;
  limitCents: number;
  outstandingCents: number;
  afterCents: number;
  /** Past a limit the owner actually agreed. */
  exceeds: boolean;
  /** No limit has ever been agreed for this customer. */
  noLimitAgreed: boolean;
  /** Either of the above: this credit needs the owner, in person. */
  needsApproval: boolean;
}

/** What a customer already owes, from the sales themselves — never a cached column. */
export function customerOutstanding(customerId: number): number {
  const row = get<{ owed: number }>(
    `SELECT COALESCE(SUM(total_cents - paid_cents), 0) AS owed
       FROM sales
      WHERE customer_id = ? AND status = 'completed'`,
    customerId,
  );
  return row?.owed ?? 0;
}

/**
 * Whether adding `addCents` of debt would push a customer past their limit.
 * The counter warns; it does not block — the owner decides who gets stretched.
 */
export function creditStatus(customerId: number, addCents: number): CreditStatus | null {
  const c = get<{ id: number; name: string; credit_limit_cents: number }>(
    `SELECT id, name, credit_limit_cents FROM customers WHERE id = ?`,
    customerId,
  );
  if (!c) return null;

  const outstandingCents = customerOutstanding(customerId);
  const afterCents = outstandingCents + addCents;

  /**
   * A limit of zero is not "unlimited" — it is "no credit agreed yet".
   *
   * It used to read as unlimited, which meant every customer whose limit had
   * never been set could take any amount on credit with nothing said. That is
   * the whole gate, defeated by a default value. Anyone the owner trusts has a
   * number against their name; everyone else needs him at the counter.
   */
  const noLimitAgreed = c.credit_limit_cents <= 0;
  const exceeds = !noLimitAgreed && afterCents > c.credit_limit_cents;

  return {
    customerId: c.id,
    name: c.name,
    limitCents: c.credit_limit_cents,
    outstandingCents,
    afterCents,
    exceeds,
    noLimitAgreed,
    needsApproval: noLimitAgreed || exceeds,
  };
}

// -------------------------------------------------------------- owner PIN

/**
 * Verify a PIN against every active owner, returning who approved.
 *
 * Checking all owners (rather than "the" owner) means a second director can
 * authorise a discount without sharing one PIN — and the audit line names them.
 */
export function authoriseOwnerPin(pin: string): number | null {
  const candidate = (pin ?? "").trim();
  if (!candidate) return null;

  const owners = all<{ id: number; pin_hash: string }>(
    `SELECT id, pin_hash FROM users WHERE role = 'owner' AND active = 1`,
  );
  for (const o of owners) {
    if (verifyPin(candidate, o.pin_hash)) return o.id;
  }
  return null;
}

// ------------------------------------------------------------------ reads

export interface SaleRow {
  id: number;
  at: string;
  tier: Tier;
  total_cents: number;
  paid_cents: number;
  status: "completed" | "voided";
  void_reason: string | null;
  voided_at: string | null;
  user_name: string | null;
  voided_by_name: string | null;
  customer_name: string | null;
  methods: string | null;
  line_count: number;
}

/** Newest first, one page at a time — the sales table only ever grows. */
export function listSales(page: number, perPage: number = SALES_PAGE_SIZE): {
  rows: SaleRow[];
  total: number;
  page: number;
  pages: number;
} {
  const size = Math.max(1, Math.min(100, Math.trunc(perPage)));
  const total = get<{ n: number }>(`SELECT COUNT(*) AS n FROM sales`)?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Math.trunc(page) || 1), pages);

  const rows = all<SaleRow>(
    `SELECT s.id, s.at, s.tier, s.total_cents, s.paid_cents, s.status,
            s.void_reason, s.voided_at,
            u.name  AS user_name,
            vu.name AS voided_by_name,
            c.name  AS customer_name,
            (SELECT GROUP_CONCAT(DISTINCT p.method) FROM payments p WHERE p.sale_id = s.id) AS methods,
            (SELECT COUNT(*) FROM sale_lines l WHERE l.sale_id = s.id) AS line_count
       FROM sales s
       LEFT JOIN users u      ON u.id = s.user_id
       LEFT JOIN users vu     ON vu.id = s.voided_by
       LEFT JOIN customers c  ON c.id = s.customer_id
      ORDER BY s.at DESC, s.id DESC
      LIMIT ? OFFSET ?`,
    size,
    (current - 1) * size,
  );

  return { rows, total, page: current, pages };
}

export interface SaleLineRow {
  sale_id: number;
  name_snapshot: string;
  units: number;
  unit_price_cents: number;
  line_total_cents: number;
}

/** Lines for a whole page of sales in one query, rather than one query per row. */
export function saleLinesFor(saleIds: readonly number[]): SaleLineRow[] {
  if (!saleIds.length) return [];
  const marks = saleIds.map(() => "?").join(",");
  return all<SaleLineRow>(
    `SELECT sale_id, name_snapshot, units, unit_price_cents, line_total_cents
       FROM sale_lines
      WHERE sale_id IN (${marks})
      ORDER BY id`,
    ...saleIds,
  );
}

/**
 * The items that shift, so the common sale needs no searching.
 * Today's own sales if the day has started; otherwise the past week's, because
 * an empty row at 8am helps nobody.
 */
export function topSellerItemIds(limit = 6): number[] {
  // Nairobi is UTC+3 with no daylight saving, so the shop's day is the UTC
  // timestamp shifted three hours. Grouping by raw UTC would move the evening's
  // best sellers onto tomorrow's row.
  const query = (clause: string) =>
    all<{ item_id: number }>(
      `SELECT sl.item_id AS item_id, SUM(sl.units) AS n
         FROM sale_lines sl
         JOIN sales s ON s.id = sl.sale_id
        WHERE s.status = 'completed'
          AND sl.item_id IS NOT NULL
          AND ${clause}
        GROUP BY sl.item_id
        ORDER BY n DESC, sl.item_id
        LIMIT ?`,
      limit,
    ).map((r) => r.item_id);

  const today = query(`date(s.at, '+3 hours') = date('now', '+3 hours')`);
  return today.length ? today : query(`s.at >= datetime('now', '-7 days')`);
}

// ------------------------------------------------------- repeating an order

export interface LastOrderLine {
  itemId: number;
  /** The name as it was sold, so a renamed item is still recognisable. */
  name: string;
  units: number;
  /** False if the item has since been retired or made unsellable. */
  available: boolean;
}

export interface LastOrder {
  saleId: number;
  at: string;
  lines: LastOrderLine[];
}

/**
 * What this customer bought last time.
 *
 * Wholesale regulars order the same thing most weeks, and re-ringing a
 * twelve-line order by hand is where the counter loses its morning. This
 * returns only *what* and *how many* — never the prices. Today's prices are
 * applied when the cart is filled, because a price agreed three weeks ago is
 * not a price agreed today, and quietly reviving an old one would be a way to
 * sell below the floor with nobody deciding to.
 *
 * Voided sales are skipped: "the same as last time" must not mean the mistake.
 */
export function lastOrderFor(customerId: number): LastOrder | null {
  const sale = get<{ id: number; at: string }>(
    `SELECT id, at FROM sales
      WHERE customer_id = ? AND status = 'completed'
      ORDER BY at DESC, id DESC
      LIMIT 1`,
    customerId,
  );
  if (!sale) return null;

  const rows = all<{
    item_id: number | null;
    name_snapshot: string;
    units: number;
    active: number;
    sellable: number;
  }>(
    `SELECT sl.item_id, sl.name_snapshot, sl.units,
            COALESCE(i.active, 0) AS active, COALESCE(i.sellable, 0) AS sellable
       FROM sale_lines sl
       LEFT JOIN items i ON i.id = sl.item_id
      WHERE sl.sale_id = ?
      ORDER BY sl.id`,
    sale.id,
  );

  return {
    saleId: sale.id,
    at: sale.at,
    lines: rows
      .filter((r): r is typeof r & { item_id: number } => r.item_id !== null)
      .map((r) => ({
        itemId: r.item_id,
        name: r.name_snapshot,
        units: r.units,
        available: r.active === 1 && r.sellable === 1,
      })),
  };
}
