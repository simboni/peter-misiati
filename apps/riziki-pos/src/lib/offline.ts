/**
 * The offline outbox.
 *
 * Safaricom data drops several times a day. If the counter screen goes blank
 * mid-sale with a queue waiting, the staff go back to the paper notebook and
 * never come back — the notebook never goes offline. So one thing, and only one
 * thing, is allowed to keep working without a network: **taking a sale**.
 *
 * Three decisions shape this file:
 *
 *  1. **Only sales queue.** Batches, formulas, purchases, day close and reports
 *     stay online-only. They are owner-sensitive or conflict-prone: two devices
 *     replaying a stock adjustment from different guesses at the truth would
 *     leave the ledger unarguable, and the ledger is the whole system.
 *
 *  2. **The `client_uuid` is the idempotency key, not a transaction id.** A
 *     queued sale may be posted any number of times — the drain retries, the
 *     interval retries, the user taps "Send now" — and `recordSale()` returns
 *     the sale it already stored instead of charging the customer twice. That is
 *     why replaying is safe enough to do aggressively.
 *
 *  3. **No framework imports.** Everything here runs either in the browser
 *     (IndexedDB) or under plain Node in a unit test. `syncQueuedSales` takes
 *     the recorder as an argument rather than importing `sales.ts`, so this
 *     module can be pulled into a client bundle without dragging `node:sqlite`
 *     along with it — and so the server half can be tested without Next.
 *
 * Money stays integer cents from the counter, through IndexedDB, over the wire,
 * into `sale_lines`. Nothing here ever divides by 100.
 */

import type { PayMethod, Tier } from "./sales.ts";

export const OUTBOX_DB = "riziki-offline";
export const OUTBOX_STORE = "queued_sales";
export const OUTBOX_DB_VERSION = 1;

/** Sent per request. Small enough that one bad connection retries cheaply. */
export const SYNC_BATCH = 25;

/** A batch larger than this is not a shop, it is a mistake or an attack. */
export const MAX_SYNC_BATCH = 100;

/** Fired on `window` whenever the queue changes, so the pill can re-count. */
export const OUTBOX_EVENT = "riziki:outbox";

// --------------------------------------------------------------- wire types

export interface QueuedLine {
  itemId: number;
  units: number;
  /**
   * Integer cents, snapshotted at the counter. May be a haggled price.
   * Per container, or per kg / L when the item is priced by quantity.
   */
  unitPriceCents: number;
  /**
   * How much substance, in milli, for an item priced by quantity.
   *
   * Sent even though the till re-reads the item's own `price_basis` before it
   * charges anything: the queue is a wire format that may sit on a phone for a
   * day, and a line that arrives without its quantity is a sale that cannot be
   * replayed at all. Optional on the wire because a sale queued before this
   * existed has no quantity to send — such a line names an item that was sold
   * whole, and the till refuses it by name rather than guessing a weight.
   */
  qtyMilli?: number;
  /** Recorded against the line when it came out of a recipe. */
  formulaVersionId?: number | null;
}

export interface QueuedTender {
  method: PayMethod;
  amountCents: number;
  mpesaCode?: string;
}

/** Exactly what travels from the device to `/api/sync`. */
export interface QueuedSalePayload {
  clientUuid: string;
  tier: Tier;
  lines: QueuedLine[];
  tenders: QueuedTender[];
  customerId: number | null;
  /** ISO instant the sale was taken, not the instant it was sent. */
  queuedAt: string;
  /**
   * What the counter told the customer. The server recomputes the total from
   * the lines and refuses the sale if the two disagree, so a corrupted row in
   * IndexedDB cannot quietly change the price after the fact.
   */
  totalCents: number;
}

/** A payload plus the bookkeeping that never leaves the device. */
export interface QueuedSale extends QueuedSalePayload {
  /** Monotonic, so the queue drains in the order the sales were taken. */
  seq: number;
  attempts: number;
  lastError: string | null;
}

export type SyncStatus = "accepted" | "duplicate" | "failed";

export interface SyncOutcome {
  /** Position in the batch that was sent. The client matches on this first, so
   *  a sale too malformed to read a uuid from can still be reported back. */
  index: number;
  clientUuid: string;
  status: SyncStatus;
  saleId?: number;
  totalCents?: number;
  outstandingCents?: number;
  error?: string;
  code?: string;
}

export interface SyncResponse {
  ok: boolean;
  results?: SyncOutcome[];
  error?: string;
  message?: string;
}

