"use client";

/**
 * The counter screen.
 *
 * Everything here is shaped by one number: three taps for an ordinary sale.
 *   tap the item  →  tap "Pay"  →  tap "Take KES x — done"
 * So there are no confirmation dialogs and no quantity prompt (tap the tile
 * again to add another).
 *
 * Payment asks the two questions a shopkeeper actually asks — how much now, and
 * how — and treats the balance as the leftover. Credit is deliberately NOT a
 * method to choose: an unpaid balance simply asks whose account it belongs to.
 *
 * Two things are deliberately NOT sent to this component:
 *   - `floor_cents`, because for a repacked chemical it is the cost price and
 *     staff must never see cost. A haggled price is offered to the server, the
 *     server refuses it, and only then is the owner's PIN asked for.
 *   - `cost_cents`, for the same reason.
 */

import Link from "next/link";
import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
} from "react";
import type { PayMethod, Tier } from "@/lib/sales";
import { countOutbox, enqueueSale, onOutboxChange, type QueuedSalePayload } from "@/lib/offline";
import { formatDate, formatDateTime, formatKes, formatQty, formatUnits } from "@/lib/units";
import { Alert, Button, Chip, SectionLabel, inputClass } from "@/components/ui";
import { quickAddCustomerAction } from "@/app/customers/actions";

/** Sentinel value for the "＋ New customer" row in the customer dropdown. */
const NEW_CUSTOMER = "__new";

/**
 * The two things this shop sells, and the order they are offered in.
 *
 * Products first because it is the shorter list and the commoner walk-in; the
 * chemical buyer knows what they came for and is one tap (or one swipe) away.
 * Search cuts across both, so nobody has to guess which board a thing is on.
 */
type Board = "products" | "chemicals";
const BOARDS: Array<{ key: Board; label: string }> = [
  { key: "products", label: "Products" },
  { key: "chemicals", label: "Chemicals" },
];

/** Far enough to be a swipe, and flat enough not to be a scroll. */
const SWIPE_MIN_X = 56;
const SWIPE_MAX_Y = 40;

// ------------------------------------------------------------- wire types

export interface SellItem {
  id: number;
  name: string;
  kind: "finished" | "pack" | "other";
  unitLabel: string;
  sizeMilli: number;
  retailCents: number;
  wholesaleCents: number;
  qtyMilli: number;
  /** name + chemical name + aliases, lower-cased, so "sles" finds Ungerol */
  search: string;
}

export interface SellCustomer {
  id: number;
  name: string;
  kind: "retail" | "wholesale";
  limitCents: number;
  outstandingCents: number;
}

/** A previous order, offered back as "same as last time". Quantities only. */
export interface RepeatOrder {
  at: string;
  lines: Array<{ itemId: number; name: string; units: number; available: boolean }>;
}

/** One recipe the owner can sell as a kit. */
export interface KitChoice {
  versionId: number;
  name: string;
  refSizeMilli: number;
}

/** A recipe worked out into whole packs, ready to drop into the cart. */
export interface KitOffer {
  formulaName: string;
  targetMilli: number;
  ingredients: Array<{
    chemicalName: string;
    unit: string;
    neededMilli: number;
    suppliedMilli: number;
    missing: boolean;
    oversized: boolean;
    picks: Array<{ itemId: number; name: string; units: number }>;
  }>;
}

export interface PayloadLine {
  itemId: number;
  units: number;
  unitPriceCents: number;
}

export interface PayloadTender {
  method: PayMethod;
  amountCents: number;
  mpesaCode?: string;
}

export interface SalePayload {
  clientUuid: string;
  tier: Tier;
  lines: PayloadLine[];
  tenders: PayloadTender[];
  customerId: number | null;
  ownerPin?: string;
}

export type SellState =
  | { status: "idle" }
  /** A refusal the counter can fix — wrong amount, missing code, unknown item. */
  | { status: "error"; message: string }
  /** A price below the floor: the owner has to approve it in person. */
  | { status: "pin"; message: string }
  | {
      status: "done";
      saleId: number;
      totalCents: number;
      paidCents: number;
      outstandingCents: number;
    }
  /**
   * Saved on the phone, not yet on the till. This is a success, not an error —
   * the customer has paid and can leave — so it reads like one.
   */
  | {
      status: "queued";
      clientUuid: string;
      totalCents: number;
      queuedAt: string;
      /** `offline` = the phone knew; `unreachable` = it thought it was online. */
      reason: "offline" | "unreachable";
    };

export const IDLE: SellState = { status: "idle" };

/**
 * How long to wait for the till before deciding the sale belongs in the outbox.
 *
 * Safaricom's failure mode is not a clean disconnection — it is a request that
 * hangs. A spinner that never resolves in front of a queue is exactly what
 * sends the shop back to the paper notebook, so there is a deadline.
 */
const TILL_TIMEOUT_MS = 12_000;

// ------------------------------------------------------------------ helpers

/**
 * The shop's counter phone may reach the till over plain http on the LAN, and
 * `crypto.randomUUID` is only exposed in secure contexts — so fall back rather
 * than lose the idempotency key that makes a retry safe.
 */
function newUuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();

  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (n) => n.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** `navigator.onLine` is a hint, not a fact — but a false one is worth acting on. */
function seemsOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the till did not answer")), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Move a cart into the outbox.
 *
 * The owner PIN is deliberately dropped: it must never sit at rest on the shared
 * counter phone. It is asked for again at send time if it is still needed.
 *
 * The credit-limit check does not travel either, and cannot: it is a question
 * asked of an owner standing at the counter, and by the time a queued sale
 * reaches the till the goods have gone home with the customer. Offline credit is
 * therefore recorded as it happened rather than refused after the fact — the
 * sync audit line is where the owner sees what came in while the line was down.
 */
async function queueSale(
  payload: SalePayload,
  reason: "offline" | "unreachable",
): Promise<SellState> {
  const totalCents = payload.lines.reduce((sum, l) => sum + l.unitPriceCents * l.units, 0);
  const queuedAt = new Date().toISOString();

  const queued: QueuedSalePayload = {
    clientUuid: payload.clientUuid,
    tier: payload.tier,
    lines: payload.lines.map((l) => ({ ...l })),
    tenders: payload.tenders.map((t) => ({
      method: t.method,
      amountCents: t.amountCents,
      // An absent code must stay absent rather than become the string
      // "undefined" once IndexedDB and JSON have both had a turn at it.
      ...(t.mpesaCode ? { mpesaCode: t.mpesaCode } : {}),
    })),
    customerId: payload.customerId,
    queuedAt,
    totalCents,
  };

  try {
    await enqueueSale(queued);
    return { status: "queued", clientUuid: payload.clientUuid, totalCents, queuedAt, reason };
  } catch {
    // The one case where the counter must be told to reach for the notebook:
    // there is no network AND no storage. Never a silent failure.
    return {
      status: "error",
      message:
        "This phone cannot reach the till and cannot save the sale either. " +
        "Write it down and enter it when the connection is back.",
    };
  }
}

function listPrice(item: SellItem, tier: Tier): number {
  if (tier === "wholesale" && item.wholesaleCents > 0) return item.wholesaleCents;
  return item.retailCents;
}

