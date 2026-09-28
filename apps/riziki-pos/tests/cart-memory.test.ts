/**
 * The basket that survives walking away from the till.
 *
 * This exists because the feature shipped, was believed, and did not work: the
 * screen wrote an empty basket to storage on the way in, wiping the one it was
 * about to restore, and nothing anywhere said so. The screen's own ordering is
 * fixed in `sell-client.tsx`; these are the rules underneath it, which decide
 * whose basket comes back and when it is thrown away.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { recallCart, keepCart, forgetCart, CART_KEY } from "../src/lib/cart-memory.ts";

interface Line {
  itemId: number;
  qtyMilli: number;
}
const LINES: Line[] = [
  { itemId: 1, qtyMilli: 20000 },
  { itemId: 8, qtyMilli: 5000 },
];

const TODAY = "2026-09-28";
const ME = 2;

/** A phone's storage, and a note of everything asked of it. */
function fakeStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

// ------------------------------------------------------------ the round trip

test("a basket left on the way out is the basket found on the way back", () => {
  const store = fakeStore();
  keepCart(store, ME, TODAY, { lines: LINES, customerId: 4 });

  const back = recallCart<Line>(store, ME, TODAY);
  assert.deepEqual(back, { lines: LINES, customerId: 4 }, "every line, and the account it was for");
});

test("the account is remembered as well as the goods", () => {
  // Checking a wholesale customer's balance mid-order is the commonest reason
  // to leave this screen, and coming back to a basket priced at retail with the
  // customer cleared is worse than coming back to no basket at all.
  const store = fakeStore();
  keepCart(store, ME, TODAY, { lines: LINES, customerId: 11 });
  assert.equal(recallCart<Line>(store, ME, TODAY)?.customerId, 11);
});

test("an empty basket is forgotten rather than written", () => {
  const store = fakeStore();
  keepCart(store, ME, TODAY, { lines: LINES, customerId: null });
  assert.ok(store.data.has(CART_KEY));

  // What the screen looks like the instant a sale completes.
  keepCart(store, ME, TODAY, { lines: [], customerId: null });
  assert.equal(store.data.has(CART_KEY), false, "nothing is left for the next person to restore");
  assert.equal(recallCart<Line>(store, ME, TODAY), null);
});

test("a completed sale throws the basket away", () => {
  const store = fakeStore();
  keepCart(store, ME, TODAY, { lines: LINES, customerId: null });
  forgetCart(store);
  assert.equal(recallCart<Line>(store, ME, TODAY), null);
});

// -------------------------------------------------- whose, and from what day

test("somebody else's basket is never handed over", () => {
  // The owner and the attendant share the counter phone. A basket one of them
  // left must not turn up under the other, who cannot know what is in it.
  const store = fakeStore();
  keepCart(store, ME, TODAY, { lines: LINES, customerId: null });

  assert.equal(recallCart<Line>(store, 99, TODAY), null, "not this person's basket");
  assert.equal(store.data.has(CART_KEY), false, "and it is cleared rather than left lying about");
});

test("yesterday's basket does not resurrect", () => {
  // Prices move and stock moves. A basket from a day ago invites an attendant
  // to charge yesterday's price for something already sold to somebody else.
  const store = fakeStore();
  keepCart(store, ME, "2026-09-27", { lines: LINES, customerId: null });
  assert.equal(recallCart<Line>(store, ME, TODAY), null);
  assert.equal(store.data.has(CART_KEY), false);
});

// ------------------------------------------------------- when it goes wrong

test("a corrupt basket is dropped, not thrown", () => {
  const store = fakeStore({ [CART_KEY]: "{not json at all" });
  assert.equal(recallCart<Line>(store, ME, TODAY), null);
  assert.equal(store.data.has(CART_KEY), false, "and it cannot go wrong twice");
});

test("a basket with no lines in it is treated as no basket", () => {
  const store = fakeStore({
    [CART_KEY]: JSON.stringify({ userId: ME, day: TODAY, lines: [], customerId: 3 }),
  });
  assert.equal(recallCart<Line>(store, ME, TODAY), null);
});

test("storage that refuses to answer never reaches the counter", () => {
  // A private window, or a phone with site data blocked: the object is there
  // and every call throws. The till must carry on with an empty basket.
  const angry = {
    getItem() { throw new Error("denied"); },
    setItem() { throw new Error("denied"); },
    removeItem() { throw new Error("denied"); },
  };
  assert.doesNotThrow(() => recallCart<Line>(angry, ME, TODAY));
  assert.equal(recallCart<Line>(angry, ME, TODAY), null);
  assert.doesNotThrow(() => keepCart(angry, ME, TODAY, { lines: LINES, customerId: null }));
  assert.doesNotThrow(() => forgetCart(angry));
});

test("no storage at all is the same as an empty one", () => {
  // The screen renders on the server before it renders on the phone.
  assert.equal(recallCart<Line>(null, ME, TODAY), null);
  assert.doesNotThrow(() => keepCart(undefined, ME, TODAY, { lines: LINES, customerId: null }));
  assert.doesNotThrow(() => forgetCart(null));
});