/** A refusal the counter can act on, as opposed to a bug. */
export class OutboxError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "OutboxError";
    this.code = code;
  }
}

// ------------------------------------------------------------- validation

const TIERS: ReadonlySet<string> = new Set(["retail", "wholesale"]);
const METHODS: ReadonlySet<string> = new Set(["cash", "mpesa", "credit"]);

/** Whole numbers only — a float here is a rounding bug waiting to be printed. */
function isCount(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0;
}

function isCents(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
}

/**
 * Read an untrusted object — from IndexedDB, or from a request body — into a
 * payload we are willing to record.
 *
 * This is deliberately strict rather than forgiving. A queued sale has already
 * been agreed with a customer; if the row cannot be trusted, saying so loudly
 * and keeping it is far better than recording an invented amount.
 */
export function parseQueuedSale(value: unknown): QueuedSalePayload {
  if (!value || typeof value !== "object") {
    throw new OutboxError("bad_request", "That queued sale is not readable.");
  }
  const raw = value as Record<string, unknown>;

  const clientUuid = typeof raw.clientUuid === "string" ? raw.clientUuid.trim() : "";
  if (!clientUuid || clientUuid.length > 100) {
    throw new OutboxError("bad_request", "That queued sale has no device reference.");
  }

  const tier = typeof raw.tier === "string" ? raw.tier : "";
  if (!TIERS.has(tier)) {
    throw new OutboxError("bad_request", "That queued sale has no price tier.");
  }

  if (!Array.isArray(raw.lines) || raw.lines.length === 0 || raw.lines.length > 50) {
    throw new OutboxError("empty_cart", "That queued sale has no items on it.");
  }
  const lines: QueuedLine[] = raw.lines.map((entry) => {
    const l = (entry ?? {}) as Record<string, unknown>;
    if (!isCount(l.itemId)) throw new OutboxError("unknown_item", "A queued line names no item.");
    if (!isCount(l.units)) throw new OutboxError("bad_units", "A queued line has no whole quantity.");
    if (!isCents(l.unitPriceCents)) {
      throw new OutboxError("bad_price", "A queued line price is not a whole number of cents.");
    }
    if (l.qtyMilli !== undefined && !isCount(l.qtyMilli)) {
      throw new OutboxError("bad_units", "A queued line has an unreadable quantity.");
    }
    if (l.formulaVersionId !== undefined && l.formulaVersionId !== null && !isCount(l.formulaVersionId)) {
      throw new OutboxError("bad_request", "A queued line names an unreadable recipe.");
    }
    // Built up rather than spelled out, so a line that carried neither field
    // comes back the shape it went in as. A queued sale is compared with what
    // was stored on the device to decide whether it is safe to drop, and
    // `{ qtyMilli: undefined }` is not the same object as one without the key.
    const parsed: QueuedLine = {
      itemId: l.itemId,
      units: l.units,
      unitPriceCents: l.unitPriceCents,
    };
    if (l.qtyMilli !== undefined) parsed.qtyMilli = l.qtyMilli;
    if (l.formulaVersionId !== undefined && l.formulaVersionId !== null) {
      parsed.formulaVersionId = l.formulaVersionId;
    }
    return parsed;
  });

  if (!Array.isArray(raw.tenders) || raw.tenders.length > 8) {
    throw new OutboxError("bad_request", "That queued sale has unreadable payments.");
  }
  const tenders: QueuedTender[] = raw.tenders.map((entry) => {
    const t = (entry ?? {}) as Record<string, unknown>;
    if (!METHODS.has(String(t.method))) {
      throw new OutboxError("bad_request", "A queued payment has no method.");
    }
    if (!isCount(t.amountCents)) {
      throw new OutboxError("bad_amount", "A queued payment has no amount.");
    }
    const tender: QueuedTender = { method: t.method as PayMethod, amountCents: t.amountCents };
    if (typeof t.mpesaCode === "string" && t.mpesaCode.trim()) {
      tender.mpesaCode = t.mpesaCode.trim();
    }
    return tender;
  });

  const customerId = raw.customerId == null ? null : isCount(raw.customerId) ? raw.customerId : null;
  if (raw.customerId != null && customerId === null) {
    throw new OutboxError("bad_request", "That queued sale names an impossible customer.");
  }

  // The counter's own arithmetic, checked against ours. They can only disagree
  // if the stored row was corrupted, and a corrupted price must never be sold.
  const totalCents = lines.reduce((sum, l) => sum + l.unitPriceCents * l.units, 0);
  if (!isCents(raw.totalCents)) {
    throw new OutboxError("bad_price", "That queued sale has no total.");
  }
  if (raw.totalCents !== totalCents) {
    throw new OutboxError(
      "bad_price",
      "That queued sale's total does not match its lines — it will not be recorded.",
    );
  }

  const queuedAt = typeof raw.queuedAt === "string" && raw.queuedAt ? raw.queuedAt : "";

  return { clientUuid, tier: tier as Tier, lines, tenders, customerId, queuedAt, totalCents };
}

