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
import { formatDateTime, formatKes, formatUnits } from "@/lib/units";
import { Alert, Button, Chip, SectionLabel, inputClass } from "@/components/ui";

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
  acknowledgeCredit?: boolean;
}

export type SellState =
  | { status: "idle" }
  /** A refusal the counter can fix — wrong amount, missing code, unknown item. */
  | { status: "error"; message: string }
  /** A price below the floor: the owner has to approve it in person. */
  | { status: "pin"; message: string }
  /** The customer would go past their credit limit. Warn, never silently allow. */
  | { status: "credit"; message: string }
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
 * The owner PIN and the credit acknowledgement are deliberately dropped: a PIN
 * must never sit at rest on the shared counter phone, and the credit-limit
 * warning is an interactive check that cannot be answered by a queue. Both are
 * asked again at send time if they are still needed.
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
}: {
  items: SellItem[];
  topSellerIds: number[];
  customers: SellCustomer[];
  /** When the server read these stock counts. Shown whenever they may be stale. */
  stockAsOf: string;
  action: (prev: SellState, payload: SalePayload) => Promise<SellState>;
}) {
  const [tier, setTier] = useState<Tier>("retail");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [query, setQuery] = useState("");
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

  const customer = customers.find((c) => c.id === customerId) ?? null;

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

  function complete(acknowledgeCredit = false) {
    const payload: SalePayload = {
      clientUuid: uuid.current,
      tier,
      lines: cart.map((l) => ({ itemId: l.itemId, units: l.units, unitPriceCents: l.priceCents })),
      tenders: buildTenders(),
      customerId,
      ownerPin: ownerPin.trim() || undefined,
      acknowledgeCredit,
    };
    startTransition(() => submit(payload));
  }

  // --- item lists ---------------------------------------------------------

  const q = query.trim().toLowerCase();
  const matches = q ? items.filter((i) => i.search.includes(q)).sort(shelfOrder) : [];
  const finished = items.filter((i) => i.kind === "finished").sort(shelfOrder);
  const packs = items.filter((i) => i.kind === "pack").sort(shelfOrder);
  const other = items.filter((i) => i.kind === "other").sort(shelfOrder);
  const top = topSellerIds.map((id) => byId.get(id)).filter((i): i is SellItem => Boolean(i));

  const wholesale = tier === "wholesale";


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
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => {
              setPayNow(null);
              setSecond(null);
            }}
            className={`flex-1 rounded-full px-3 py-2.5 text-sm font-bold ring-1 ring-inset transition-colors ${
              onAccountCents === 0 && !overpaidCents
                ? "bg-brand text-white ring-brand"
                : "bg-white text-brand-dark ring-line"
            }`}
          >
            Paid in full
          </button>
          <button
            type="button"
            onClick={() => {
              setPayNow("0");
              setSecond(null);
            }}
            className={`flex-1 rounded-full px-3 py-2.5 text-sm font-bold ring-1 ring-inset transition-colors ${
              paidCents === 0
                ? "bg-warn text-white ring-warn"
                : "bg-white text-brand-dark ring-line"
            }`}
          >
            Paying later
          </button>
        </div>

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
            <select
              className={inputClass}
              value={customerId ?? ""}
              onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Walk-in — no name</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — owes {formatKes(c.outstandingCents)}
                  {c.limitCents > 0 ? ` of ${formatKes(c.limitCents)}` : ""}
                </option>
              ))}
            </select>

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

        {state.status === "credit" ? (
          <div className="mt-3">
            <Alert tone="warn">{state.message}</Alert>
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
        onClick={() => complete(state.status === "credit")}
      >
        {/* The label states the outcome, so nobody has to reconstruct it from
            a running total: "Take 3,000 · 5,400 later". */}
        {pending
          ? online
            ? "Recording…"
            : "Saving on this phone…"
          : state.status === "credit"
            ? "Let them take it anyway"
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

      <div className="mb-3 flex items-center gap-2">
        <h1 className="text-xl font-bold tracking-tight">Sell</h1>
        <Link href="/sales" className="text-xs font-bold text-brand">
          History
        </Link>
        <div className="ml-auto grid grid-cols-2 overflow-hidden rounded-xl border border-line">
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
      <div className="min-w-0 lg:h-full lg:overflow-y-auto lg:pr-1">
      {/* Pinned to the top of the scrolling column: on a keyboard till, search
          is how the counter works, and it must never be somewhere up the page. */}
      <div className="lg:sticky lg:top-0 lg:z-10 lg:-mt-1 lg:bg-wash lg:pb-2.5 lg:pt-1">
        <input
          ref={searchRef}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !matches.length) return;
            e.preventDefault();
            addItem(matches.find((i) => i.qtyMilli > 0) ?? matches[0]);
            setQuery("");
          }}
          className={inputClass}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search — name, or chemical (sles, labsa…)"
          aria-label="Search items"
        />
      </div>

      {q ? (
        <>
          <SectionLabel>{matches.length} match{matches.length === 1 ? "" : "es"}</SectionLabel>
          <Grid items={matches} tier={tier} onAdd={addItem} cart={cart} searching />
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

          {finished.length ? (
            <>
              <SectionLabel>Finished products</SectionLabel>
              <Grid items={finished} tier={tier} onAdd={addItem} cart={cart} />
            </>
          ) : null}

          {packs.length ? (
            <>
              <SectionLabel>Repacked chemicals</SectionLabel>
              <Grid items={packs} tier={tier} onAdd={addItem} cart={cart} />
            </>
          ) : null}

          {other.length ? (
            <>
              <SectionLabel>Other</SectionLabel>
              <Grid items={other} tier={tier} onAdd={addItem} cart={cart} />
            </>
          ) : null}
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
          <span
            className={`whitespace-nowrap font-extrabold leading-none tnum ${
              unpriced
                ? "text-[13px] font-bold text-muted"
                : `text-[17px] ${tier === "wholesale" ? "text-warn" : "text-brand-deep"}`
            }`}
          >
            {unpriced ? "No price set" : formatKes(listPrice(item, tier))}
          </span>
          <span
            className={`shrink-0 text-[11px] leading-none tnum ${out ? "font-bold text-bad" : "text-muted"}`}
          >
            {out ? "Out of stock" : formatUnits(item.qtyMilli, item.sizeMilli, item.unitLabel)}
          </span>
        </div>
      </button>
    );
  };

  // Three columns on a laptop, not five. Five left each tile ~115px wide inside
  // the column the till panel leaves behind, which is how every second product
  // name ended up as an ellipsis.
  const cols = "grid grid-cols-2 gap-2 md:grid-cols-3 md:gap-3 lg:grid-cols-3 2xl:grid-cols-4";

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
        <span className="w-5 text-center text-[13px] font-extrabold tnum">{line.units}</span>
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
