"use client";

/**
 * The offline outbox.
 *
 * A bidirectional sync engine is the single biggest way a solo developer sinks
 * a project like this. So this is deliberately NOT sync — it is a one-way write
 * queue with client-generated ids, and the server does
 * `INSERT ... ON CONFLICT (id) DO NOTHING`. A double-flush over a flaky link is
 * harmless, which removes roughly 90% of the complexity.
 *
 * Rural internet use in Kenya runs 21–28%, so saving must never touch the
 * network. It writes here, shows a receipt, and drains later.
 *
 * Three things in here are load-bearing and each exists because of a specific
 * way a herdsman loses a milking:
 *
 *   1. The queue KEY is derived from the content of the sheet. It used to be
 *      the character length of the JSON, so two different milkings that happened
 *      to serialise to the same number of characters silently overwrote each
 *      other and one of them was gone.
 *   2. Failures BACK OFF and eventually stop. A row the server will never
 *      accept must not spin every 30 seconds forever, flattening the battery on
 *      the phone that is meant to record tonight's milking.
 *   3. The store asks the browser to keep it. Without that, IndexedDB is
 *      "best effort" storage and a phone under pressure may evict an unsynced
 *      milking to make room for a photo.
 */

export interface OutboxEntry {
  id: string;
  kind: string;
  payload: unknown;
  createdAt: number;
  attempts: number;
  /** Wall-clock ms before which no further send should be attempted. */
  nextAttemptAt: number;
  lastError?: string;
}

const DB_NAME = "dairy-outbox";
const STORE = "queue";
/**
 * v2 adds `nextAttemptAt`. Entries written by v1 simply have it missing, which
 * reads as 0 — due now — so an upgrade never strands a queued milking.
 */
const VERSION = 2;

/* ---------------------------------------------------------------- */
/* Keys                                                              */
/* ---------------------------------------------------------------- */

/**
 * A 128-bit content fingerprint (cyrb128), pure and synchronous.
 *
 * Not a security hash — nothing here is a secret. It exists so that two
 * different sheets can never land on the same queue key. The old key was the
 * *length* of the JSON, and "12.5 and 15.0" is the same length as "11.5 and
 * 16.0": one milking overwrote the other in the queue and was never sent.
 */
export function contentHash(text: string): string {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  const parts = [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
  return parts.map((p) => p.toString(16).padStart(8, "0")).join("");
}

/**
 * The key one queued write is stored under.
 *
 * `scope` is what makes two entries the same piece of work — for a milk sheet,
 * the date and the session. `body` is what was actually typed. Same scope and
 * same body: saving twice replaces one entry instead of queueing two. Same
 * scope, different body: two entries, because that is two different facts about
 * the morning and losing either one is losing a milking.
 */
export function queueKey(kind: string, scope: string[], body: string): string {
  return [kind, ...scope, contentHash(body)].join(":");
}

/* ---------------------------------------------------------------- */
/* Retry policy                                                      */
/* ---------------------------------------------------------------- */

/**
 * How many times a single entry is sent before the app stops trying on its own
 * and says so on screen. Eight attempts on the schedule below spans about an
 * hour and a half of real signal-hunting, which covers a ride into town.
 */
export const MAX_ATTEMPTS = 8;

const FIRST_RETRY_MS = 30_000;
const MAX_RETRY_MS = 30 * 60_000;

/** 30s, 1m, 2m, 4m … capped at 30 minutes. */
export function backoffMs(attempts: number): number {
  const n = Math.max(0, attempts);
  return Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** n);
}

/**
 * An entry the app has stopped retrying by itself. It is NOT deleted and never
 * will be — it is a milking. It stays on the phone and the chip says so, so
 * somebody can be asked rather than the record quietly disappearing.
 */
export function isStuck(entry: OutboxEntry): boolean {
  return entry.attempts >= MAX_ATTEMPTS;
}

export function isDue(entry: OutboxEntry, now: number): boolean {
  return !isStuck(entry) && (entry.nextAttemptAt ?? 0) <= now;
}

/* ---------------------------------------------------------------- */
/* Storage                                                           */
/* ---------------------------------------------------------------- */

/**
 * The queue behind an interface, so the retry and key logic can be tested
 * without a browser. IndexedDB is the real one; tests hand in a plain Map.
 */