/** The uuid, if one can be read at all — used to label a malformed entry. */
export function uuidOf(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const raw = (value as Record<string, unknown>).clientUuid;
  return typeof raw === "string" ? raw.trim().slice(0, 100) : "";
}

// ------------------------------------------------------------- pure helpers

/**
 * Oldest first. The shop's day reads in the order it happened, and a credit
 * sale recorded before its part-payment keeps the debtors report sane.
 */
export function sortOldestFirst<T extends { seq: number; clientUuid: string }>(sales: readonly T[]): T[] {
  return [...sales].sort((a, b) => a.seq - b.seq || a.clientUuid.localeCompare(b.clientUuid));
}

/** What actually goes on the wire — never the local attempt counters. */
export function toWire(sale: QueuedSale | QueuedSalePayload): QueuedSalePayload {
  return {
    clientUuid: sale.clientUuid,
    tier: sale.tier,
    lines: sale.lines.map((l) => ({ ...l })),
    tenders: sale.tenders.map((t) => ({ ...t })),
    customerId: sale.customerId,
    queuedAt: sale.queuedAt,
    totalCents: sale.totalCents,
  };
}

export function serialiseQueue(sales: readonly QueuedSale[]): string {
  return JSON.stringify(sortOldestFirst(sales));
}

export function parseQueue(text: string): QueuedSale[] {
  const raw: unknown = JSON.parse(text);
  if (!Array.isArray(raw)) return [];
  return sortOldestFirst(
    raw.map((entry) => {
      const payload = parseQueuedSale(entry);
      const e = entry as Record<string, unknown>;
      return {
        ...payload,
        seq: typeof e.seq === "number" ? e.seq : 0,
        attempts: typeof e.attempts === "number" ? e.attempts : 0,
        lastError: typeof e.lastError === "string" ? e.lastError : null,
      };
    }),
  );
}

export interface QueueSettlement {
  /** Recorded, or already recorded — safe to forget. */
  drop: QueuedSale[];
  /** Refused. Kept, with the reason, and shown to the user. */
  keep: QueuedSale[];
}

/**
 * Decide what leaves the queue after a sync.
 *
 * A `duplicate` drops for exactly the same reason as an `accepted`: the sale is
 * in the till. Anything the server did not answer for stays — a dropped result
 * would be a lost sale, which is the one outcome this whole module exists to
 * prevent.
 */
export function applySyncResults(
  batch: readonly QueuedSale[],
  results: readonly SyncOutcome[],
): QueueSettlement {
  const drop: QueuedSale[] = [];
  const keep: QueuedSale[] = [];

  for (let i = 0; i < batch.length; i++) {
    const sale = batch[i];
    // Matched by position, then verified by uuid: a batch entry too malformed
    // for the server to read a uuid from still gets an answer.
    const result = results.find(
      (r) => r.index === i && (!r.clientUuid || r.clientUuid === sale.clientUuid),
    );

    if (!result) {
      keep.push({ ...sale, attempts: sale.attempts + 1, lastError: sale.lastError });
      continue;
    }
    if (result.status === "accepted" || result.status === "duplicate") {
      drop.push(sale);
      continue;
    }
    keep.push({
      ...sale,
      attempts: sale.attempts + 1,
      lastError: result.error ?? "The till refused this sale.",
    });
  }

  return { drop, keep };
}

// ---------------------------------------------------------- server-side sync

export interface RecordedSale {
  saleId: number;
  totalCents: number;
  paidCents: number;
  outstandingCents: number;
  duplicate: boolean;
}

export interface RecordSaleArgs {
  clientUuid: string;
  userId: number;
  tier: Tier;
  lines: QueuedLine[];
  tenders: QueuedTender[];
  customerId: number | null;
  note?: string;
  floorOverrideBy?: number | null;
}

/** `recordSale` from `sales.ts`, injected so this module stays framework-free. */
export type RecordFn = (input: RecordSaleArgs) => RecordedSale;

