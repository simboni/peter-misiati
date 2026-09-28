/**
 * The basket, kept where a tap away cannot lose it.
 *
 * An attendant halfway through a six-line order taps Stock to check a shelf, or
 * Customers to see what a laundry already owes, and comes back. The order has
 * to still be there. Re-ringing it from memory with a queue waiting is how a
 * line gets missed, and the missed line is always the expensive one.
 *
 * WHY THIS IS ITS OWN FILE. The rules below are four lines of arithmetic about
 * whose basket it is and what day it was built on — and they are exactly where
 * a silent regression hides, because nothing on the screen says "the basket was
 * not restored". They live here so they can be tested under plain Node instead
 * of being believed.
 *
 * WHERE IT IS KEPT. `localStorage`, not `sessionStorage`. The counter is a
 * cheap Android phone running the shop's app from the home screen, and Android
 * evicts it whenever something else wants the memory — which takes
 * `sessionStorage` with it and looks, to the attendant, exactly like the basket
 * being thrown away. What `sessionStorage` was buying was that yesterday's
 * basket could never resurrect, and the day stamp below buys that properly.
 *
 * WHOSE IT IS. Keyed by the person signed in. The owner and the attendant share
 * one phone here; a basket left by one of them must not appear under the other,
 * who would have no idea what is in it or who priced it.
 *
 * Nothing here imports from `next/*` or touches `window`: the storage is passed
 * in, so a test can hand it a fake and the server can hand it nothing.
 */

/** Anything the screen calls a cart line. This module never looks inside one. */
export interface CartMemory<Line> {
  lines: Line[];
  /** The account the sale is being rung up against, if one was chosen. */
  customerId: number | null;
}

interface StoredCart<Line> extends CartMemory<Line> {
  userId: number;
  /** The shop day it was built on — see `businessDate`, which is UTC+3. */
  day: string;
}

export const CART_KEY = "riziki_cart";

/**
 * Somewhere to put it, or nothing at all.
 *
 * Every accessor is behind a try/catch rather than a feature check: a private
 * window and a phone with site data blocked both hand you a `Storage` object
 * that throws on use, and a till that white-screens because it could not
 * remember a basket is a worse trade than a basket that is not remembered.
 */
export type Store = Pick<Storage, "getItem" | "setItem" | "removeItem"> | null | undefined;

/**
 * The basket this person left on this phone today, if there is one.
 *
 * Returns null — and clears what it found — for a basket belonging to somebody
 * else, or to another day. Both are baskets nobody is coming back to, and a
 * stale one on the screen is worse than none: it invites an attendant to charge
 * yesterday's prices for stock that has moved since.
 */
export function recallCart<Line>(
  store: Store,
  userId: number,
  today: string,
): CartMemory<Line> | null {
  if (!store) return null;
  let raw: string | null = null;
  try {
    raw = store.getItem(CART_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let saved: StoredCart<Line> | null = null;
  try {
    saved = JSON.parse(raw) as StoredCart<Line>;
  } catch {
    // A corrupt basket is not worth crashing the till over. Drop it.
    forgetCart(store);
    return null;
  }

  const mine = saved?.userId === userId;
  const todays = saved?.day === today;
  const anything = Array.isArray(saved?.lines) && saved.lines.length > 0;

  if (!mine || !todays || !anything) {
    forgetCart(store);
    return null;
  }

  return {
    lines: saved.lines,
    customerId: typeof saved.customerId === "number" ? saved.customerId : null,
  };
}

/**
 * Remember this basket, or forget it when there is nothing in it.
 *
 * An empty basket is not a basket worth keeping: it is what the screen looks
 * like the moment a sale completes, and writing it would only leave a row of
 * nothing for the next person to restore.
 */
export function keepCart<Line>(
  store: Store,
  userId: number,
  today: string,
  memory: CartMemory<Line>,
): void {
  if (!store) return;
  if (!memory.lines.length) {
    forgetCart(store);
    return;
  }
  const payload: StoredCart<Line> = {
    userId,
    day: today,
    lines: memory.lines,
    customerId: memory.customerId,
  };
  try {
    store.setItem(CART_KEY, JSON.stringify(payload));
  } catch {
    // Storage full, or a private window. The basket simply will not survive
    // leaving the screen, which is where this started.
  }
}

/** Throw the basket away — a completed sale, or one deliberately cleared. */
export function forgetCart(store: Store): void {
  if (!store) return;
  try {
    store.removeItem(CART_KEY);
  } catch {
    /* nothing to do about it, and nothing worth breaking the till for */
  }
}
