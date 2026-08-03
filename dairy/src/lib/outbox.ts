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
 */

export interface OutboxEntry {
  id: string;
  kind: string;
  payload: unknown;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

const DB_NAME = "dairy-outbox";
const STORE = "queue";
const VERSION = 1;

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

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Queue a write. The save is DONE the moment this resolves. */
export async function enqueue(entry: Omit<OutboxEntry, "attempts" | "createdAt">): Promise<void> {
  await tx("readwrite", (s) =>
    s.put({ ...entry, createdAt: Date.now(), attempts: 0 } satisfies OutboxEntry),
  );
}

export async function pending(): Promise<OutboxEntry[]> {
  const all = await tx<OutboxEntry[]>("readonly", (s) => s.getAll() as IDBRequest<OutboxEntry[]>);
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function remove(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}

export async function markFailed(id: string, error: string): Promise<void> {
  const existing = await tx<OutboxEntry | undefined>("readonly", (s) => s.get(id));
  if (!existing) return;
  await tx("readwrite", (s) =>
    s.put({ ...existing, attempts: existing.attempts + 1, lastError: error }),
  );
}

export async function count(): Promise<number> {
  return tx<number>("readonly", (s) => s.count());
}

/* ---------------------------------------------------------------- */

export type SyncState =
  | { status: "saved"; waiting: number }
  | { status: "sending" }
  | { status: "synced" }
  | { status: "error"; waiting: number; message: string };

/**
 * Plain-language sync state for the header chip. Three states, never a spinner
 * that can hang forever — a hanging spinner is a dead product in a 2G area.
 */
export function describeSyncState(state: SyncState): string {
  switch (state.status) {
    case "saved":
      return state.waiting === 1 ? "Saved on phone (1 waiting)" : `Saved on phone (${state.waiting} waiting)`;
    case "sending":
      return "Sending…";
    case "synced":
      return "All sent";
    case "error":
      return `Saved on phone (${state.waiting} waiting) — will retry`;
  }
}

/**
 * Drain the queue. Each entry posts to its own endpoint; a failure leaves the
 * entry in place to be retried, and never blocks the ones behind it from being
 * attempted on the next pass.
 */
export async function flush(
  send: (entry: OutboxEntry) => Promise<void>,
  onState?: (s: SyncState) => void,
): Promise<{ sent: number; failed: number }> {
  const queue = await pending();
  if (queue.length === 0) {
    onState?.({ status: "synced" });
    return { sent: 0, failed: 0 };
  }

  onState?.({ status: "sending" });
  let sent = 0;
  let failed = 0;

  for (const entry of queue) {
    try {
      await send(entry);
      await remove(entry.id);
      sent++;
    } catch (err) {
      failed++;
      await markFailed(entry.id, err instanceof Error ? err.message : "unknown");
    }
  }

  const waiting = await count();
  onState?.(
    waiting === 0
      ? { status: "synced" }
      : { status: "error", waiting, message: "Some entries are still waiting." },
  );
  return { sent, failed };
}

/** Start draining whenever the device comes back online. */
export function startAutoFlush(
  send: (entry: OutboxEntry) => Promise<void>,
  onState?: (s: SyncState) => void,
): () => void {
  const run = () => void flush(send, onState);
  window.addEventListener("online", run);
  const timer = window.setInterval(run, 30_000);
  run();
  return () => {
    window.removeEventListener("online", run);
    window.clearInterval(timer);
  };
}