export interface OutboxStore {
  getAll(): Promise<OutboxEntry[]>;
  put(entry: OutboxEntry): Promise<void>;
  delete(id: string): Promise<void>;
  count(): Promise<number>;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const idbStore: OutboxStore = {
  async getAll() {
    const all = await tx<OutboxEntry[]>("readonly", (s) => s.getAll() as IDBRequest<OutboxEntry[]>);
    return all.sort((a, b) => a.createdAt - b.createdAt);
  },
  async put(entry) {
    await tx("readwrite", (s) => s.put(entry));
  },
  async delete(id) {
    await tx("readwrite", (s) => s.delete(id));
  },
  count() {
    return tx<number>("readonly", (s) => s.count());
  },
};

/**
 * Ask the browser not to evict this queue.
 *
 * By default IndexedDB is "best effort": under storage pressure the browser may
 * throw it away without asking, and on a cheap Android shared by four people
 * that pressure is normal. An unsynced milking is not a cache — it is the only
 * copy of what happened this morning.
 *
 * Returns whether the storage is now durable. Never throws: an old browser that
 * has no Storage API still has a working queue, just an evictable one.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const storage = navigator.storage;
    if (!storage?.persist) return false;
    if (await storage.persisted?.()) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------- */
/* Queue operations                                                  */
/* ---------------------------------------------------------------- */

/**
 * Queue a write. The save is DONE the moment this resolves.
 *
 * Re-saving identical content lands on the same key and resets the attempt
 * count, which is deliberate: pressing Save again is a person explicitly asking
 * for another try, and it should not inherit a half-hour backoff.
 */
export async function enqueue(
  entry: Omit<OutboxEntry, "attempts" | "createdAt" | "nextAttemptAt"> &
    Partial<Pick<OutboxEntry, "createdAt">>,
  store: OutboxStore = idbStore,
): Promise<void> {
  await store.put({
    ...entry,
    createdAt: entry.createdAt ?? Date.now(),
    attempts: 0,
    nextAttemptAt: 0,
    lastError: undefined,
  });
}

export async function pending(store: OutboxStore = idbStore): Promise<OutboxEntry[]> {
  const all = await store.getAll();
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function remove(id: string, store: OutboxStore = idbStore): Promise<void> {
  await store.delete(id);
}

/** Record a failed attempt and push the next one out. */
export async function markFailed(
  id: string,
  error: string,
  store: OutboxStore = idbStore,
  now: number = Date.now(),
): Promise<void> {
  const existing = (await store.getAll()).find((e) => e.id === id);
  if (!existing) return;
  const attempts = existing.attempts + 1;
  await store.put({
    ...existing,
    attempts,
    nextAttemptAt: now + backoffMs(attempts - 1),
    lastError: error,
  });
}

export async function count(store: OutboxStore = idbStore): Promise<number> {
  return store.count();
}

/** Give up on the schedule and try everything right now. */
export async function retryNow(store: OutboxStore = idbStore): Promise<void> {
  for (const entry of await store.getAll()) {
    await store.put({ ...entry, attempts: 0, nextAttemptAt: 0 });
  }
}

/* ---------------------------------------------------------------- */
/* Sync state                                                        */
/* ---------------------------------------------------------------- */

export type SyncState =
  | { status: "synced" }
  | { status: "saved"; waiting: number }
  | { status: "sending"; waiting: number }
  | { status: "retrying"; waiting: number }
  | { status: "stuck"; waiting: number; stuck: number };

/**
 * Plain-language sync state for the header chip. No spinner that can hang
 * forever — a hanging spinner is a dead product in a 2G area — and no jargon:
 * "waiting" is a word, "queued" and "pending sync" are not.
 */
export function describeSyncState(state: SyncState): string {
  switch (state.status) {
    case "synced":
      return "All sent";
    case "sending":
      return "Sending…";
    case "stuck":
      return `Still on the phone · ${state.waiting} waiting`;
    case "retrying":
      return `Saved on phone · ${state.waiting} waiting`;
    case "saved":
      return `Saved on phone · ${state.waiting} waiting`;
  }
}

/**
 * The longer line, shown under the chip when something needs a person. Says
 * what is true and what to do — never "sync error", which tells a herdsman
 * nothing he can act on.
 */
export function explainSyncState(state: SyncState): string | null {
  switch (state.status) {
    case "stuck":
      return state.stuck === 1
        ? "One milking is saved here but the office has not taken it yet. Nothing is lost. Show this to the manager."
        : `${state.stuck} milkings are saved here but the office has not taken them yet. Nothing is lost. Show this to the manager.`;
    case "retrying":
      return "No network yet. This is safe on the phone and will go on its own.";
    case "saved":
      return "This is safe on the phone and will go on its own.";
    default:
      return null;
  }
}

/** What the queue looks like right now, without sending anything. */
export function summarise(entries: OutboxEntry[]): SyncState {
  if (entries.length === 0) return { status: "synced" };
  const stuck = entries.filter(isStuck).length;
  if (stuck > 0) return { status: "stuck", waiting: entries.length, stuck };
  if (entries.some((e) => e.attempts > 0)) return { status: "retrying", waiting: entries.length };
  return { status: "saved", waiting: entries.length };
}

/* ---------------------------------------------------------------- */
/* Draining                                                          */
/* ---------------------------------------------------------------- */

export type Sender = (entry: OutboxEntry) => Promise<void>;

export interface FlushOptions {
  onState?: (s: SyncState) => void;
  store?: OutboxStore;
  now?: () => number;
}

export interface FlushResult {
  sent: number;
  failed: number;
  /** Entries left alone this pass — backing off, or stopped. */
  skipped: number;
}

/**
 * Drain the queue.
 *
 * A failure leaves the entry in place to be retried and never blocks the ones
 * behind it from being attempted on the same pass — one bad row must not hold
 * up a week of good ones. Nothing is ever deleted because it failed; the only
 * thing that removes an entry is the server accepting it.
 */
export async function flush(send: Sender, opts: FlushOptions = {}): Promise<FlushResult> {
  const store = opts.store ?? idbStore;
  const now = opts.now ?? Date.now;
  const queue = await pending(store);

  if (queue.length === 0) {
    opts.onState?.({ status: "synced" });
    return { sent: 0, failed: 0, skipped: 0 };
  }

  const due = queue.filter((e) => isDue(e, now()));
  if (due.length === 0) {
    opts.onState?.(summarise(queue));
    return { sent: 0, failed: 0, skipped: queue.length };
  }

  opts.onState?.({ status: "sending", waiting: queue.length });
  let sent = 0;
  let failed = 0;

  for (const entry of due) {
    try {
      await send(entry);
      await remove(entry.id, store);
      sent++;
    } catch (err) {
      failed++;
      await markFailed(entry.id, err instanceof Error ? err.message : "unknown", store, now());
    }
  }

  const state = summarise(await pending(store));
  opts.onState?.(state);
  return { sent, failed, skipped: queue.length - due.length };
}

export interface AutoFlushOptions extends FlushOptions {
  /** How often to look, in ms. */
  intervalMs?: number;
}

/**
 * Keep draining in the background.
 *
 * Three triggers, because on a phone in a shed each one alone misses cases:
 * `online` fires when the radio reconnects; the visibility change catches the
 * far commoner case where the app was in the background with the screen off and
 * the timer was throttled to nothing; the interval covers a link that comes
 * back without the browser ever announcing it.
 *
 * Only one pass runs at a time. The server is idempotent, but two overlapping
 * passes both retry the same entry and double its attempt count, which would
 * burn the retry budget twice as fast as intended.
 */
export function startAutoFlush(send: Sender, opts: AutoFlushOptions = {}): () => void {
  let running = false;
  let stopped = false;

  const run = async () => {
    if (running || stopped) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      // Offline is not a failure and must not cost an attempt.
      const queue = await pending(opts.store ?? idbStore).catch(() => []);
      opts.onState?.(summarise(queue));
      return;
    }
    running = true;
    try {
      await flush(send, opts);
    } catch {
      // A broken IndexedDB must not take the whole app down with it.
    } finally {
      running = false;
    }
  };

  const trigger = () => void run();
  const onVisible = () => {
    if (document.visibilityState === "visible") trigger();
  };

  window.addEventListener("online", trigger);
  document.addEventListener("visibilitychange", onVisible);
  const timer = window.setInterval(trigger, opts.intervalMs ?? 30_000);
  trigger();

  return () => {
    stopped = true;
    window.removeEventListener("online", trigger);
    document.removeEventListener("visibilitychange", onVisible);
    window.clearInterval(timer);
  };
}