/** "75.50" → 7550. Blank or nonsense → null, so a slip never becomes a zero. */
function parseCents(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function centsToInput(cents: number): string {
  return String(cents / 100);
}

/**
 * Split "Carwash Shampoo 1 L" into the product and the pack size.
 *
 * The size is the whole point of the tile — the same chemical sits on the shelf
 * in five sizes, and picking the wrong one is the counter's most expensive slip.
 * Kept in one string it was the first thing an ellipsis ate: "Carwash Shampo…",
 * "Caustic Soda — …", size gone. Pulled out, the product name gets the line it
 * needs and the size gets its own, always legible, always in the same place.
 *
 * Display-only, and it never invents anything: a name it cannot split is shown
 * whole with no size line.
 */
function splitName(name: string): { base: string; size: string | null } {
  const dash = name.lastIndexOf(" — ");
  if (dash > 0) return { base: name.slice(0, dash), size: name.slice(dash + 3) };
  // Finished products are named without the dash: "Laundry Soap 1 L".
  const tail = name.match(/^(.*\S)\s+(\d+(?:\.\d+)?\s?(?:kg|g|ml|l|pcs|pc))$/i);
  if (tail) return { base: tail[1], size: tail[2] };
  return { base: name, size: null };
}

/**
 * Shelf order, not string order.
 *
 * Sorted by name alone, Ungerol reads 1 kg, 20 kg, 250 g, 500 g, 5 kg — five
 * sizes of one chemical in an order that matches nothing on the shelf and
 * nothing in anyone's head. Grouping by product and then by ascending size
 * gives 250 g, 500 g, 1 kg, 5 kg, 20 kg.
 */
function shelfOrder(a: SellItem, b: SellItem): number {
  const cmp = splitName(a.name).base.localeCompare(splitName(b.name).base);
  return cmp !== 0 ? cmp : a.sizeMilli - b.sizeMilli;
}

interface CartLine {
  itemId: number;
  units: number;
  priceCents: number;
}

// ------------------------------------------------------------------- screen

export default function SellClient({
  items,
  topSellerIds,
  customers,
  stockAsOf,
  action,
  isOwner,
  kits,
  onLastOrder,
  onKit,
}: {
  items: SellItem[];
  topSellerIds: number[];
  customers: SellCustomer[];
  /** When the server read these stock counts. Shown whenever they may be stale. */
  stockAsOf: string;
  action: (prev: SellState, payload: SalePayload) => Promise<SellState>;
  isOwner: boolean;
  /** Empty for staff: recipe quantities stay owner-only. */
  kits: KitChoice[];
  onLastOrder: (customerId: number) => Promise<RepeatOrder | null>;
  onKit: (versionId: number, targetMilli: number) => Promise<KitOffer | null>;
}) {
  const [tier, setTier] = useState<Tier>("retail");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [query, setQuery] = useState("");
  const [board, setBoard] = useState<Board>("products");
  const swipeFrom = useRef<{ x: number; y: number } | null>(null);
  const [sheet, setSheet] = useState<"none" | "cart" | "pay">("none");
  /**
   * The desktop till panel shows one thing at a time — the cart, or payment.
   *
   * Both at once is what broke it: the payment form under six cart lines is
   * taller than any laptop screen, so the bill and the Complete button lived
   * below the fold. One pane at a time keeps the panel a fixed height, the total
   * always in view, and the sale three clicks long — the same three the phone
   * has always had.
   */
  const [deskPane, setDeskPane] = useState<"cart" | "pay">("cart");

  /**
   * Payment, the way a shopkeeper says it: "he is giving me 3,000 now, the rest
   * goes on his account." So the counter answers two questions — how much now,
   * and how — and the balance is simply what is left. Credit is never a button
   * to choose; it is the leftover, and it only ever asks for a name.
   *
   * `payNow === null` means "the whole bill", which keeps tracking the total as
   * the cart changes without an effect to re-sync it.
   */
  const [payNow, setPayNow] = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState<"cash" | "mpesa">("cash");
  const [payCode, setPayCode] = useState("");
  /** The rare real case: part cash, part M-Pesa, on the same bill. */
  const [second, setSecond] = useState<{ amount: string; method: "cash" | "mpesa"; code: string } | null>(
    null,
  );
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [ownerPin, setOwnerPin] = useState("");

  /**
   * Adding a customer without leaving the sale.
   *
   * A new face who wants a receipt used to mean abandoning the counter screen
   * for the debtors screen and coming back — four steps with somebody waiting.
   * `added` holds the ones created here so they appear in the list immediately,
   * without waiting for the page's own data to come round again.
   */
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [addPending, setAddPending] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [added, setAdded] = useState<SellCustomer[]>([]);

  /** The named customer's last order, once looked up. `null` = not looked up. */
  const [repeat, setRepeat] = useState<RepeatOrder | null>(null);
  const [kitOpen, setKitOpen] = useState(false);
  const [kitVersion, setKitVersion] = useState<number | null>(null);
  const [kitSize, setKitSize] = useState("");
  const [kitOffer, setKitOffer] = useState<KitOffer | null>(null);
  const [kitBusy, setKitBusy] = useState(false);
  const [receipt, setReceipt] = useState<Extract<
    SellState,
    { status: "done" } | { status: "queued" }
  > | null>(null);

  // The counter needs to know, without asking, whether what it sees is live.
  const [online, setOnline] = useState(true);
  const [waiting, setWaiting] = useState(0);

  const uuid = useRef<string>(newUuid());

  // Desktop only: land the cursor in search so a keyboard till can start
  // typing immediately. An autoFocus attribute would pop the phone keyboard.
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) searchRef.current?.focus();
  }, []);

  /**
   * Every submit goes through here, online or not.
   *
   * Wrapping the server action rather than branching before it means the queue
   * catches all three failures the same way: a phone that knows it is offline,
   * a phone that thinks it is online but is not, and a request that hangs. In
   * every case the sale ends up somewhere durable and the counter is told so.
   *
   * A sale that was in fact recorded before the deadline is not lost work: the
   * replay carries the same `client_uuid`, the till answers "already recorded",
   * and the outbox drops it. That is the whole point of the uuid.
   */
  const submitSale = useCallback(
    async (prev: SellState, payload: SalePayload): Promise<SellState> => {
      if (!seemsOnline()) return queueSale(payload, "offline");
      try {
        return await withDeadline(action(prev, payload), TILL_TIMEOUT_MS);
      } catch {
        return queueSale(payload, "unreachable");
      }
    },
    [action],
  );

  const [state, submit, pending] = useActionState(submitSale, IDLE);

  /**
   * When the till asks for the owner's PIN, put the cursor in it.
   *
   * The box appears low in a panel that scrolls, under the reason it appeared —
   * so without this the counter sees a greyed-out Complete button and no
   * obvious cause. Focusing scrolls it into view and the owner can just type.
   */
  const pinRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state.status !== "pin") return;
    pinRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    pinRef.current?.focus();
  }, [state]);
  const handled = useRef<string>("");

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const lines = cart.map((l) => ({ line: l, item: byId.get(l.itemId)! })).filter((x) => x.item);
  const totalCents = lines.reduce((s, x) => s + x.line.priceCents * x.line.units, 0);
  const unitCount = cart.reduce((s, l) => s + l.units, 0);

  // What is being handed over now, and therefore what goes on the account.
  const firstCents = payNow === null ? totalCents : (parseCents(payNow) ?? 0);
  const secondCents = second ? (parseCents(second.amount) ?? 0) : 0;
  const paidCents = Math.max(0, firstCents) + Math.max(0, secondCents);
  const onAccountCents = Math.max(0, totalCents - paidCents);
  const overpaidCents = Math.max(0, paidCents - totalCents);
  const outstandingCents = onAccountCents;

  const allCustomers = useMemo(() => [...customers, ...added], [customers, added]);
  const customer = allCustomers.find((c) => c.id === customerId) ?? null;

  /**
   * Choose the customer, and price the cart the way that customer buys.
   *
   * Only upward, to wholesale: a wholesale buyer on retail prices is a bill
   * nobody wants to argue about. The reverse is left alone — an attendant who
   * deliberately set wholesale for a walk-in bulk order should not have it
   * silently undone by naming a retail customer.
   */
  function pickCustomer(id: number | null) {
    setCustomerId(id);
    setRepeat(null);
    const c = id === null ? null : allCustomers.find((x) => x.id === id);
    if (c?.kind === "wholesale" && tier === "retail") switchTier("wholesale");
  }

  // Look up what a named customer bought last time, once, when they are named.
  useEffect(() => {
    if (customerId === null) return;
    let live = true;
    onLastOrder(customerId)
      .then((order) => {
        if (live) setRepeat(order);
      })
      .catch(() => {
        // Offline, or the till did not answer. The button simply does not
        // appear; nothing about the sale depends on it.
      });
    return () => {
      live = false;
    };
  }, [customerId, onLastOrder]);

  /**
   * Swiping between the boards.
   *
   * Deliberately hand-rolled and deliberately fussy: the product grid scrolls
   * vertically, and a carousel that hijacks a downward flick is worse than no
   * carousel at all. So a gesture only counts if it travelled a good way
   * sideways and barely at all up or down.
   */
  function onBoardTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    swipeFrom.current = t ? { x: t.clientX, y: t.clientY } : null;
  }

  function onBoardTouchEnd(e: React.TouchEvent) {
    const from = swipeFrom.current;
    swipeFrom.current = null;
    const t = e.changedTouches[0];
    if (!from || !t) return;

    const dx = t.clientX - from.x;
    const dy = t.clientY - from.y;
    if (Math.abs(dx) < SWIPE_MIN_X || Math.abs(dy) > SWIPE_MAX_Y) return;

    setBoard(dx < 0 ? "chemicals" : "products");
  }

  /** Fill the cart from that last order, at today's prices. */
  function fillFromRepeat() {
    if (!repeat) return;
    setCart(
      repeat.lines
        .filter((l) => l.available)
        .map((l) => {
          const item = byId.get(l.itemId);
          return item ? { itemId: item.id, units: l.units, priceCents: listPrice(item, tier) } : null;
        })
        .filter((l): l is CartLine => l !== null),
    );
  }

  /** Work the recipe out into packs, then show what it comes to before adding. */
  async function previewKit() {
    if (kitVersion === null) return;
    const litres = Number(kitSize);
    if (!Number.isFinite(litres) || litres <= 0) return;
    setKitBusy(true);
    try {
      setKitOffer(await onKit(kitVersion, Math.round(litres * 1000)));
    } catch {
      setKitOffer(null);
    } finally {
      setKitBusy(false);
    }
  }

  /** Drop the worked-out packs into the cart as ordinary lines. */
  function addKitToCart() {
    if (!kitOffer) return;
    for (const ing of kitOffer.ingredients) {
      if (ing.missing || ing.oversized) continue;
      for (const pick of ing.picks) {
        const item = byId.get(pick.itemId);
        if (item) addUnits(item, pick.units);
      }
    }
    setKitOpen(false);
    setKitOffer(null);
  }

  async function saveNewCustomer() {
    const name = newName.trim();
    if (!name) return;
    setAddPending(true);
    setAddError(null);
    try {
      const result = await quickAddCustomerAction(name, newPhone.trim());
      if (!result.ok) {
        setAddError(result.error);
        return;
      }
      // Straight into the sale: adding them and then having to find them in the
      // list would be the same four steps in a smaller box.
      setAdded((prev) => [...prev, {
        id: result.id,
        name: result.name,
        kind: "retail",
        limitCents: 0,
        outstandingCents: 0,
      }]);
      setCustomerId(result.id);
      setAdding(false);
      setNewName("");
      setNewPhone("");
    } catch {
      setAddError("Could not reach the till. Add them from Debts when the network is back.");
    } finally {
      setAddPending(false);
    }
  }

  // Selling more than is on the shelf is allowed — the customer is holding the
  // goods — but it must not be silent, or the stock count and the profit report
  // quietly drift negative. Finished/pack items have a real count; "other" does
  // not, so it is left alone.
  const oversold = lines.filter(
    (x) => x.item.kind !== "other" && x.item.sizeMilli > 0 && x.line.units * x.item.sizeMilli > x.item.qtyMilli,
  );
  const mpesaIncomplete =
    (payMethod === "mpesa" && firstCents > 0 && !payCode.trim()) ||
    (second !== null && second.method === "mpesa" && secondCents > 0 && !second.code.trim());
  const needsCustomer = onAccountCents > 0;

  // --- after a completed sale, start clean --------------------------------
  // Resetting the tier is the point: a toggle left on wholesale silently
  // mis-prices every sale for the rest of the day.
  //
  // A queued sale resets exactly like a recorded one. The customer has paid and
  // walked off; making the counter treat "saved here" differently from "saved
  // there" is how a queue builds up behind one confused attendant.
  useEffect(() => {
    const key =
      state.status === "done"
        ? `sale:${state.saleId}`
        : state.status === "queued"
          ? `queued:${state.clientUuid}`
          : "";
    if (!key || handled.current === key) return;

    handled.current = key;
    setReceipt(state as Extract<SellState, { status: "done" } | { status: "queued" }>);
    setCart([]);
    setPayNow(null);
    setPayMethod("cash");
    setPayCode("");
    setSecond(null);
    setCustomerId(null);
    setOwnerPin("");
    setTier("retail");
    setQuery("");
    setSheet("none");
    setDeskPane("cart");
    setRepeat(null);
    setKitOpen(false);
    setKitOffer(null);
    setBoard("products");
    uuid.current = newUuid();
  }, [state]);

  // --- cart survives leaving the screen -----------------------------------
  // An attendant mid-order taps Stock to check a shelf, comes back, and the cart
  // must still be there — otherwise a six-line order is re-rung from memory with
  // a queue waiting. sessionStorage persists across navigation within the app but
  // clears when it's closed, so yesterday's cart never resurrects.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const raw = sessionStorage.getItem("riziki_cart");
      if (!raw) return;
      const saved = JSON.parse(raw) as { cart: CartLine[]; tier: Tier };
      if (saved.cart?.length) {
        setCart(saved.cart);
        if (saved.tier === "retail" || saved.tier === "wholesale") setTier(saved.tier);
      }
    } catch {
      /* a corrupt cart is not worth crashing the till over */
    }
  }, []);

  useEffect(() => {
    try {
      if (cart.length) sessionStorage.setItem("riziki_cart", JSON.stringify({ cart, tier }));
      else sessionStorage.removeItem("riziki_cart");
    } catch {
      /* private mode / storage full — the cart just won't survive navigation */
    }
  }, [cart, tier]);

  // --- connection and outbox ----------------------------------------------
  useEffect(() => {
    let alive = true;
    const recount = () => {
      void countOutbox().then((n) => {
        if (alive) setWaiting(n);
      });
    };

    setOnline(navigator.onLine);
    recount();

    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    const stopWatching = onOutboxChange(recount);

    return () => {
      alive = false;
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      stopWatching();
    };
  }, []);

  // --- cart ---------------------------------------------------------------

  function addItem(item: SellItem) {
    setReceipt(null);
    setCart((prev) => {
      const at = prev.findIndex((l) => l.itemId === item.id);
      if (at >= 0) {
        const next = [...prev];
        next[at] = { ...next[at], units: next[at].units + 1 };
        return next;
      }
      return [...prev, { itemId: item.id, units: 1, priceCents: listPrice(item, tier) }];
    });
  }

  function changeUnits(itemId: number, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.itemId === itemId ? { ...l, units: l.units + delta } : l))
        .filter((l) => l.units > 0),
    );
  }

  /**
   * Set a quantity outright.
   *
   * Twenty of something used to be twenty taps. `recordSale` still insists on a
   * whole number of units — that rule is what keeps stock, costing and the
   * receipt honest — so this clamps to one rather than accepting anything else.
   */
  function setUnits(itemId: number, units: number) {
    if (!Number.isFinite(units)) return;
    const whole = Math.max(1, Math.min(9999, Math.floor(units)));
    setCart((prev) => prev.map((l) => (l.itemId === itemId ? { ...l, units: whole } : l)));
  }

  /**
   * Put an item in the cart n times over.
   *
   * Used by the search box ("20 laundry ⏎"), by "same as last time" and by the
   * kit builder. Adding to whatever is already there is deliberate: two kits of
   * the same recipe should come to two kits' worth of chemicals.
   */
  function addUnits(item: SellItem, units: number) {
    const n = Math.max(1, Math.floor(units));
    setCart((prev) => {
      const at = prev.findIndex((l) => l.itemId === item.id);
      if (at >= 0) {
        const next = [...prev];
        next[at] = { ...next[at], units: next[at].units + n };
        return next;
      }
      return [...prev, { itemId: item.id, units: n, priceCents: listPrice(item, tier) }];
    });
  }

  function setLinePrice(itemId: number, cents: number) {
    setCart((prev) => prev.map((l) => (l.itemId === itemId ? { ...l, priceCents: cents } : l)));
  }

  /**
   * Switching tier re-prices the whole cart, haggled lines included. Carrying a
   * negotiated retail price into a wholesale bill is the more expensive mistake.
   */
  function switchTier(next: Tier) {
    setTier(next);
    setCart((prev) =>
      prev.map((l) => {
        const item = byId.get(l.itemId);
        return item ? { ...l, priceCents: listPrice(item, next) } : l;
      }),
    );
  }

  // --- payment ------------------------------------------------------------

  /**
   * Turn the two counter questions into the tenders the till stores. The money
   * model is unchanged — one row per way money moved, plus a credit row for the
   * balance — it is only the asking that got simpler.
   */
  function buildTenders(): SalePayload["tenders"] {
    const out: SalePayload["tenders"] = [];
    if (firstCents > 0) {
      out.push({
        method: payMethod,
        amountCents: Math.min(firstCents, totalCents),
        mpesaCode: payMethod === "mpesa" ? payCode.trim() : undefined,
      });
    }
    if (second && secondCents > 0) {
      out.push({
        method: second.method,
        amountCents: secondCents,
        mpesaCode: second.method === "mpesa" ? second.code.trim() : undefined,
      });
    }
    if (onAccountCents > 0) out.push({ method: "credit", amountCents: onAccountCents });
    return out;
  }

  // --- submit -------------------------------------------------------------

  function complete() {
    const payload: SalePayload = {
      clientUuid: uuid.current,
      tier,
      lines: cart.map((l) => ({ itemId: l.itemId, units: l.units, unitPriceCents: l.priceCents })),
      tenders: buildTenders(),
      customerId,
      ownerPin: ownerPin.trim() || undefined,
    };
    startTransition(() => submit(payload));
  }

  // --- item lists ---------------------------------------------------------

  const q = query.trim().toLowerCase();
  /**
   * "20 laundry" means twenty of it.
   *
   * A leading number is never part of a product name here — sizes live at the
   * end ("Laundry Soap 5 L") — so a count at the front is unambiguous, and it
   * turns the commonest wholesale line into one keystroke sequence. The number
   * is stripped before matching, so "20 laundry" still finds Laundry Soap.
   */
  const countMatch = q.match(/^(\d{1,4})\s*[x*]?\s+(.*)$/);
  const queryCount = countMatch ? Math.max(1, Number(countMatch[1])) : 1;
  const searchText = countMatch ? countMatch[2].trim() : q;

  const matches = searchText
    ? items.filter((i) => i.search.includes(searchText)).sort(shelfOrder)
    : [];
  const finished = items.filter((i) => i.kind === "finished").sort(shelfOrder);
  // Anything that is not something Riziki mixed is a chemical to the person
  // buying it. Folding "other" in here rather than into its own section means a
  // priced item can never end up on no board at all.
  const chemicals = items.filter((i) => i.kind !== "finished").sort(shelfOrder);
  const top = topSellerIds.map((id) => byId.get(id)).filter((i): i is SellItem => Boolean(i));

  const wholesale = tier === "wholesale";

  /** Lines from the last order that can still be sold today. */
  const repeatUsable = repeat ? repeat.lines.filter((l) => l.available && byId.has(l.itemId)) : [];

  /** Kit ingredients this shop cannot sell as packs, and how many it can. */
  const kitLeftOut = (kitOffer?.ingredients ?? [])
    .filter((i) => i.missing || i.oversized)
    .map((i) => i.chemicalName);
  const kitAddable = (kitOffer?.ingredients ?? []).filter((i) => !i.missing && !i.oversized).length;


  // ---- shared render closures: one markup, two dressings (phone sheet /
  // desktop panel). They close over all state; nothing is duplicated. ----

  /**
   * After a sale: the receipt is one tap away, the next customer zero taps.
   * Queued (offline) sales have no server receipt yet, so they keep the
   * reassurance banner instead.
   */
  const renderReceipt = () => {
    if (!receipt) return null;
    if (receipt.status === "queued") {
      return (
        <Alert tone="warn">
          Saved on this phone — {formatKes(receipt.totalCents)}.{" "}
          {receipt.reason === "offline" ? "There is no network." : "The till did not answer."}{" "}
          It will send itself as soon as the connection is back. Nothing is lost.
        </Alert>
      );
    }
    return (
      <div className="rounded-2xl bg-good-soft p-3.5 ring-1 ring-inset ring-good/25">
        <p className="text-sm font-semibold text-good">
          Sale #{receipt.saleId} recorded — {formatKes(receipt.totalCents)}.{" "}
          {receipt.outstandingCents > 0
            ? `${formatKes(receipt.outstandingCents)} on credit.`
            : "Paid in full."}
        </p>
        <div className="mt-2.5 flex gap-2">
          <Link
            href={`/invoice/${receipt.saleId}?new=1`}
            className="flex-1 rounded-full bg-brand px-4 py-2.5 text-center text-sm font-bold text-white shadow-sm hover:bg-brand-dark"
          >
            Receipt / invoice
          </Link>
          <button
            type="button"
            onClick={() => setReceipt(null)}
            className="flex-1 rounded-full bg-white px-4 py-2.5 text-sm font-bold text-brand-dark ring-1 ring-inset ring-line hover:bg-wash"
          >
            Next sale
          </button>
        </div>
      </div>
    );
  };

  const renderCartBody = () => (
    <>
        {/* Hairlines between rows, not a box around each one: a list of six
            things should read as one list. */}
        <div className="divide-y divide-line">
          {lines.map(({ line, item }) => (
            <CartRow
              key={line.itemId}
              item={item}
              line={line}
              tier={tier}
              onUnits={(d) => changeUnits(line.itemId, d)}
              onPrice={(c) => setLinePrice(line.itemId, c)}
            />
          ))}
        </div>
        {oversold.length ? (
          <div className="mt-3">
            <Alert tone="warn">
              Selling more {oversold.length === 1 ? oversold[0].item.name : "of some items"} than the
              shelf shows. The sale is fine — the count will just go negative until you do a stock
              take.
            </Alert>
          </div>
        ) : null}

    </>
  );

  const renderPayBody = () => (
    <>
        {/* The bill, then the only two questions the counter has to answer. */}
        <div className="rounded-2xl bg-wash p-3.5 ring-1 ring-inset ring-line">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
              Bill
            </span>
            <span className="text-2xl font-extrabold tracking-tight text-brand-deep tnum">
              {formatKes(totalCents)}
            </span>
          </div>
        </div>

        <label className="mt-3 block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
            Paying now
          </span>
          <input
            className={`${inputClass} !text-xl !font-extrabold tnum`}
            value={payNow ?? centsToInput(totalCents)}
            onChange={(e) => setPayNow(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            inputMode="decimal"
            aria-label="Amount being paid now, in shillings"
          />
        </label>
        {/* One control, not two. Typing a smaller number already says "the rest
            is owed" — the balance below works it out — so a second button for
            it was a button that said the same thing twice. "Paid in full" stays
            because it is the way back, and it only appears when there is
            something to come back from. */}
        {onAccountCents > 0 || overpaidCents > 0 ? (
          <button
            type="button"
            onClick={() => {
              setPayNow(null);
              setSecond(null);
            }}
            className="mt-2 w-full rounded-full bg-white px-3 py-2.5 text-sm font-bold text-brand-dark ring-1 ring-inset ring-line transition-colors hover:bg-wash"
          >
            Paid in full — {formatKes(totalCents)}
          </button>
        ) : null}

        {paidCents > 0 ? (
          <div className="mt-3">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
              How
            </span>
            <div className="grid grid-cols-2 gap-2">
              {(["cash", "mpesa"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPayMethod(m)}
                  className={`min-h-12 rounded-2xl px-3 text-sm font-bold ring-1 ring-inset transition-colors ${
                    payMethod === m
                      ? "bg-brand text-white shadow-sm ring-brand"
                      : "bg-white text-brand-dark ring-line"
                  }`}
                >
                  {m === "cash" ? "Cash" : "M-Pesa"}
                </button>
              ))}
            </div>
            {payMethod === "mpesa" ? (
              <input
                className={`${inputClass} mt-2 uppercase`}
                value={payCode}
                onChange={(e) => setPayCode(e.target.value)}
                placeholder="M-Pesa code, e.g. QGH7X1TEST"
                aria-label="M-Pesa transaction code"
                autoCapitalize="characters"
                autoComplete="off"
                required
              />
            ) : null}

            {/* Part cash, part M-Pesa happens; it should not shape the screen
                for everyone else, so it stays one line until it is needed. */}
            {second ? (
              <div className="mt-2.5 rounded-2xl bg-wash p-2.5 ring-1 ring-inset ring-line">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                    And also
                  </span>
                  <button
                    type="button"
                    onClick={() => setSecond(null)}
                    className="ml-auto text-xs font-bold text-muted"
                  >
                    Remove
                  </button>
                </div>
                <input
                  className={`${inputClass} mt-2 tnum`}
                  value={second.amount}
                  onChange={(e) => setSecond({ ...second, amount: e.target.value })}
                  inputMode="decimal"
                  placeholder="Amount"
                  aria-label="Second payment amount"
                />
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {(["cash", "mpesa"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setSecond({ ...second, method: m })}
                      className={`min-h-11 rounded-xl px-3 text-sm font-bold ring-1 ring-inset ${
                        second.method === m
                          ? "bg-brand text-white ring-brand"
                          : "bg-white text-brand-dark ring-line"
                      }`}
                    >
                      {m === "cash" ? "Cash" : "M-Pesa"}
                    </button>
                  ))}
                </div>
                {second.method === "mpesa" ? (
                  <input
                    className={`${inputClass} mt-2 uppercase`}
                    value={second.code}
                    onChange={(e) => setSecond({ ...second, code: e.target.value })}
                    placeholder="M-Pesa code"
                    aria-label="Second M-Pesa transaction code"
                    autoCapitalize="characters"
                    autoComplete="off"
                    required
                  />
                ) : null}
              </div>
            ) : (
              <button
                type="button"
                onClick={() =>
                  setSecond({
                    amount: centsToInput(Math.max(0, totalCents - firstCents)),
                    method: payMethod === "cash" ? "mpesa" : "cash",
                    code: "",
                  })
                }
                className="mt-2 w-full py-1 text-center text-xs font-bold text-brand-dark"
              >
                Part cash, part M-Pesa?
              </button>
            )}
          </div>
        ) : null}

        {overpaidCents > 0 ? (
          <div className="mt-3">
            <Alert tone="bad">
              That is {formatKes(overpaidCents)} more than the bill. Change is counted out of the
              drawer, not typed in here.
            </Alert>
          </div>
        ) : null}

        {onAccountCents > 0 ? (
          <div className="mt-3 rounded-2xl bg-warn-soft px-3.5 py-3 ring-1 ring-inset ring-warn/25">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-bold text-warn">To pay later</span>
              <span className="text-lg font-extrabold text-warn tnum">
                {formatKes(onAccountCents)}
              </span>
            </div>
          </div>
        ) : null}

        {/* Customer first: if credit is about to be involved, the required
            field sits above the button that would otherwise fail below it. */}
        {needsCustomer || customers.length ? (
          <div className="mt-3">
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
              {needsCustomer ? "Who is paying later?" : "Customer (optional)"}
            </label>
            {adding ? (
              /* Two fields, because the moment this is used is the moment
                 somebody is standing there waiting. Everything else about a
                 customer is the owner's to fill in afterwards, on the debtors
                 screen, and the sale should not wait for it. */
              <div className="rounded-2xl bg-wash p-3 ring-1 ring-inset ring-line">
                <input
                  className={inputClass}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Name"
                  aria-label="New customer's name"
                  autoComplete="off"
                  autoFocus
                />
                <input
                  className={`${inputClass} mt-2`}
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="Phone — for the receipt (optional)"
                  aria-label="New customer's phone number"
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                />
                {addError ? (
                  <p className="mt-2 text-xs font-semibold text-bad">{addError}</p>
                ) : null}
                <div className="mt-2 flex gap-2">
                  <Button
                    className="flex-1 py-2.5 text-sm"
                    disabled={addPending || !newName.trim()}
                    onClick={saveNewCustomer}
                  >
                    {addPending ? "Adding…" : "Add & use"}
                  </Button>
                  <Button
                    variant="ghost"
                    className="px-4 py-2.5 text-sm"
                    onClick={() => {
                      setAdding(false);
                      setAddError(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
                <p className="mt-2 text-[11px] text-muted">
                  New customers start with no credit limit, so anything they owe needs the owner&apos;s
                  PIN until he sets one.
                </p>
              </div>
            ) : (
              <select
                className={inputClass}
                value={customerId ?? ""}
                onChange={(e) => {
                  if (e.target.value === NEW_CUSTOMER) {
                    setAdding(true);
                    setAddError(null);
                    return;
                  }
                  setCustomerId(e.target.value ? Number(e.target.value) : null);
                }}
              >
                <option value="">Walk-in — no name</option>
                {allCustomers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — owes {formatKes(c.outstandingCents)}
                    {c.limitCents > 0 ? ` of ${formatKes(c.limitCents)}` : ""}
                  </option>
                ))}
                {/* Offline this cannot work — the till assigns the id — and a
                    disabled option that says why beats one that fails. */}
                <option value={NEW_CUSTOMER} disabled={!online}>
                  {online ? "＋ New customer…" : "＋ New customer (needs the network)"}
                </option>
              </select>
            )}

            {/* A wholesale buyer on a retail-priced cart is a bill nobody
                wants to argue about at the counter. Prompt, don't switch
                silently — the attendant may have priced it retail on purpose. */}
            {customer && customer.kind === "wholesale" && tier === "retail" ? (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-warn-soft px-3 py-2">
                <span className="text-xs font-semibold text-warn">
                  {customer.name} usually buys at wholesale.
                </span>
                <button
                  type="button"
                  onClick={() => switchTier("wholesale")}
                  className="shrink-0 rounded-lg bg-warn px-2.5 py-1 text-xs font-bold text-white"
                >
                  Use wholesale prices
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {state.status === "pin" ? (
          <div className="mt-3 space-y-2">
            <Alert tone="warn">{state.message}</Alert>
            <input
              ref={pinRef}
              className={inputClass}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={ownerPin}
              onChange={(e) => setOwnerPin(e.target.value)}
              placeholder="Owner PIN"
              aria-label="Owner PIN"
            />
          </div>
        ) : null}

        {state.status === "error" ? (
          <div className="mt-3">
            <Alert tone="bad">{state.message}</Alert>
          </div>
        ) : null}

        {onAccountCents > 0 && customer ? (
          <p className="mt-3 text-xs text-muted">
            {customer.name} owes {formatKes(customer.outstandingCents)} today and will owe{" "}
            {formatKes(customer.outstandingCents + onAccountCents)} after this.
          </p>
        ) : null}

    </>
  );

  /**
   * The button that ends the sale, kept separate from the form above it.
   *
   * On the phone it simply follows the form inside the sheet, exactly as before.
   * On a laptop it is pinned to the bottom of the till panel, because a Complete
   * button that scrolls away below six cart lines is a button nobody can find.
   */
  const renderPayButton = () => (
    <>
      <Button
        className="w-full text-base"
        disabled={
          pending ||
          !cart.length ||
          overpaidCents > 0 ||
          mpesaIncomplete ||
          (needsCustomer && !customerId) ||
          (state.status === "pin" && !ownerPin.trim())
        }
        onClick={() => complete()}
      >
        {/* The label states the outcome, so nobody has to reconstruct it from
            a running total: "Take 3,000 · 5,400 later". */}
        {pending
          ? online
            ? "Recording…"
            : "Saving on this phone…"
          : !online
              ? `Save on this phone — ${formatKes(totalCents)}`
              : paidCents > 0 && onAccountCents > 0
                ? `Take ${formatKes(paidCents)} · ${formatKes(onAccountCents)} later`
                : onAccountCents > 0
                  ? `${formatKes(onAccountCents)} to pay later`
                  : `Take ${formatKes(totalCents)} — done`}
      </Button>

      {mpesaIncomplete ? (
        <p className="mt-2 text-xs font-semibold text-bad">
          Type the M-Pesa code before completing.
        </p>
      ) : null}
      {needsCustomer && !customerId ? (
        <p className="mt-2 text-xs font-semibold text-bad">
          Choose who is paying later — the balance has to sit under a name.
        </p>
      ) : null}
    </>
  );

  return (
    <div className="pb-24 lg:flex lg:h-[calc(100dvh-10.25rem)] lg:flex-col lg:pb-0">
      {/* Wholesale has to be impossible to miss — a toggle left in the wrong
          position mis-prices every sale until somebody notices at day close. */}
      {wholesale ? (
        <div className="sticky top-0 z-20 -mx-4 mb-3 flex items-center gap-3 bg-warn px-4 py-2.5 text-white shadow-sm">
          <span className="text-sm font-extrabold uppercase tracking-[0.14em]">Wholesale prices</span>
          <button
            type="button"
            onClick={() => switchTier("retail")}
            className="ml-auto rounded-lg bg-white/20 px-3 py-1.5 text-xs font-bold"
          >
            Back to retail
          </button>
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold tracking-tight">Sell</h1>
        <Link href="/sales" className="text-xs font-bold text-brand">
          History
        </Link>

        {/* Who is buying, before what they are buying.
            The tier toggle used to be set by hand and the mismatch only noticed
            at payment — after every line had been priced retail. Naming the
            customer first prices the cart right from the first tap, which is
            also what makes "same as last time" possible. */}
        <select
          className="ml-auto max-w-[13rem] truncate rounded-xl border border-line bg-white px-2.5 py-2 text-xs font-bold text-brand-dark"
          value={customerId ?? ""}
          onChange={(e) => pickCustomer(e.target.value ? Number(e.target.value) : null)}
          aria-label="Customer for this sale"
        >
          <option value="">Walk-in — no name</option>
          {allCustomers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.kind === "wholesale" ? " (wholesale)" : ""}
            </option>
          ))}
        </select>

        <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-line">
          {(["retail", "wholesale"] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tier === t}
              onClick={() => switchTier(t)}
              className={`px-3.5 py-2 text-xs font-bold capitalize transition-colors ${
                tier === t
                  ? t === "wholesale"
                    ? "bg-warn text-white"
                    : "bg-brand text-white"
                  : "bg-white text-muted"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {receipt ? <div className="mb-3 lg:hidden">{renderReceipt()}</div> : null}

      {/* Stock read from the till at a moment in time. Offline — or with sales
          still sitting in the outbox — that moment has passed, so say when it
          was rather than letting a stale count read as today's truth. */}
      {!online || waiting > 0 ? (
        <div className="mb-3 rounded-xl border border-line bg-wash px-3.5 py-2.5 text-xs text-muted">
          <span className="font-bold text-ink">
            {online ? "Sending saved sales" : "Offline — you can keep selling."}
          </span>{" "}
          Stock counts below are as of {formatDateTime(stockAsOf)} and do not include
          {waiting > 0
            ? ` the ${waiting} sale${waiting === 1 ? "" : "s"} still waiting to send.`
            : " anything sold since."}
        </div>
      ) : null}

      {/* On a laptop the counter is an app, not a document: the page itself
          stops scrolling and each column scrolls on its own. That is what keeps
          the bill and the Complete button on screen at all times — a sticky
          panel still hung below the fold on load, which is the one thing this
          panel must never do. Phones and tablets keep the ordinary page scroll. */}
      <div className="lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-stretch lg:gap-6 2xl:grid-cols-[minmax(0,1fr)_24rem]">
      {/* A container, so the tile grid counts columns from the space it actually
          has rather than from the window. Collapsing the left rail hands this
          column 168px, and it turns that into another column of products by
          itself — no breakpoint anywhere has to know the rail exists. */}
      <div className="@container min-w-0 lg:h-full lg:overflow-y-auto lg:pr-1">
      {/* Pinned to the top of the scrolling column: on a keyboard till, search
          is how the counter works, and it must never be somewhere up the page. */}
      <div className="lg:sticky lg:top-0 lg:z-10 lg:-mt-1 lg:bg-wash lg:pb-2.5 lg:pt-1">
        <input
          ref={searchRef}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !matches.length) return;
            e.preventDefault();
            addUnits(matches.find((i) => i.qtyMilli > 0) ?? matches[0], queryCount);
            setQuery("");
          }}
          className={inputClass}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search — name, or chemical (sles, labsa…)"
          aria-label="Search items"
        />

        {/* Sticky with the search, so changing board never means scrolling
            back up for it. Hidden while searching: a search already looks
            across both boards, and a switcher that filtered the results would
            hide the very thing that was just found. */}
        {q ? null : (
          <div
            role="tablist"
            aria-label="What to sell"
            className="mt-2 grid grid-cols-2 gap-1 rounded-2xl bg-wash p-1 ring-1 ring-inset ring-line"
          >
            {BOARDS.map((b) => {
              const on = board === b.key;
              const count = (b.key === "products" ? finished : chemicals).length;
              return (
                <button
                  key={b.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setBoard(b.key)}
                  className={`flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-bold transition-colors ${
                    on ? "bg-white text-brand-deep shadow-card" : "text-muted hover:text-ink"
                  }`}
                >
                  {b.label}
                  <span className="text-[11px] font-semibold text-muted tnum">{count}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Two ways to fill a cart in one tap instead of thirty. Both are only
          offered when they would help: an empty cart, and something to offer. */}
      {!cart.length && (repeatUsable.length > 0 || kits.length > 0) ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {repeatUsable.length > 0 ? (
            <button
              type="button"
              onClick={fillFromRepeat}
              className="flex items-center gap-2 rounded-full border border-brand/30 bg-brand-soft py-2 pl-3.5 pr-4 text-left transition-colors hover:border-brand/60"
            >
              <span className="text-[13px] font-bold leading-none text-brand-dark">
                Same as last time
              </span>
              <span className="text-[11px] font-semibold leading-none text-muted">
                {repeatUsable.length} item{repeatUsable.length === 1 ? "" : "s"} ·{" "}
                {formatDate(repeat!.at)}
              </span>
            </button>
          ) : null}

          {kits.length > 0 ? (
            <button
              type="button"
              onClick={() => setKitOpen((v) => !v)}
              aria-expanded={kitOpen}
              className="rounded-full border border-line bg-white py-2 pl-3.5 pr-4 text-[13px] font-bold text-brand-dark transition-colors hover:border-brand/40"
            >
              Mix kit…
            </button>
          ) : null}
        </div>
      ) : null}

      {kitOpen && kits.length > 0 ? (
        <div className="mt-3 rounded-2xl bg-white p-3.5 shadow-card ring-1 ring-ink/5">
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                Recipe
              </span>
              <select
                className={inputClass}
                value={kitVersion ?? ""}
                onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : null;
                  setKitVersion(id);
                  setKitOffer(null);
                  const chosen = kits.find((k) => k.versionId === id);
                  if (chosen) setKitSize(String(chosen.refSizeMilli / 1000));
                }}
              >
                <option value="">Choose…</option>
                {kits.map((k) => (
                  <option key={k.versionId} value={k.versionId}>
                    {k.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="w-28">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                Batch (L)
              </span>
              <input
                className={`${inputClass} tnum`}
                value={kitSize}
                onChange={(e) => {
                  setKitSize(e.target.value);
                  setKitOffer(null);
                }}
                inputMode="decimal"
                aria-label="Batch size in litres"
              />
            </label>
            <Button
              variant="ghost"
              className="px-4 py-2.5 text-sm"
              disabled={kitBusy || kitVersion === null || !kitSize.trim()}
              onClick={previewKit}
            >
              {kitBusy ? "Working…" : "Work it out"}
            </Button>
          </div>

          {kitOffer ? (
            <div className="mt-3">
              <div className="divide-y divide-line">
                {kitOffer.ingredients.map((ing) => (
                  <div key={ing.chemicalName} className="flex items-baseline gap-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-bold">
                      {ing.chemicalName}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted tnum">
                      needs {formatQty(ing.neededMilli, ing.unit)}
                    </span>
                    <span
                      className={`shrink-0 text-[12px] font-bold tnum ${
                        ing.missing ? "text-bad" : ing.oversized ? "text-warn" : "text-brand-dark"
                      }`}
                    >
                      {ing.missing
                        ? "no pack on sale"
                        : ing.oversized
                          ? `smallest is ${formatQty(ing.suppliedMilli, ing.unit)}`
                          : ing.picks
                              .map((p) => `${p.units} × ${splitName(p.name).size ?? p.name}`)
                              .join(" + ")}
                    </span>
                  </div>
                ))}
              </div>

              {/* Packs are lumpy. Say so here rather than at the till. */}
              {kitOffer.ingredients.some(
                (i) => !i.missing && !i.oversized && i.suppliedMilli > i.neededMilli,
              ) ? (
                <p className="mt-2 text-[11px] text-muted">
                  Packs do not divide evenly, so some ingredients round up. The customer gets at
                  least what the recipe needs — never less.
                </p>
              ) : null}
              {/* The kit must not quietly bill someone for 5 kg of a chemical
                  their recipe needs 25 g of. Those are left out and named. */}
              {kitLeftOut.length ? (
                <div className="mt-2">
                  <Alert tone="warn">
                    Not in this kit: {kitLeftOut.join(", ")}. Either the shop has no pack that
                    size, or the smallest one is far more than the recipe needs — weigh those out
                    separately, or add a smaller pack in Products &amp; prices.
                  </Alert>
                </div>
              ) : null}

              <Button
                className="mt-3 w-full text-sm"
                disabled={!kitAddable}
                onClick={addKitToCart}
              >
                {kitAddable
                  ? `Add ${kitAddable} of ${kitOffer.ingredients.length} ingredients — ${kitOffer.formulaName}, ${formatQty(kitOffer.targetMilli, "L")}`
                  : "Nothing here can be sold as packs"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {q ? (
        <>
          <SectionLabel>
            {matches.length} match{matches.length === 1 ? "" : "es"}
            {queryCount > 1 ? ` · tapping adds ${queryCount}` : ""}
          </SectionLabel>
          <Grid
            items={matches}
            tier={tier}
            onAdd={(item) => addUnits(item, queryCount)}
            cart={cart}
            searching
          />
        </>
      ) : (
        <>
          {top.length ? (
            <>
              <SectionLabel>Top sellers today</SectionLabel>
              {/* Shortcuts, not products: one line each, sized to the words, so
                  six of them cost a strip of screen instead of a whole band. */}
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
                {top.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => addItem(item)}
                    title={item.name}
                    className={`flex shrink-0 items-baseline gap-2 rounded-full border py-2 pl-3.5 pr-3 text-left transition-colors ${
                      wholesale
                        ? "border-warn/40 bg-warn-soft hover:border-warn"
                        : "border-brand/30 bg-brand-soft hover:border-brand/60"
                    }`}
                  >
                    <span className="max-w-[11rem] truncate text-[13px] font-bold leading-none">
                      {item.name}
                    </span>
                    <span
                      className={`text-[13px] font-extrabold leading-none tnum ${
                        wholesale ? "text-warn" : "text-brand"
                      }`}
                    >
                      {formatKes(listPrice(item, tier))}
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {/* Two boards, because two customers walk in.
              One wants a bottle of laundry soap; the other wants two kilos of
              caustic soda and does not care what Riziki mixes. Stacked, the
              second had to scroll past all thirteen of the first's products
              every single time. Side by side they are one tap apart, and the
              board you are on is the whole screen. */}
          {/* Said once, on touch screens, and only while nothing is being sold —
              a hint is worth a line of a phone screen before the first sale and
              never during one. */}
          {!cart.length ? (
            <p className="mt-1.5 text-center text-[11px] text-muted lg:hidden">
              ‹ swipe to change board ›
            </p>
          ) : null}

          <div
            role="tabpanel"
            onTouchStart={onBoardTouchStart}
            onTouchEnd={onBoardTouchEnd}
            className="mt-3"
          >
            {board === "products" ? (
              finished.length ? (
                <Grid items={finished} tier={tier} onAdd={addItem} cart={cart} />
              ) : (
                <p className="py-8 text-center text-sm text-muted">
                  Nothing mixed and bottled is on the price list yet.
                </p>
              )
            ) : chemicals.length ? (
              <Grid items={chemicals} tier={tier} onAdd={addItem} cart={cart} />
            ) : (
              <p className="py-8 text-center text-sm text-muted">No chemicals are priced yet.</p>
            )}
          </div>
        </>
      )}

      </div>

      {/* Desktop: the persistent till panel — cart, tenders and Complete,
          always visible. The phone's sheets stay untouched below lg. */}
      <aside
        aria-label="Current sale"
        className="hidden overflow-hidden rounded-3xl bg-white shadow-lift ring-1 ring-ink/5 lg:flex lg:h-full lg:flex-col"
      >
        {/* Header — fixed. Names the pane and, in payment, gets back out of it. */}
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
          {deskPane === "pay" ? (
            <button
              type="button"
              onClick={() => setDeskPane("cart")}
              className="-ml-1 rounded-lg px-1.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-brand hover:bg-wash"
            >
              ← Cart
            </button>
          ) : (
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
              Current sale
            </h2>
          )}
          {unitCount ? (
            <span className="ml-auto text-[11px] font-bold text-muted tnum">
              {unitCount} item{unitCount === 1 ? "" : "s"}
            </span>
          ) : null}
          {cart.length && deskPane === "cart" ? (
            <button
              type="button"
              onClick={() => setCart([])}
              className="rounded-lg px-1.5 py-1 text-[11px] font-bold text-muted hover:bg-wash hover:text-bad"
            >
              Clear
            </button>
          ) : null}
        </div>

        {/* Body — the only part that scrolls. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {receipt ? <div className="mb-3">{renderReceipt()}</div> : null}
          {!cart.length ? (
            <p className="rounded-2xl border border-dashed border-line bg-wash/60 py-10 text-center text-sm font-medium text-muted">
              Click a product to start a sale.
            </p>
          ) : deskPane === "cart" ? (
            renderCartBody()
          ) : (
            renderPayBody()
          )}
        </div>

        {/* Footer — never scrolls. The bill and the next action, always in view. */}
        {cart.length ? (
          <div className="shrink-0 border-t border-line bg-wash/60 px-4 py-3">
            {deskPane === "cart" ? (
              <>
                <div className="mb-2.5 flex items-baseline justify-between gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                    Total
                  </span>
                  <span className="text-[26px] font-extrabold leading-none tracking-tight text-brand-deep tnum">
                    {formatKes(totalCents)}
                  </span>
                </div>
                <Button
                  className={`w-full text-base ${wholesale ? "!bg-warn hover:!bg-warn" : ""}`}
                  onClick={() => setDeskPane("pay")}
                >
                  Pay {formatKes(totalCents)}
                </Button>
              </>
            ) : (
              renderPayButton()
            )}
          </div>
        ) : null}
      </aside>
      </div>

      {/* Pay bar — sits above the tab bar, always one tap from payment. */}
      {cart.length ? (
        <div className="no-print fixed inset-x-0 bottom-[calc(3.9rem+env(safe-area-inset-bottom))] z-30 mx-auto max-w-lg px-3 md:bottom-24 lg:hidden">
          <div className="flex items-stretch overflow-hidden rounded-full bg-white shadow-lift ring-1 ring-ink/5">
            <button
              type="button"
              onClick={() => setSheet("cart")}
              className="flex flex-col justify-center py-2 pl-5 pr-4 text-left"
            >
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                {unitCount} item{unitCount === 1 ? "" : "s"}
              </span>
              <span className="text-xs font-bold text-brand-dark">Edit cart</span>
            </button>
            <button
              type="button"
              onClick={() => setSheet("pay")}
              className={`min-h-14 flex-1 px-4 text-base font-extrabold text-white tnum ${
                wholesale ? "bg-warn" : "bg-brand"
              }`}
            >
              Pay {formatKes(totalCents)}
            </button>
          </div>
        </div>
      ) : null}

      <div className="lg:hidden">
        {sheet === "cart" ? (
          <Sheet title="Cart" onClose={() => setSheet("none")}>
            {renderCartBody()}
          <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
            <span className="text-sm font-bold uppercase tracking-[0.1em] text-muted">Total</span>
            <span className="text-2xl font-extrabold tnum">{formatKes(totalCents)}</span>
          </div>
          <Button className="mt-4 w-full" onClick={() => setSheet("pay")}>
            Pay {formatKes(totalCents)}
          </Button>
          </Sheet>
        ) : null}

        {sheet === "pay" ? (
          <Sheet title="Payment" onClose={() => setSheet("none")}>
            {renderPayBody()}
            <div className="mt-4">{renderPayButton()}</div>
          </Sheet>
        ) : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- parts

function Grid({
  items,
  tier,
  onAdd,
  cart,
  searching = false,
}: {
  items: SellItem[];
  tier: Tier;
  onAdd: (item: SellItem) => void;
  cart: CartLine[];
  searching?: boolean;
}) {
  // The counter's worst enemy is scrolling past dead tiles with a queue
  // watching. Browsing shows sellable stock first and folds the rest away;
  // an explicit search still finds everything, including unpriced items.
  const visible = searching ? items : items.filter((i) => listPrice(i, tier) > 0);
  const inStock = visible.filter((i) => i.qtyMilli > 0);
  const outOfStock = visible.filter((i) => i.qtyMilli <= 0);

  if (!visible.length) {
    return <p className="py-6 text-center text-sm text-muted">Nothing here.</p>;
  }

  const tile = (item: SellItem) => {
    const inCart = cart.find((l) => l.itemId === item.id);
    const out = item.qtyMilli <= 0;
    const unpriced = listPrice(item, tier) === 0;
    const { base, size } = splitName(item.name);
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => onAdd(item)}
        title={item.name}
        // A fixed height on every tile is what turns forty of these from a
        // ragged pile into something scannable: price sits at the same eye
        // level in every column, so the grid can be read down as well as across.
        className={`relative flex h-[6.5rem] flex-col rounded-2xl px-3 py-2.5 text-left shadow-card ring-1 transition-colors md:h-[5.75rem] ${
          inCart ? "bg-brand-soft ring-brand/40" : "bg-white ring-ink/5 hover:ring-brand/30"
        } ${out ? "opacity-70" : ""}`}
      >
        {inCart ? (
          <span className="absolute right-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-brand px-1.5 text-xs font-extrabold text-white tnum">
            {inCart.units}
          </span>
        ) : null}
        {/* One line, never clipped mid-word: the size below carries what an
            ellipsis used to eat. */}
        <div className={`truncate text-[13px] font-bold leading-tight ${inCart ? "pr-7" : ""}`}>
          {base}
        </div>
        <div className="mt-0.5 h-4 text-[11px] font-semibold text-muted">{size ?? ""}</div>
        {/* Price and shelf count share the last line: the tile is as wide as
            three columns make it, and a price alone left two thirds of it
            empty. Side by side they answer both counter questions at a glance. */}
        {/* Side by side from tablet up, where there is room for both. Two to a
            row on a phone there is not — "KES 500" beside "181 jerricans" wraps
            the price onto two lines — so there they stack. */}
        <div className="mt-auto flex flex-col gap-0.5 md:flex-row md:items-baseline md:justify-between md:gap-2">
          {/* Price never gives ground — it is the one figure a tile cannot be
              wrong about. The status beside it truncates instead, so a narrow
              column shortens "Out of stock" rather than spilling it over the
              next tile, which is what a hard, unclipped overflow used to do. */}
          <span
            className={`shrink-0 whitespace-nowrap font-extrabold leading-none tnum ${
              unpriced
                ? "text-[13px] font-bold text-muted"
                : `text-[17px] ${tier === "wholesale" ? "text-warn" : "text-brand-deep"}`
            }`}
          >
            {unpriced ? "No price set" : formatKes(listPrice(item, tier))}
          </span>
          <span
            className={`min-w-0 truncate text-[11px] leading-none tnum ${out ? "font-bold text-bad" : "text-muted"}`}
          >
            {out ? "Out of stock" : formatUnits(item.qtyMilli, item.sizeMilli, item.unitLabel)}
          </span>
        </div>
      </button>
    );
  };

  // Measured against the column, not the window (see the @container above), and
  // chosen so a tile is never narrower than about 180px — the width at which
  // product names start being eaten by the ellipsis again.
  const cols =
    "grid grid-cols-2 gap-2 @[28rem]:grid-cols-3 @[28rem]:gap-3 @[46.5rem]:grid-cols-4 @[64rem]:grid-cols-5";

  /*
   * Nothing in stock is not the same as nothing here — everything priced is
   * still real, still visible, just unsellable right now. Folded behind a
   * closed disclosure it reads as an empty screen, exactly like this file
   * being missing entirely, which is precisely the alarm "products have
   * disappeared" describes. So when there is nothing else to show, the
   * out-of-stock list IS the screen: open, with the reason and the two
   * places stock actually comes from, not a small triangle to hunt for.
   */
  if (!inStock.length) {
    return (
      <>
        <div className="rounded-2xl border border-dashed border-line bg-wash/60 px-4 py-5 text-center">
          <p className="text-sm font-semibold text-ink">
            Nothing here is in stock — {outOfStock.length} priced item
            {outOfStock.length === 1 ? "" : "s"} shown below, at zero.
          </p>
          <p className="mt-1 text-xs text-muted">
            Chemicals arrive by <Link href="/repack" className="font-semibold text-brand">Repack</Link> or{" "}
            <Link href="/purchases" className="font-semibold text-brand">a delivery</Link>. Products come from{" "}
            <Link href="/batch" className="font-semibold text-brand">Batch</Link>. Already have some on the
            shelf that is not showing? Fix it with a{" "}
            <Link href="/stocktake" className="font-semibold text-brand">Stock take</Link>.
          </p>
        </div>
        <div className={`mt-3 ${cols}`}>{outOfStock.map(tile)}</div>
      </>
    );
  }

  return (
    <>
      <div className={cols}>{inStock.map(tile)}</div>
      {outOfStock.length ? (
        searching ? (
          <div className={`mt-2 ${cols}`}>{outOfStock.map(tile)}</div>
        ) : (
          <details className="mt-2">
            <summary className="cursor-pointer py-1.5 text-center text-sm font-semibold text-muted">
              Out of stock ({outOfStock.length}) ▾
            </summary>
            <div className={`mt-2 ${cols}`}>{outOfStock.map(tile)}</div>
          </details>
        )
      ) : null}
    </>
  );
}

function CartRow({
  item,
  line,
  tier,
  onUnits,
  onPrice,
}: {
  item: SellItem;
  line: CartLine;
  tier: Tier;
  onUnits: (delta: number) => void;
  onPrice: (cents: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => centsToInput(line.priceCents));
  /** Held while the box is being typed in, so a half-typed "2" of "20" is not applied. */
  const [qtyDraft, setQtyDraft] = useState<string | null>(null);
  const list = listPrice(item, tier);
  const discounted = line.priceCents !== list;

  function commit() {
    const cents = parseCents(draft);
    if (cents !== null) onPrice(cents);
    else setDraft(centsToInput(line.priceCents));
    setEditing(false);
  }

  const { base, size } = splitName(item.name);

  /**
   * One row, three columns: how many, what, how much.
   *
   * It used to be a bordered card with the quantity stepper on its own line, the
   * unit price spelled out with "· tap to change" after it, and the pack word
   * repeated in the corner — about 118px of chrome for three facts, times every
   * line. Six items filled a laptop screen and pushed the bill and the Complete
   * button clean out of sight, which is the worst thing a till can do.
   *
   * So: the stepper leads (it is the only thing here anyone adjusts, and in a
   * column it forms one clean edge), the name and the unit price share the
   * middle, and the line total closes on the right where a total belongs. The
   * instruction is gone — the price is styled as the link it is.
   */
  return (
    <div className="flex items-center gap-2.5 py-2">
      <div className="flex shrink-0 items-center rounded-lg bg-white ring-1 ring-inset ring-line">
        <button
          type="button"
          onClick={() => onUnits(-1)}
          aria-label={`One less ${item.name}`}
          className="h-8 w-7 rounded-l-lg text-base font-extrabold text-brand-dark hover:bg-wash"
        >
          −
        </button>
        {/* Typing beats tapping: twenty of something was twenty taps. */}
        <input
          className="w-7 bg-transparent text-center text-[13px] font-extrabold tnum outline-none"
          value={qtyDraft ?? String(line.units)}
          onChange={(e) => setQtyDraft(e.target.value.replace(/[^\d]/g, ""))}
          onFocus={(e) => {
            setQtyDraft(String(line.units));
            e.currentTarget.select();
          }}
          onBlur={() => {
            const n = Number(qtyDraft);
            if (qtyDraft !== null && qtyDraft !== "" && Number.isFinite(n)) onUnits(n - line.units);
            setQtyDraft(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setQtyDraft(null);
              e.currentTarget.blur();
            }
          }}
          inputMode="numeric"
          aria-label={`How many ${item.name}`}
        />
        <button
          type="button"
          onClick={() => onUnits(1)}
          aria-label={`One more ${item.name}`}
          className="h-8 w-7 rounded-r-lg text-base font-extrabold text-brand-dark hover:bg-wash"
        >
          +
        </button>
      </div>

      {editing ? (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <input
            className={`${inputClass} !py-2 tnum`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(false);
            }}
            inputMode="decimal"
            autoFocus
            aria-label={`Price for ${item.name}`}
          />
          <Button variant="ghost" className="shrink-0 px-3 py-2" onClick={commit}>
            Set
          </Button>
        </div>
      ) : (
        <>
          {/* The name gets the line to itself — squeezed beside the size it was
              the first thing to be cut, and "Carwash Shampo…" beside "Carwash
              Shampoo 5 L" on the same bill is a mistake waiting to happen. The
              size drops to the second line, where it is still the thing next to
              the price it belongs to. */}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-bold leading-tight" title={item.name}>
              {base}
            </div>
            <button
              type="button"
              onClick={() => {
                setDraft(centsToInput(line.priceCents));
                setEditing(true);
              }}
              className="mt-0.5 block max-w-full truncate text-[11px] font-semibold text-brand"
              aria-label={`Change the price of ${item.name}`}
            >
              {size ? <span className="text-muted">{size} · </span> : null}
              <span className="underline decoration-brand/30 decoration-dotted underline-offset-2">
                {formatKes(line.priceCents)} each
              </span>
              {discounted ? (
                <span className="ml-1.5 text-muted line-through">{formatKes(list)}</span>
              ) : null}
            </button>
          </div>
          <div className="shrink-0 text-right text-sm font-extrabold tnum">
            {formatKes(line.priceCents * line.units)}
          </div>
        </>
      )}
    </div>
  );
}

function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="no-print fixed inset-0 z-40 flex flex-col bg-black/40" role="dialog" aria-modal="true">
      <button type="button" className="flex-1" aria-label="Close" onClick={onClose} />
      <div className="mx-auto max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <div className="mb-3 flex items-center">
          <h2 className="text-lg font-bold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-muted"
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <span className={`tnum ${strong ? "text-base font-extrabold" : "text-sm font-semibold"}`}>
        {value}
      </span>
    </div>
  );
}