export interface SyncOptions {
  userId: number;
  record: RecordFn;
  /** The owner who authorised any below-floor price, if a PIN came with the batch. */
  floorOverrideBy?: number | null;
}

/**
 * Record a batch of queued sales, one at a time, each in its own try/catch.
 *
 * One bad sale must never hold up the good ones: the phone may hold a whole
 * morning's takings, and refusing the lot because one line references an item
 * the owner deleted would be indistinguishable, from the counter, from losing
 * the morning. So every sale gets its own verdict and the client drops only
 * what was actually settled.
 */
export function syncQueuedSales(raw: unknown, opts: SyncOptions): SyncOutcome[] {
  const batch = Array.isArray(raw) ? raw : [];
  const outcomes: SyncOutcome[] = [];

  batch.forEach((entry, index) => {
    const clientUuid = uuidOf(entry);
    try {
      const sale = parseQueuedSale(entry);
      const result = opts.record({
        clientUuid: sale.clientUuid,
        userId: opts.userId,
        tier: sale.tier,
        lines: sale.lines,
        tenders: sale.tenders,
        customerId: sale.customerId,
        // Worth carrying: at day close the owner can see which takings were
        // rung up while the line was down, and when they actually happened.
        note: sale.queuedAt ? `Offline sale, taken ${sale.queuedAt}` : "Offline sale",
        floorOverrideBy: opts.floorOverrideBy ?? null,
      });

      outcomes.push({
        index,
        clientUuid: sale.clientUuid,
        status: result.duplicate ? "duplicate" : "accepted",
        saleId: result.saleId,
        totalCents: result.totalCents,
        outstandingCents: result.outstandingCents,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code =
        err && typeof err === "object" && typeof (err as { code?: unknown }).code === "string"
          ? (err as { code: string }).code
          : "failed";
      outcomes.push({ index, clientUuid, status: "failed", error: message, code });
    }
  });

  return outcomes;
}

export function summariseOutcomes(results: readonly SyncOutcome[]): {
  accepted: number;
  duplicate: number;
  failed: number;
} {
  return {
    accepted: results.filter((r) => r.status === "accepted").length,
    duplicate: results.filter((r) => r.status === "duplicate").length,
    failed: results.filter((r) => r.status === "failed").length,
  };
}

// --------------------------------------------------------- the device outbox
//
// Everything below needs a browser. Under Node — in tests, or during a server
// render — `outboxAvailable()` is false and each call is a safe no-op, so the
// module can be imported anywhere.

export function outboxAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

/**
 * `seq` must never go backwards inside one session, or two sales taken in the
 * same millisecond could drain out of order.
 */
let lastSeq = 0;
function nextSeq(): number {
  lastSeq = Math.max(Date.now(), lastSeq + 1);
  return lastSeq;
}

function openOutbox(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!outboxAvailable()) {
      reject(new OutboxError("no_storage", "This browser cannot save sales offline."));
      return;
    }
    const request = indexedDB.open(OUTBOX_DB, OUTBOX_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        // Keyed by the idempotency key itself: queueing the same sale twice on
        // one device overwrites rather than duplicates.
        const store = db.createObjectStore(OUTBOX_STORE, { keyPath: "clientUuid" });
        store.createIndex("seq", "seq", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("could not open the offline outbox"));
  });
}

function finish<T>(tx: IDBTransaction, value: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(value());
    tx.onabort = () => reject(tx.error ?? new Error("offline outbox write aborted"));
    tx.onerror = () => reject(tx.error ?? new Error("offline outbox write failed"));
  });
}

function announce(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OUTBOX_EVENT));
}

/** Save a sale to send later. Resolves only once the write is durable. */
export async function enqueueSale(payload: QueuedSalePayload): Promise<QueuedSale> {
  const checked = parseQueuedSale(payload);
  const sale: QueuedSale = { ...checked, seq: nextSeq(), attempts: 0, lastError: null };

  const db = await openOutbox();
  try {
    const tx = db.transaction(OUTBOX_STORE, "readwrite");
    tx.objectStore(OUTBOX_STORE).put(sale);
    await finish(tx, () => sale);
  } finally {
    db.close();
  }
  announce();
  return sale;
}

export async function listOutbox(): Promise<QueuedSale[]> {
  if (!outboxAvailable()) return [];
  const db = await openOutbox();
  try {
    const tx = db.transaction(OUTBOX_STORE, "readonly");
    const request = tx.objectStore(OUTBOX_STORE).getAll();
    const rows = await finish(tx, () => (request.result ?? []) as QueuedSale[]);
    return sortOldestFirst(rows);
  } finally {
    db.close();
  }
}

export async function countOutbox(): Promise<number> {
  if (!outboxAvailable()) return 0;
  const db = await openOutbox();
  try {
    const tx = db.transaction(OUTBOX_STORE, "readonly");
    const request = tx.objectStore(OUTBOX_STORE).count();
    return await finish(tx, () => request.result ?? 0);
  } finally {
    db.close();
  }
}

/** Settle a drain: forget what landed, remember why the rest did not. */
async function settle(settlement: QueueSettlement): Promise<void> {
  if (!settlement.drop.length && !settlement.keep.length) return;
  const db = await openOutbox();
  try {
    const tx = db.transaction(OUTBOX_STORE, "readwrite");
    const store = tx.objectStore(OUTBOX_STORE);
    for (const sale of settlement.drop) store.delete(sale.clientUuid);
    for (const sale of settlement.keep) store.put(sale);
    await finish(tx, () => undefined);
  } finally {
    db.close();
  }
  announce();
}

/** Drop a sale the user has decided to re-ring by hand. */
export async function discardQueued(clientUuid: string): Promise<void> {
  if (!outboxAvailable()) return;
  const db = await openOutbox();
  try {
    const tx = db.transaction(OUTBOX_STORE, "readwrite");
    tx.objectStore(OUTBOX_STORE).delete(clientUuid);
    await finish(tx, () => undefined);
  } finally {
    db.close();
  }
  announce();
}

export interface DrainReport {
  /** Still waiting after this attempt. */
  pending: number;
  accepted: number;
  duplicate: number;
  failed: number;
  /** Why nothing could be sent at all — network down, session expired. */
  error: string | null;
  /** True when the session expired while the device was offline. */
  signedOut: boolean;
}

const EMPTY_REPORT: DrainReport = {
  pending: 0,
  accepted: 0,
  duplicate: 0,
  failed: 0,
  error: null,
  signedOut: false,
};

/**
 * Single-flight. The `online` event, the interval and the "Send now" button all
 * fire at once when a Safaricom cell comes back; posting the same batch three
 * times would be safe (the uuid sees to that) but would also race the delete
 * that follows it, so they share one attempt instead.
 */
let inFlight: Promise<DrainReport> | null = null;

export function drainOutbox(opts: { ownerPin?: string } = {}): Promise<DrainReport> {
  if (inFlight) return inFlight;
  inFlight = runDrain(opts).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runDrain(opts: { ownerPin?: string }): Promise<DrainReport> {
  if (!outboxAvailable()) return { ...EMPTY_REPORT };

  const queue = await listOutbox();
  if (!queue.length) return { ...EMPTY_REPORT };

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ...EMPTY_REPORT, pending: queue.length, error: "No network yet." };
  }

  const batch = queue.slice(0, SYNC_BATCH);

  let response: Response;
  try {
    response = await fetch("/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sales: batch.map(toWire), ownerPin: opts.ownerPin }),
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    return { ...EMPTY_REPORT, pending: queue.length, error: "The till did not answer." };
  }

  if (response.status === 401) {
    // The session died while the device was offline. Keep every sale — signing
    // back in must not cost the shop a morning's takings.
    return {
      ...EMPTY_REPORT,
      pending: queue.length,
      error: "Signed out — sign in again to send these sales.",
      signedOut: true,
    };
  }
  if (!response.ok) {
    return { ...EMPTY_REPORT, pending: queue.length, error: `The till answered ${response.status}.` };
  }

  let body: SyncResponse;
  try {
    body = (await response.json()) as SyncResponse;
  } catch {
    return { ...EMPTY_REPORT, pending: queue.length, error: "The till sent an unreadable reply." };
  }
  if (!body.ok || !Array.isArray(body.results)) {
    return { ...EMPTY_REPORT, pending: queue.length, error: body.message ?? "The till refused the batch." };
  }

  const settlement = applySyncResults(batch, body.results);
  await settle(settlement);

  const counts = summariseOutcomes(body.results);
  return {
    pending: queue.length - settlement.drop.length,
    accepted: counts.accepted,
    duplicate: counts.duplicate,
    failed: counts.failed,
    error: null,
    signedOut: false,
  };
}

/** Subscribe to queue changes. Returns the unsubscribe. */
export function onOutboxChange(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(OUTBOX_EVENT, listener);
  return () => window.removeEventListener(OUTBOX_EVENT, listener);
}
