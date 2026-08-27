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
import { swatchFor, nameSize, priceSize } from "@/lib/swatch";
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
import type { PaperWidth, Receipt, ReceiptLine } from "@/lib/escpos";
import { ThermalPrint } from "@/components/thermal-print";
import { PdfShareButton } from "@/components/pdf-share-button";
import { receiptToPdf } from "@/lib/pdf";

/** Sentinel value for the "＋ New customer" row in the customer dropdown. */
const NEW_CUSTOMER = "__new";

/**
 * The two things this shop sells, and the order they are offered in.
 *
 * Products first because it is the shorter list and the commoner walk-in; the
 * chemical buyer knows what they came for and is one tap (or one swipe) away.
 * Search cuts across both, so nobody has to guess which board a thing is on.
 *
 * "Products" no longer means bottles on a shelf — the shop stopped mixing its
 * own. It means the things a customer comes in to make: tap Carwash Shampoo,
 * say how much, and the counter bills the chemicals that go into it. The board
 * kept its name because that is what the customer asks for at the door.
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
  /**
   * 'unit' — priced per kilogram or litre, and the customer names the quantity.
   * 'pack' — priced whole: a jerrican, a bottle. You buy one or you buy none.
   */
  basis: "pack" | "unit";
  /** What a weighed quantity of this is counted in. */
  unit: "kg" | "L" | "pcs";
  /** drum, bag, jerrican — what one container is called. */
  unitLabel: string;
  /** How much one container holds. Only a display fact for a weighed item. */
  sizeMilli: number;
  /** Per container, or per kg / L when `basis` is 'unit'. */
  /** What the shop asks for one unit. The only price an item has. */
  priceCents: number;
  qtyMilli: number;
  /** name + chemical name + aliases, lower-cased, so "sles" finds Ungerol */
  search: string;
  /**
   * The sizes this is also sold in, each at its own price.
   *
   * Empty for most of the catalogue, and that emptiness is load-bearing: a tile
   * with no bundles behaves exactly as it did before this existed — one tap,
   * one unit on the bill, no sheet in the way.
   */
  bundles: BundleChoice[];
}

/** One size on the size sheet: what it holds, what it costs, what that is per unit. */
export interface BundleChoice {
  id: number;
  sizeMilli: number;
  priceCents: number;
  /** Never below this without the owner's PIN. Zero means no floor set. */
  floorCents: number;
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
  lines: Array<{
    itemId: number;
    name: string;
    units: number;
    qtyMilli: number;
    weighed: boolean;
    available: boolean;
  }>;
}

/** One recipe the counter can bill out as its ingredients. */
export interface RecipeChoice {
  versionId: number;
  formulaId: number;
  name: string;
  /** The batch the quantities are written for — the sensible opening guess. */
  refSizeMilli: number;
  ingredientCount: number;
  /**
   * The sizes this mix is sold in, each at a price of its own.
   *
   * When there are any, tapping the tile offers them; the customer buys "a 5 L
   * of Carwash Shampoo" for a round number and the chemicals come off the shelf
   * behind it. With none, the tile prices a batch up from its ingredients as it
   * always has.
   */
  bundles: BundleChoice[];
}

/** A recipe priced up at a given batch size, ready to drop into the cart. */
export interface MixOffer {
  versionId: number;
  formulaName: string;
  targetMilli: number;
  totalCents: number;
  /** True when every ingredient can be billed and handed over as it stands. */
  sellable: boolean;
  /** The biggest batch the store could supply today. Zero when nothing fixes it. */
  possibleMilli: number;
  ingredients: Array<{
    itemId: number | null;
    chemicalName: string;
    unit: string;
    qtyMilli: number;
    rateCents: number;
    amountCents: number;
    availableMilli: number;
    /** Not on the price list at all. */
    unlisted: boolean;
    /** Stocked and sold, but still by the pack — so there is no rate to bill. */
    legacyPackPriced: boolean;
    /** On the list, but at no price — billing it would give it away. */
    unpriced: boolean;
    /** Priced, but there is not enough of it in the store. */
    short: boolean;
  }>;
}

export interface PayloadLine {
  /** Absent for a mixed product sold by the size — it is on no shelf. */
  itemId?: number;
  units: number;
  /** Per container, or per kg / L when `basis` is 'unit'. */
  unitPriceCents: number;
  basis: "pack" | "unit";
  /** How much substance, for a weighed line. */
  qtyMilli: number;
  /** Set when this line came out of a recipe, for the record. */
  formulaVersionId?: number | null;
  /** Set when the customer bought a size rather than a weight. */
  bundleId?: number | null;
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
      /**
       * Enough of the sale to hand the customer something on the way out —
       * a paper copy or a PDF — before the till has ever seen it. Nothing
       * here is fetched from the server; a queued sale by definition cannot
       * reach it, so this is exactly what the counter already had in memory.
       */
      lines: PayloadLine[];
      tenders: PayloadTender[];
      customerName: string | null;
      tier: Tier;
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
  customerName: string | null,
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
    return {
      status: "queued",
      clientUuid: payload.clientUuid,
      totalCents,
      queuedAt,
      reason,
      lines: payload.lines.map((l) => ({ ...l })),
      tenders: payload.tenders.map((t) => ({ ...t })),
      customerName,
      tier: payload.tier,
    };
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

const QUEUED_METHOD_LABEL: Record<string, string> = { cash: "Cash", mpesa: "M-Pesa", credit: "On credit" };

/**
 * A receipt for a sale the till has not seen yet.
 *
 * Everything here comes from what the counter already had in memory — the
 * cart, the tenders, the customer's name — because a queued sale by
 * definition cannot reach the server for anything more. It is deliberately
 * not called an invoice: there is no invoice number yet (that is issued once,
 * sequentially, when the sale actually reaches the till), so this is marked
 * PENDING and says so on the page, rather than showing a number that might
 * not match what prints again once the sale has synced.
 */
function receiptFromQueued(
  q: Extract<SellState, { status: "queued" }>,
  byId: Map<number, SellItem>,
  printer: { header: string[]; footer: string },
): Receipt {
  const lines: ReceiptLine[] = q.lines
    .map<ReceiptLine | null>((l) => {
      // A queued mixed product has no item to look up. It cannot be shown on
      // an offline receipt line by line, and is skipped rather than guessed at;
      // the sale itself replays in full when the phone gets a signal.
      if (l.itemId === undefined) return null;
      const item = byId.get(l.itemId);
      if (!item) return null;
      const weighed = item.basis === "unit";
      const at = (price: number) =>
        weighed ? Math.round((price * l.qtyMilli) / 1000) : price * l.units;
      const amount = at(l.unitPriceCents);
      // The asking price as the phone last saw it — this receipt is printed
      // before the till has ever seen the sale, so there is nothing else to
      // compare against. The till snapshots its own copy when the queue drains,
      // and that one is the record; this is the customer's slip in the meantime.
      const listCents = listPrice(item);
      const discountCents = Math.max(0, at(listCents) - amount);
      return {
        name: item.name,
        units: l.units,
        unitPriceCents: weighed ? amount : l.unitPriceCents,
        lineTotalCents: amount,
        qty: formatQty(l.qtyMilli, item.unit),
        rateCents: weighed ? l.unitPriceCents : 0,
        rateUnit: item.unit,
        listPriceCents: listCents,
        discountCents,
      };
    })
    .filter((l): l is ReceiptLine => l !== null);

  const paidCents = q.tenders.filter((t) => t.method !== "credit").reduce((s, t) => s + t.amountCents, 0);

  return {
    header: printer.header,
    title: "PENDING",
    invoiceNo: `Not yet sent · ${q.clientUuid.slice(0, 8)}`,
    dateTime: formatDateTime(q.queuedAt),
    customer: q.customerName,
    lines,
    subtotalCents: q.totalCents + lines.reduce((sum, l) => sum + (l.discountCents ?? 0), 0),
    discountCents: lines.reduce((sum, l) => sum + (l.discountCents ?? 0), 0),
    totalCents: q.totalCents,
    paidCents,
    balanceCents: q.totalCents - paidCents,
    tenders: q.tenders.map((t) => ({
      label: QUEUED_METHOD_LABEL[t.method] ?? t.method,
      amountCents: t.amountCents,
      codes: t.mpesaCode ?? null,
    })),
    note: "Saved on this phone — not yet on the till. The real invoice number is issued once this reaches the till; reprint from Sales history then.",
    footer: printer.footer,
  };
}

/**
 * What the shop asks for one unit of this.
 *
 * One price. The retail/wholesale switch this replaces could not express the
 * commonest question at the counter — a walk-in buying forty kilos is neither
 * tier — so the shop asks one price and the attendant argues inside the band
 * the owner set. The band itself never reaches this screen: a price outside it
 * is offered, refused by the till, and only then is a PIN asked for.
 */
function listPrice(item: SellItem): number {
  return item.priceCents;
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

/** 1500 -> "1.5". Trailing zeros trimmed, so a box shows "2" and not "2.000". */
function milliToInput(milli: number): string {
  return String(Number((milli / 1000).toFixed(3)));
}

/** "1.5" -> 1500. Blank or nonsense -> null, so a slip never becomes a zero. */
function parseMilli(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 1000);
}

/**
 * The price as the tile says it out loud: "KES 250" for a jerrican, "KES 50/kg"
 * for anything weighed.
 *
 * The suffix is not decoration. The same tile used to read "KES 50" whether
 * that bought a kilogram or a whole drum, and the whole point of pricing by
 * weight is that the number on the tile is not what the customer pays — it is
 * what one kilogram of it costs.
 */
function priceLabel(item: SellItem, cents: number): string {
  return item.basis === "unit" ? `${formatKes(cents)}/${item.unit}` : formatKes(cents);
}

/**
 * What is left, the way the shop counts it — and the way it sells it.
 *
 * Both numbers on every card that has two: "25 drums · 1,000 kg". The owner
 * counts containers on the floor, the counter sells out of them by the
 * kilogram, and neither number on its own answers "can I sell this order".
 * "18 packs" alone was the count of a thing nobody buys whole any more.
 *
 * The second is dropped where it would only repeat the first: a jerrican is
 * measured in pieces, so "20 pieces · 20 pcs" says one fact twice.
 */
function stockLabel(item: SellItem): string {
  if (item.qtyMilli <= 0) return "none left";

  const containers = formatUnits(item.qtyMilli, item.sizeMilli, item.unitLabel);
  if (item.unit === "pcs" || item.sizeMilli <= 0) return containers;

  /*
    Quantity first, containers second.

    Six tiles to a row leaves about ninety pixels for this, and whichever half
    is second gets an ellipsis. The shop sells by the kilogram, so the kilogram
    is the half that has to survive: "1,755 kg · 35.1 b…" still answers "can I
    sell this order", where "35.1 bags · 1,7…" does not.
  */
  return `${formatQty(item.qtyMilli, item.unit)} · ${containers}`;
}

/** How much one tap adds: one kilogram, one litre, one piece, or one container. */
function stepMilli(item: SellItem): number {
  return item.basis === "unit" ? 1000 : item.sizeMilli;
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
  /**
   * The bundle this line is, or null when it is loose weight / a plain unit.
   *
   * A cart can hold three lines for one chemical — some loose, a 5 kg and a
   * 20 kg — because they are three different prices. So a line is identified by
   * item AND bundle, never by item alone. `lineKey` is that identity; every
   * lookup in this file goes through it.
   */
  bundleId: number | null;
  /** What one of those bundles holds. Zero on a loose line. */
  bundleSizeMilli: number;
  /**
   * Set only on a mixed product sold by the size.
   *
   * Such a line has no item — "Carwash Shampoo — 5 L" is on no shelf — so
   * `itemId` is 0 and this is what identifies it in the cart instead. The name
   * is carried too, because there is no item to look one up from.
   */
  mixKey?: string;
  mixName?: string;
  /** Whole containers. Always 1 on a weighed line — `qtyMilli` is the order. */
  units: number;
  /** How much substance, in milli. Only read when the item is priced per unit. */
  qtyMilli: number;
  /** Per container, or per kg / L. Editable: haggling is normal here. */
  priceCents: number;
  /**
   * The recipe this line was billed out of, if any. Carried through to the sale
   * so the shop can see what its mixes are worth. It never changes the money —
   * adding more of the same chemical by hand merges into this line and leaves
   * the tag alone, because the tag says where the line started, not what it is.
   */
  formulaVersionId: number | null;
}

/**
 * How a cart line is identified.
 *
 * Item alone is not enough once bundles exist: 2 kg loose and one 20 kg bundle
 * of the same chemical are two lines at two prices, and keying by item would
 * silently merge them into whichever was added first.
 */
function lineKey(line: Pick<CartLine, "itemId" | "bundleId" | "mixKey">): string {
  if (line.mixKey) return line.mixKey;
  return line.bundleId === null ? `${line.itemId}:loose` : `${line.itemId}:b${line.bundleId}`;
}

/** What one cart line comes to, whichever of the three ways it is priced. */
function lineCents(item: SellItem | null, line: CartLine): number {
  // A bundle is a price for the whole size — not a rate, however it is weighed.
  // A mixed product sold by the size is the same shape and has no item at all.
  if (line.bundleId !== null) return line.priceCents * line.units;
  if (!item) return line.priceCents * line.units;
  if (item.basis === "unit") return Math.round((line.priceCents * line.qtyMilli) / 1000);
  return line.priceCents * line.units;
}

// ------------------------------------------------------------------- screen

export default function SellClient({
  items,
  topSellerIds,
  customers,
  stockAsOf,
  action,
  isOwner,
  recipes,
  onLastOrder,
  onMix,
  onKeepPrice,
  printer,
}: {
  items: SellItem[];
  topSellerIds: number[];
  customers: SellCustomer[];
  /** When the server read these stock counts. Shown whenever they may be stale. */
  stockAsOf: string;
  action: (prev: SellState, payload: SalePayload) => Promise<SellState>;
  isOwner: boolean;
  /** The Products board: what a customer comes in to make. */
  recipes: RecipeChoice[];
  onLastOrder: (customerId: number) => Promise<RepeatOrder | null>;
  onMix: (versionId: number, targetMilli: number) => Promise<MixOffer | null>;
  /**
   * Keep a price agreed here as the shop's price from now on.
   *
   * The counter has always let a price be argued down for the sale in front of
   * you, and that is all it did — which is right for haggling and wrong for the
   * other half of what happens at a counter: the supplier moved, this is the
   * real number, and it should be the shelf price from the next customer on.
   */
  onKeepPrice: (
    itemId: number,
    priceCents: number,
    ownerPin?: string,
  ) => Promise<{ ok: true; message: string } | { ok: false; error: string; needsPin: boolean }>;
  /** The shop's letterhead — nothing owner-sensitive — so a queued sale can
   *  build its own receipt on the phone with no server round trip. */
  printer: { paper: PaperWidth; header: string[]; footer: string; autoPrint: boolean };
}) {
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
  /** The open recipe, if one is being priced up. */
  const [mixOpen, setMixOpen] = useState(false);
  const [mixVersion, setMixVersion] = useState<number | null>(null);
  const [mixSize, setMixSize] = useState("");
  const [mixOffer, setMixOffer] = useState<MixOffer | null>(null);
  const [mixBusy, setMixBusy] = useState(false);
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

  const allCustomers = useMemo(() => [...customers, ...added], [customers, added]);

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
      // Resolved here, not inside queueSale: this is the one place with a
      // fresh customer list on every call, including one just quick-added
      // this session, which a memoised closure could otherwise miss.
      const name = allCustomers.find((c) => c.id === payload.customerId)?.name ?? null;
      if (!seemsOnline()) return queueSale(payload, "offline", name);
      try {
        return await withDeadline(action(prev, payload), TILL_TIMEOUT_MS);
      } catch {
        return queueSale(payload, "unreachable", name);
      }
    },
    [action, allCustomers],
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

  /*
    The cart, with each line's item beside it.

    A mixed product sold by the size has no item — it is on no shelf — so `item`
    is null there and everything downstream reads the line itself. Dropping such
    lines for want of an item, which is what the old filter did, would have kept
    them on screen and left them out of the total.
  */
  const lines = cart
    .map((l) => ({ line: l, item: l.mixKey ? null : (byId.get(l.itemId) ?? null) }))
    .filter((x) => x.item !== null || Boolean(x.line.mixKey));
  const totalCents = lines.reduce((s, x) => s + lineCents(x.item, x.line), 0);
  /*
    What the bill would have been at today's asking price, and what has been
    knocked off it.

    Haggling is normal here, so this is not a warning — it is the number the
    attendant is agreeing to out loud, shown before they take the money rather
    than discovered by the owner at the end of the month. The same subtraction
    is snapshotted onto the sale and totalled on the receipt, so what the
    counter sees here is what the customer is handed.
  */
  const atListCents = lines.reduce(
    (s, x) =>
      s +
      lineCents(x.item, {
        ...x.line,
        // A mixed product's asking price is the bundle's own; there is no shelf
        // rate behind it to have been discounted from.
        priceCents: x.item ? listPrice(x.item) : x.line.priceCents,
      }),
    0,
  );
  const discountCents = Math.max(0, atListCents - totalCents);
  // Lines, not units: a weighed line is one scoop however heavy it is, and
  // "3 items" beside a cart of three lines is the count anyone would check.
  const unitCount = cart.length;

  // What is being handed over now, and therefore what goes on the account.
  const firstCents = payNow === null ? totalCents : (parseCents(payNow) ?? 0);
  const secondCents = second ? (parseCents(second.amount) ?? 0) : 0;
  const paidCents = Math.max(0, firstCents) + Math.max(0, secondCents);
  const onAccountCents = Math.max(0, totalCents - paidCents);
  const overpaidCents = Math.max(0, paidCents - totalCents);
  const outstandingCents = onAccountCents;

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
        .map<CartLine | null>((l) => {
          const item = byId.get(l.itemId);
          if (!item) return null;
          return {
            itemId: item.id,
            // "Same as last time" repeats quantities, not bundles: the sizes on
            // offer may have changed since, and a stale bundle id would put a
            // price on the bill that nothing on the shelf still carries.
            bundleId: null,
            bundleSizeMilli: 0,
            units: item.basis === "unit" ? 1 : l.units,
            qtyMilli: item.basis === "unit" ? l.qtyMilli : item.sizeMilli * l.units,
            priceCents: listPrice(item),
            formulaVersionId: null,
          };
        })
        .filter((l): l is CartLine => l !== null),
    );
  }

  /** Price the recipe up at this batch size, and show it before anything is added. */
  async function previewMix(versionId: number | null = mixVersion, size: string = mixSize) {
    if (versionId === null) return;
    const litres = Number(size);
    if (!Number.isFinite(litres) || litres <= 0) return;
    setMixBusy(true);
    try {
      setMixOffer(await onMix(versionId, Math.round(litres * 1000)));
    } catch {
      setMixOffer(null);
    } finally {
      setMixBusy(false);
    }
  }

  /**
   * Open a recipe and ask how much of it the customer is making.
   *
   * The opening guess is the size the recipe is written for — twenty litres of
   * carwash shampoo — because that is the batch the sheet on the wall describes
   * and the one most people ask for. Any other number is one field away, and
   * unlike the pack-filling this replaced, there is no smallest one: half a
   * litre scales as cleanly as five hundred.
   */
  function openMix(recipe: RecipeChoice) {
    // A recipe sold in sizes asks which size, exactly as a chemical does. Only
    // one without any goes straight to pricing a batch up from its chemicals.
    if (recipe.bundles.length) {
      setRecipeSizeFor(recipe);
      return;
    }
    const litres = String(recipe.refSizeMilli / 1000);
    setMixOffer(null);
    setMixVersion(recipe.versionId);
    setMixSize(litres);
    setMixOpen(true);
    void previewMix(recipe.versionId, litres);
  }

  /**
   * Drop the priced-up recipe into the cart as ordinary weighed lines.
   *
   * Ordinary is the point. Once they are in the cart they are chemicals like
   * any others — haggle one, take one out, add a kilo of something else — and
   * the sale that follows knows nothing about recipes beyond the tag each line
   * carries. Adding the same recipe twice adds the quantities together, which
   * is what two batches of it actually needs.
   */
  function addMixToCart() {
    if (!mixOffer) return;
    for (const ing of mixOffer.ingredients) {
      if (ing.itemId === null || ing.unpriced) continue;
      const item = byId.get(ing.itemId);
      if (!item) continue;
      addQuantity(item, ing.qtyMilli, mixOffer.versionId);
    }
    setMixOpen(false);
    setMixOffer(null);
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

  /*
    More than is in the store.

    For anything sold whole this is a warning and nothing more: the customer is
    holding the bottle, and refusing the sale would be the till arguing with the
    shelf. For a weighed chemical it is a refusal, because nobody can pour 300 kg
    out of a drum holding 90 — the till says so here so the counter finds out
    while the number is still being typed, and `recordSale` refuses it again on
    the server, which is the check that actually counts.
  */
  const stocked = lines.filter(
    (x): x is { line: CartLine; item: SellItem } => x.item !== null,
  );
  const oversold = stocked.filter((x) => x.item.qtyMilli >= 0 && x.line.qtyMilli > x.item.qtyMilli);
  const overdrawn = oversold.filter((x) => x.item.basis === "unit");
  /*
    The M-Pesa code is optional.

    It used to block the Complete button, and that turned a slow SMS into a
    sale the shop could not enter — the money is already in the till account,
    the goods are already going out of the door, and the only thing being
    protected was a reference number. The code is still asked for, still
    upper-cased, and still unique when given; it simply no longer stands
    between the counter and a recorded sale.
  */
  const mpesaMissingCode =
    (payMethod === "mpesa" && firstCents > 0 && !payCode.trim()) ||
    (second !== null && second.method === "mpesa" && secondCents > 0 && !second.code.trim());
  const needsCustomer = onAccountCents > 0;

  // --- after a completed sale, start clean --------------------------------
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
    setQuery("");
    setSheet("none");
    setDeskPane("cart");
    setRepeat(null);
    setMixOpen(false);
    setMixOffer(null);
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
      const saved = JSON.parse(raw) as { cart: CartLine[] };
      if (saved.cart?.length) setCart(saved.cart);
    } catch {
      /* a corrupt cart is not worth crashing the till over */
    }
  }, []);

  useEffect(() => {
    try {
      if (cart.length) sessionStorage.setItem("riziki_cart", JSON.stringify({ cart }));
      else sessionStorage.removeItem("riziki_cart");
    } catch {
      /* private mode / storage full — the cart just won't survive navigation */
    }
  }, [cart]);

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

  /** The item whose size sheet is open, if any. */
  const [sizeFor, setSizeFor] = useState<SellItem | null>(null);
  /** The same, for a mixed product. */
  const [recipeSizeFor, setRecipeSizeFor] = useState<RecipeChoice | null>(null);

  /**
   * Put one bundle of a mixed product on the bill.
   *
   * It carries no item: "Carwash Shampoo — 5 L" is not on any shelf. The server
   * turns this one line into the priced product plus the chemicals it is mixed
   * from, so nothing here needs to know the recipe.
   */
  function addRecipeBundle(recipe: RecipeChoice, bundle: BundleChoice) {
    setReceipt(null);
    const key = `f${recipe.formulaId}:b${bundle.id}`;
    setCart((prev) => {
      const at = prev.findIndex((l) => l.mixKey === key);
      if (at >= 0) {
        const next = [...prev];
        const units = next[at].units + 1;
        next[at] = { ...next[at], units, qtyMilli: units * bundle.sizeMilli };
        return next;
      }
      return [
        ...prev,
        {
          itemId: 0,
          mixKey: key,
          mixName: `${recipe.name} — ${milliToInput(bundle.sizeMilli)} L`,
          bundleId: bundle.id,
          bundleSizeMilli: bundle.sizeMilli,
          units: 1,
          qtyMilli: bundle.sizeMilli,
          priceCents: bundle.priceCents,
          formulaVersionId: recipe.versionId,
        },
      ];
    });
  }

  // --- cart ---------------------------------------------------------------

  /**
   * One tap adds one of the thing: one jerrican, or one kilogram.
   *
   * A weighed chemical has to start somewhere, and one kilogram is the number
   * everybody in the shop already thinks in — the price on the tile is per
   * kilogram, so tapping it once puts exactly that much money on the bill.
   * Anything else is typed into the cart line, where the quantity is a box.
   */
  function addItem(item: SellItem) {
    // With sizes on offer, the tap asks how much rather than assuming one.
    // Without them nothing changes: one tap, one unit, as it has always been.
    if (item.bundles.length) {
      setSizeFor(item);
      return;
    }
    addQuantity(item, stepMilli(item), null);
  }

  /** Nudge a line by one container, or by one kilogram. */
  function changeUnits(key: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => {
          if (lineKey(l) !== key) return l;
          const item = byId.get(l.itemId);
          if (!item) return l;
          // One more bundle, or one more container, or one more kilogram.
          const step = l.bundleId !== null ? l.bundleSizeMilli : stepMilli(item);
          const qtyMilli = l.qtyMilli + delta * step;
          return { ...l, qtyMilli, units: unitsFor(item, qtyMilli, l) };
        })
        .filter((l) => l.qtyMilli > 0),
    );
  }

  /**
   * Set a quantity outright.
   *
   * Twenty of something used to be twenty taps. A container count is still
   * whole — half a jerrican is not a thing anyone can hand over — but a weighed
   * chemical takes any quantity down to the gram, which is the entire reason
   * the shop stopped pre-packing: 250 g of caustic is now a number typed into a
   * box, not a pack somebody has to have made up in advance.
   */
  function setQuantity(key: string, value: number) {
    const line = cart.find((l) => lineKey(l) === key);
    const item = line ? byId.get(line.itemId) : undefined;
    if (!line || !item || !Number.isFinite(value) || value <= 0) return;

    // On a bundle line the box counts BUNDLES — "2" is two 20 kg bundles, not
    // two kilograms. The weight follows from the size, and is never typed.
    if (line.bundleId !== null) {
      const count = Math.max(1, Math.min(9999, Math.floor(value)));
      setCart((prev) =>
        prev.map((l) =>
          lineKey(l) === key
            ? { ...l, units: count, qtyMilli: count * l.bundleSizeMilli }
            : l,
        ),
      );
      return;
    }
    const qtyMilli =
      item.basis === "unit"
        ? Math.min(9_999_000, Math.round(value * 1000))
        : Math.max(1, Math.min(9999, Math.floor(value))) * item.sizeMilli;
    setCart((prev) =>
      prev.map((l) =>
        lineKey(l) === key
          ? { ...l, qtyMilli, units: unitsFor(item, qtyMilli, l) }
          : l,
      ),
    );
  }

  /**
   * Put a quantity of something in the cart, on top of whatever is there.
   *
   * Used by every route into the cart — a tap, the search box ("20 caustic ⏎"),
   * "same as last time", and a recipe billed out as its chemicals. Adding to
   * what is already there is deliberate: two batches of the same recipe should
   * come to two batches' worth of chemicals, not one.
   */
  function addQuantity(item: SellItem, qtyMilli: number, formulaVersionId: number | null) {
    const add = Math.max(1, Math.round(qtyMilli));
    setReceipt(null);
    // Loose weight merges only with loose weight. A 20 kg bundle already on the
    // bill is a different price and stays its own line.
    const key = lineKey({ itemId: item.id, bundleId: null });
    setCart((prev) => {
      const at = prev.findIndex((l) => lineKey(l) === key);
      if (at >= 0) {
        const next = [...prev];
        const qty = next[at].qtyMilli + add;
        next[at] = {
          ...next[at],
          qtyMilli: qty,
          units: unitsFor(item, qty, next[at]),
          formulaVersionId: next[at].formulaVersionId ?? formulaVersionId,
        };
        return next;
      }
      return [
        ...prev,
        {
          itemId: item.id,
          bundleId: null,
          bundleSizeMilli: 0,
          units: unitsFor(item, add),
          qtyMilli: add,
          priceCents: listPrice(item),
          formulaVersionId,
        },
      ];
    });
  }

  /**
   * Put one bundle on the bill.
   *
   * Tapping the same size again is one more of it, which is what a counter
   * reaching for a second jerrican expects. The price is the bundle's own —
   * never the per-kilogram price times the size, because the whole reason the
   * bundle exists is that it is cheaper than that.
   */
  function addBundle(item: SellItem, bundle: BundleChoice) {
    setReceipt(null);
    const key = lineKey({ itemId: item.id, bundleId: bundle.id });
    setCart((prev) => {
      const at = prev.findIndex((l) => lineKey(l) === key);
      if (at >= 0) {
        const next = [...prev];
        const units = next[at].units + 1;
        next[at] = { ...next[at], units, qtyMilli: units * bundle.sizeMilli };
        return next;
      }
      return [
        ...prev,
        {
          itemId: item.id,
          bundleId: bundle.id,
          bundleSizeMilli: bundle.sizeMilli,
          units: 1,
          qtyMilli: bundle.sizeMilli,
          priceCents: bundle.priceCents,
          formulaVersionId: null,
        },
      ];
    });
  }

  /**
   * What goes in `units` for a quantity.
   *
   * On a bundle line it is how many bundles — that is what the price multiplies.
   * On a weighed line it is 1, because `qtyMilli` carries the order. On a whole
   * unit it is the container count.
   */
  function unitsFor(item: SellItem, qtyMilli: number, line?: { bundleId: number | null; bundleSizeMilli: number }): number {
    if (line?.bundleId != null && line.bundleSizeMilli > 0) {
      return Math.max(1, Math.round(qtyMilli / line.bundleSizeMilli));
    }
    if (item.basis === "unit") return 1;
    return Math.max(1, Math.round(qtyMilli / Math.max(1, item.sizeMilli)));
  }

  function setLinePrice(key: string, cents: number) {
    setCart((prev) =>
      prev.map((l) => (lineKey(l) === key ? { ...l, priceCents: cents } : l)),
    );
  }

  /**
   * Which book a sale goes in.
   *
   * Not a price switch any more — there is one price — but reports still split
   * trade from counter, and that split is a fact about the buyer rather than a
   * button somebody has to remember to press. A named wholesale customer makes
   * it a wholesale sale; a walk-in makes it a counter one.
   */
  const tier: Tier = customer?.kind === "wholesale" ? "wholesale" : "retail";

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
      lines: cart.map((l) => ({
        // A mixed product has no item. The server turns the bundle into the
        // priced product plus the chemicals it is mixed from.
        itemId: l.mixKey ? undefined : l.itemId,
        units: l.units,
        unitPriceCents: l.priceCents,
        // A bundle is priced whole, so it bills like a pack however the parent
        // chemical is otherwise sold.
        basis: l.bundleId !== null ? ("pack" as const) : (byId.get(l.itemId)?.basis ?? "pack"),
        qtyMilli: l.qtyMilli,
        formulaVersionId: l.formulaVersionId,
        bundleId: l.bundleId,
      })),
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
  const countMatch = q.match(/^(\d{1,4}(?:\.\d{1,3})?)\s*[x*]?\s+(.*)$/);
  const queryCount = countMatch ? Math.max(0.001, Number(countMatch[1])) : 1;
  const searchText = countMatch ? countMatch[2].trim() : q;

  const matches = searchText
    ? items.filter((i) => i.search.includes(searchText)).sort(shelfOrder)
    : [];
  /**
   * Everything sellable is a chemical now.
   *
   * The Products board used to hold the bottles the shop mixed itself and this
   * one held the rest. Nothing is mixed in-house any more, so what is on the
   * shelf is chemicals and the containers to carry them in, and Products has
   * become the recipe board instead — the list of things a customer walks in
   * intending to make.
   */
  const chemicals = [...items].sort(shelfOrder);
  const top = topSellerIds.map((id) => byId.get(id)).filter((i): i is SellItem => Boolean(i));


  /** Lines from the last order that can still be sold today. */
  const repeatUsable = repeat ? repeat.lines.filter((l) => l.available && byId.has(l.itemId)) : [];

  /** Ingredients this shop cannot bill at all, and how many it can. */
  const mixLeftOut = (mixOffer?.ingredients ?? [])
    .filter((i) => i.unlisted || i.unpriced)
    .map((i) => i.chemicalName);
  /*
    Stocked, sold, and still priced by the pack.

    Its own message because it has its own fix, and because the alternative is
    an attendant staring at a shelf full of Ungerol while the till insists it is
    "not on the price list" — which reads as the till being broken, not as a
    step nobody has taken yet.
  */
  const mixLegacy = (mixOffer?.ingredients ?? [])
    .filter((i) => i.legacyPackPriced)
    .map((i) => i.chemicalName);
  const mixShort = (mixOffer?.ingredients ?? []).filter((i) => i.short && !i.unlisted && !i.unpriced);
  const mixAddable = (mixOffer?.ingredients ?? []).filter(
    (i) => !i.unlisted && !i.legacyPackPriced && !i.unpriced,
  ).length;


  // ---- shared render closures: one markup, two dressings (phone sheet /
  // desktop panel). They close over all state; nothing is duplicated. ----

  /**
   * After a sale: the receipt is one tap away, the next customer zero taps.
   * Queued (offline) sales get the same reassurance banner, plus a receipt the
   * customer can actually be handed — built entirely from what the counter
   * already had in memory, since a queued sale by definition cannot ask the
   * server for anything more.
   */
  const renderReceipt = () => {
    if (!receipt) return null;
    if (receipt.status === "queued") {
      const local = receiptFromQueued(receipt, byId, printer);
      return (
        <div className="space-y-2.5">
          <Alert tone="warn">
            Saved on this phone — {formatKes(receipt.totalCents)}.{" "}
            {receipt.reason === "offline" ? "There is no network." : "The till did not answer."}{" "}
            It will send itself as soon as the connection is back. Nothing is lost.
          </Alert>
          <div className="flex gap-2">
            <ThermalPrint receipt={local} paper={printer.paper} auto={false} />
            <PdfShareButton
              source={{ bytes: receiptToPdf(local) }}
              fileName="pending-sale.pdf"
              shareTitle="Pending sale"
              label="PDF"
            />
          </div>
          <p className="text-center text-[11px] text-muted">
            Marked PENDING — the real invoice number is issued once this sale reaches the till.
          </p>
        </div>
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
          {lines.map(({ line, item }) => {
            const key = lineKey(line);
            return (
              <CartRow
                key={key}
                item={item}
                line={line}
                onStep={(d) => changeUnits(key, d)}
                onQuantity={(v) => setQuantity(key, v)}
                onPrice={(c) => setLinePrice(key, c)}
                onKeepPrice={(pin) => onKeepPrice(line.itemId, line.priceCents, pin)}
              />
            );
          })}
        </div>
        {overdrawn.length ? (
          <div className="mt-3">
            <Alert tone="bad">
              <span className="font-bold">
                There is not enough{" "}
                {overdrawn.length === 1 ? overdrawn[0].item.name : "of some chemicals"} in the store.
              </span>{" "}
              A quantity is weighed out of the drum, so this one cannot be sold until the delivery
              is recorded — or, if the store really does have more than the book says, until a stock
              take says so.
            </Alert>
          </div>
        ) : oversold.length ? (
          <div className="mt-3">
            <Alert tone="warn">
              Selling more {oversold.length === 1 ? oversold[0].item.name : "of some items"} than the
              shelf shows. The sale is fine — the count will just go negative until you do a stock
              take.
            </Alert>
          </div>
        ) : null}

        {/* Not styled as a warning. A discount here is a decision the attendant
            is allowed to make; this is so they make it with the figure in front
            of them, and so it is the same figure the customer's receipt will
            carry. */}
        {discountCents > 0 ? (
          <div className="mt-2.5 flex items-baseline justify-between rounded-xl bg-good-soft px-3 py-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-good">
              Discount given
            </span>
            <span className="text-sm font-extrabold text-good tnum">
              −{formatKes(discountCents)}
              <span className="ml-1.5 text-[11px] font-semibold text-muted">
                was {formatKes(atListCents)}
              </span>
            </span>
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
          {discountCents > 0 ? (
            <div className="mt-1 flex items-baseline justify-between gap-3 text-[11px] font-semibold">
              <span className="text-muted">Was {formatKes(atListCents)}</span>
              <span className="text-good">−{formatKes(discountCents)} discount</span>
            </div>
          ) : null}
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
                placeholder="M-Pesa code (optional)"
                aria-label="M-Pesa transaction code, optional"
                autoCapitalize="characters"
                autoComplete="off"
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
                    placeholder="M-Pesa code (optional)"
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
                  New customers start with no credit limit, so anything they owe needs the owner’s
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
          // The till refuses this too. Stopping it here means the counter finds
          // out before it asks the customer for money, not after.
          overdrawn.length > 0 ||
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

      {mpesaMissingCode ? (
        <p className="mt-2 text-xs font-semibold text-muted">
          No M-Pesa code — the sale still records. Add it later from the sale if the SMS turns up.
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
    <div className="pb-24 lg:flex lg:h-[calc(100dvh-var(--pos-header)-(var(--pos-pad)*2))] lg:flex-col lg:pb-0">
      {/*
        The wholesale banner used to sit here, over a toggle that switched the
        whole cart between two price lists. There is one price list now, so
        there is nothing to switch and nothing to leave in the wrong position —
        which was the thing the banner existed to shout about.
      */}

      {/*
        Everything that is not an item, on one line.

        This used to be three separate things fighting over the top-left: a
        heading that said "Sell" on the selling screen, and a pair of board
        buttons stacked vertically in a 4.5rem gutter of their own, aligned with
        nothing and empty for five hundred pixels below them. The heading is
        gone — the screen announces itself — and the boards have come inside,
        where they cost no height at all because the search row was already
        there and half empty.
      */}
      <div className="mb-2.5 flex items-center gap-2 lg:mb-1.5">
        <div
          role="tablist"
          aria-label="What to sell"
          className="hidden shrink-0 gap-1 rounded-2xl bg-wash p-1 ring-1 ring-inset ring-line lg:flex"
        >
          {BOARDS.map((b) => {
            const on = board === b.key && !q;
            const count = (b.key === "products" ? recipes : chemicals).length;
            return (
              <button
                key={b.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => {
                  // A board and a search are two different questions. Picking a
                  // board answers the first, so it drops the second rather than
                  // leaving results on screen that the board no longer explains.
                  setQuery("");
                  setBoard(b.key);
                }}
                className={`flex min-h-9 items-center gap-1.5 rounded-xl px-3.5 text-sm font-bold transition-colors ${
                  on ? "bg-white text-brand-deep shadow-card" : "text-muted hover:text-ink"
                }`}
              >
                {b.label}
                <span className={`text-[11px] font-semibold tnum ${on ? "text-muted" : "text-muted/70"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="min-w-0 flex-1">
          <input
            ref={searchRef}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || !matches.length) return;
              e.preventDefault();
              {
                const hit = matches.find((i) => i.qtyMilli > 0) ?? matches[0];
                // "20 caustic" means twenty kilos of a weighed chemical and
                // twenty jerricans of anything sold whole — the same sentence,
                // read in the unit the thing is priced in.
                addQuantity(hit, queryCount * stepMilli(hit), null);
              }
              setQuery("");
            }}
            // 44px is a thumb on a phone and wasted height on a laptop with a
            // keyboard. The counter's 13" screen is the one with none to spare.
            className={`${inputClass} lg:min-h-9 lg:py-1.5`}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search — name, or chemical (sles, labsa…)"
            aria-label="Search items"
          />
        </div>

        <Link href="/sales" className="shrink-0 text-xs font-bold text-brand">
          History
        </Link>
      </div>

      {/*
        The morning price check used to live on a screen of its own, and this is
        where it was advertised. Both are gone: a price is changed where it is
        argued about, which is here, on the line — see `onKeepPrice`.
      */}

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
      {/* Two columns now, not three: the board gutter has gone up into the
          search row, and its 72px went to the items. */}
      <div className="lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-stretch lg:gap-3 xl:grid-cols-[minmax(0,1fr)_19rem] xl:gap-4 2xl:grid-cols-[minmax(0,1fr)_22rem] 2xl:gap-5 3xl:grid-cols-[minmax(0,1fr)_24rem]">

      {/* A container, so the tile grid counts columns from the space it actually
          has rather than from the window. No breakpoint has to know what else
          is on the row. */}
      <div className="@container min-w-0 lg:h-full lg:overflow-y-auto lg:pr-1">
      {/* Pinned to the top of the scrolling column: on a keyboard till, search
          is how the counter works, and it must never be somewhere up the page. */}
      <div className="lg:sticky lg:top-0 lg:z-10 lg:-mt-1 lg:bg-wash lg:pb-1 lg:pt-0">

        {/* Sticky with the search, so changing board never means scrolling
            back up for it. Hidden while searching: a search already looks
            across both boards, and a switcher that filtered the results would
            hide the very thing that was just found. */}
        {q ? null : (
          <div
            role="tablist"
            aria-label="What to sell"
            className="mt-2 grid grid-cols-2 gap-1 rounded-2xl bg-wash p-1 ring-1 ring-inset ring-line lg:hidden"
          >
            {BOARDS.map((b) => {
              const on = board === b.key;
              const count = (b.key === "products" ? recipes : chemicals).length;
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
      {!cart.length && repeatUsable.length > 0 ? (
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


        </div>
      ) : null}

      {mixOpen ? (
        <div className="mt-3 rounded-2xl bg-white p-3.5 shadow-card ring-1 ring-ink/5">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                Chemicals for
              </span>
              <p className="truncate text-sm font-bold text-brand-deep">
                {recipes.find((r) => r.versionId === mixVersion)?.name ?? "—"}
              </p>
            </div>
            <label className="w-28">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                Making (L)
              </span>
              <input
                className={`${inputClass} tnum`}
                value={mixSize}
                onChange={(e) => {
                  setMixSize(e.target.value);
                  setMixOffer(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void previewMix();
                  }
                }}
                inputMode="decimal"
                aria-label="How much they are making, in litres"
              />
            </label>
            <Button
              variant="ghost"
              className="px-4 py-2.5 text-sm"
              disabled={mixBusy || mixVersion === null || !mixSize.trim()}
              onClick={() => previewMix()}
            >
              {mixBusy ? "Working…" : "Update"}
            </Button>
            <button
              type="button"
              onClick={() => {
                setMixOpen(false);
                setMixOffer(null);
              }}
              aria-label="Close"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted transition-colors hover:bg-wash hover:text-ink"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M6 6l12 12 M18 6l-12 12" />
              </svg>
            </button>
          </div>

          {mixOffer ? (
            <div className="mt-3">
              {/* Quantity, then rate, then money — the three things the customer
                  asks about, in the order they ask. Weighed to the gram, so
                  nothing here rounds up to a pack anybody has to be talked into. */}
              <div className="divide-y divide-line">
                {mixOffer.ingredients.map((ing) => (
                  <div key={ing.chemicalName} className="flex items-baseline gap-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-bold">
                      {ing.chemicalName}
                    </span>
                    <span className="shrink-0 text-[12px] font-semibold text-muted tnum">
                      {formatQty(ing.qtyMilli, ing.unit)}
                    </span>
                    {ing.unlisted || ing.legacyPackPriced || ing.unpriced ? (
                      <span className="shrink-0 text-[12px] font-bold text-bad">
                        {ing.legacyPackPriced
                          ? "still priced by the pack"
                          : ing.unlisted
                            ? "not on the price list"
                            : "no price set"}
                      </span>
                    ) : (
                      <span
                        className={`shrink-0 text-[12px] font-bold tnum ${
                          ing.short ? "text-warn" : "text-brand-dark"
                        }`}
                      >
                        {ing.short
                          ? `only ${formatQty(Math.max(0, ing.availableMilli), ing.unit)} left`
                          : formatKes(ing.amountCents)}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                  {mixOffer.ingredients.length} chemical
                  {mixOffer.ingredients.length === 1 ? "" : "s"}
                </span>
                <span className="text-base font-extrabold tnum">{formatKes(mixOffer.totalCents)}</span>
              </div>

              {/*
                A refusal with an answer attached.

                Two things can stop a mix, and they want different sentences. A
                chemical with no price is a gap in the catalogue and no batch
                size fixes it. A chemical the store has run low on is answered by
                a number: how much they could make with what is actually here,
                offered as a button so nobody has to work it out.
              */}
              {mixLegacy.length ? (
                <div className="mt-2">
                  <Alert tone="warn">
                    <span className="font-bold">
                      {mixLegacy.length === mixOffer.ingredients.length
                        ? "These chemicals are"
                        : `${mixLegacy.join(", ")} ${mixLegacy.length === 1 ? "is" : "are"}`}{" "}
                      still priced by the pack.
                    </span>{" "}
                    They are in the store and they sell — but with no price per kilogram there is
                    nothing to bill a recipe’s few grams against.{" "}
                    {isOwner ? (
                      <>
                        Open{" "}
                        <Link href="/items" className="font-bold underline">
                          Products & prices
                        </Link>{" "}
                        and press “Move to per-kilogram pricing” — once, and this
                        recipe adds up from then on.
                      </>
                    ) : (
                      "Ask the owner to move the catalogue to per-kilogram pricing; it is one button on Products & prices."
                    )}
                  </Alert>
                </div>
              ) : null}

              {mixLeftOut.length ? (
                <div className="mt-2">
                  <Alert tone="bad">
                    <span className="font-bold">
                      {mixLeftOut.join(", ")} cannot be billed.
                    </span>{" "}
                    {/* The space is explicit. JSX drops the one between an
                        expression and the text that follows it when that text
                        wraps to the next source line, and "Tap iton the
                        Chemicals board" is what reached the screen. */}
                    Tap {mixLeftOut.length === 1 ? "it" : "them"}{" "}
                    on the Chemicals board, set a price, and take “Keep as the new
                    price” — then this recipe adds up in full. The rest can still go on the
                    sale.
                  </Alert>
                </div>
              ) : null}

              {mixShort.length ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Alert tone="warn">
                    <span className="font-bold">
                      Not enough {mixShort.map((i) => i.chemicalName).join(", ")}.
                    </span>{" "}
                    {mixOffer.possibleMilli > 0
                      ? `There is enough in the store for ${formatQty(mixOffer.possibleMilli, "L")}.`
                      : "Record a delivery, or do a stock take if the store has more than the book says."}
                  </Alert>
                  {mixOffer.possibleMilli > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        const litres = milliToInput(mixOffer.possibleMilli);
                        setMixSize(litres);
                        void previewMix(mixVersion, litres);
                      }}
                      className="rounded-full bg-brand-soft px-3 py-1.5 text-[12px] font-bold text-brand-dark"
                    >
                      Make {formatQty(mixOffer.possibleMilli, "L")} instead
                    </button>
                  ) : null}
                </div>
              ) : null}

              <Button
                className="mt-3 w-full text-sm"
                disabled={!mixAddable || mixShort.length > 0}
                onClick={addMixToCart}
              >
                {!mixAddable
                  ? "Nothing here can be billed"
                  : mixShort.length > 0
                    ? "Not enough in the store"
                    : `Add ${mixAddable} chemical${mixAddable === 1 ? "" : "s"} — ${
                        mixOffer.formulaName
                      }, ${formatQty(mixOffer.targetMilli, "L")} · ${formatKes(mixOffer.totalCents)}`}
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
            /*
              A count typed into the search box — "20 ungerol" — is the counter
              already saying how much, so it is honoured and the size sheet
              stays out of the way. A bare tap has said nothing about quantity,
              so it asks, exactly as a tap on the board does.
            */
            onAdd={(item) =>
              queryCount > 1
                ? addQuantity(item, queryCount * stepMilli(item), null)
                : addItem(item)
            }
            cart={cart}
            searching
          />
        </>
      ) : (
        <>
          {top.length ? (
            <>
              {/*
                One line, and it scrolls sideways rather than wrapping.

                As a heading plus a wrapping band this cost about 130px before
                the first product tile — on a 13" laptop that is a whole row of
                items, spent on shortcuts to items that are also further down
                the same screen. The label has come inline and the chips no
                longer wrap, so the same six shortcuts cost one strip.
              */}
              {/*
                Gone on a short screen.

                This is a shortcut to items that are also in the grid below it,
                and it costs about 43px — on the shop's 13" laptop that is a
                whole row of stock, traded for a convenience. The rule is the
                viewport's HEIGHT, not its width: a 1280x800 desktop keeps it, a
                1280x610 laptop does not, and those are the same width.
              */}
              <div className="-mx-4 mb-2 flex items-center gap-2 overflow-x-auto px-4 pb-0.5 md:mx-0 md:px-0 [@media(max-height:760px)]:lg:hidden">
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
                  Top today
                </span>
                {top.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => addItem(item)}
                    title={item.name}
                    className="flex shrink-0 items-baseline gap-2 rounded-full border border-brand/30 bg-brand-soft py-2 pl-3.5 pr-3 text-left transition-colors hover:border-brand/60 lg:py-1.5"
                  >
                    <span className="max-w-[11rem] truncate text-[13px] font-bold leading-none">
                      {item.name}
                    </span>
                    <span className="text-[13px] font-extrabold leading-none text-brand tnum">
                      {formatKes(listPrice(item))}
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
            className="@container mt-3 lg:mt-0"
          >
            {board === "products" ? (
              recipes.length ? (
                <RecipeGrid recipes={recipes} onOpen={openMix} openVersionId={mixOpen ? mixVersion : null} />
              ) : (
                <p className="py-8 text-center text-sm text-muted">
                  No recipes are written down yet.
                </p>
              )
            ) : chemicals.length ? (
              <Grid items={chemicals} onAdd={addItem} cart={cart} />
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
          {cart.length && deskPane === "cart" ? <ClearCart onClear={() => setCart([])} /> : null}
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
                  className="w-full text-base"
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
              className="min-h-14 flex-1 bg-brand px-4 text-base font-extrabold text-white tnum"
            >
              Pay {formatKes(totalCents)}
            </button>
          </div>
        </div>
      ) : null}

      <div className="lg:hidden">
        {sheet === "cart" ? (
          <Sheet
            title="Cart"
            onClose={() => setSheet("none")}
            // Emptying the cart was a desktop-only button, which left the phone
            // — the thing actually on the counter — with no way to abandon a
            // sale except taking every line down to nothing one tap at a time.
            action={
              cart.length ? (
                <ClearCart
                  onClear={() => {
                    setCart([]);
                    setSheet("none");
                  }}
                />
              ) : null
            }
          >
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

      {/* Outside the phone-only block on purpose: choosing a size is picking an
          item, not working the cart, and the laptop at the counter needs it as
          much as the phone does. */}
      {/*
        The window stays open while sizes are tapped.

        Closing on each pick would make "three of the 5 kg" three round trips
        through the tile, which is exactly the rhythm the counter had before
        bundles existed and the thing worth protecting. Done, the ✕ and the
        backdrop all close it.
      */}
      {sizeFor ? (
        <SizePicker
          item={sizeFor}
          lines={cart.filter((l) => !l.mixKey && l.itemId === sizeFor.id)}
          onLoose={(qtyMilli) => addQuantity(sizeFor, qtyMilli, null)}
          onBundle={(b) => addBundle(sizeFor, b)}
          onClose={() => setSizeFor(null)}
        />
      ) : null}

      {/* The same window for a mixed product. Its odd-quantity route is the
          batch pricer rather than a weight box, because a recipe is mixed to a
          size and "any weight of Carwash Shampoo" is a batch to be made. */}
      {recipeSizeFor ? (
        <RecipeSizePicker
          recipe={recipeSizeFor}
          lines={cart.filter((l) => l.mixKey?.startsWith(`f${recipeSizeFor.formulaId}:`))}
          onBundle={(b) => addRecipeBundle(recipeSizeFor, b)}
          onBatch={() => {
            const r = recipeSizeFor;
            setRecipeSizeFor(null);
            const litres = String(r.refSizeMilli / 1000);
            setMixOffer(null);
            setMixVersion(r.versionId);
            setMixSize(litres);
            setMixOpen(true);
            void previewMix(r.versionId, litres);
          }}
          onClose={() => setRecipeSizeFor(null)}
        />
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------- parts

/**
 * The recipe board.
 *
 * Deliberately not the item grid with different data in it. A recipe has no
 * price, no stock and no size — tapping one does not add anything to the cart,
 * it asks a question ("how much are you making?") — so a tile that looked like
 * a product tile would be promising three things it cannot deliver.
 */
function RecipeGrid({
  recipes,
  onOpen,
  openVersionId,
}: {
  recipes: RecipeChoice[];
  onOpen: (recipe: RecipeChoice) => void;
  openVersionId: number | null;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 @[22rem]:grid-cols-3 @[30rem]:grid-cols-4 @[30rem]:gap-2.5 @[44rem]:grid-cols-5 @[62rem]:grid-cols-6">
      {recipes.map((r) => {
        const sw = swatchFor(r.name);
        const open = r.versionId === openVersionId;
        return (
          <button
            key={r.versionId}
            type="button"
            onClick={() => onOpen(r)}
            title={r.name}
            className={`relative flex h-[6.75rem] w-full flex-col overflow-hidden rounded-2xl py-2.5 pl-3.5 pr-3 text-left shadow-card ring-1 transition-colors md:h-[6rem] lg:h-[5rem] xl:h-[4.75rem] xl:py-2 xl:pl-3 xl:pr-2.5 2xl:h-[5.5rem] 3xl:h-[6.75rem] ${
              open ? "bg-brand-soft ring-brand/40" : "ring-ink/5 hover:ring-brand/30"
            }`}
            style={open ? undefined : { backgroundColor: sw.tint }}
          >
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 w-[4px]"
              style={{ backgroundColor: sw.bar }}
            />
            <div className={`truncate font-extrabold ${nameSize(r.name)}`}>{r.name}</div>
            <div className="mt-0.5 text-[11px] font-semibold text-muted">
              {r.ingredientCount} chemical{r.ingredientCount === 1 ? "" : "s"}
            </div>
            {/* Short on purpose. Three tiles to a row on a 390px phone leaves
                about ninety pixels here, and "Price up a batch →" was clipped
                to "Price up a bat". */}
            <div className="mt-auto whitespace-nowrap text-[12px] font-bold leading-none text-brand-deep">
              Price it up →
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Grid({
  items,
  onAdd,
  cart,
  searching = false,
}: {
  items: SellItem[];
  onAdd: (item: SellItem) => void;
  cart: CartLine[];
  searching?: boolean;
}) {
  // The counter's worst enemy is scrolling past dead tiles with a queue
  // watching. Browsing shows sellable stock first and folds the rest away;
  // an explicit search still finds everything, including unpriced items.
  const visible = searching ? items : items.filter((i) => listPrice(i) > 0);
  const inStock = visible.filter((i) => i.qtyMilli > 0);
  const outOfStock = visible.filter((i) => i.qtyMilli <= 0);

  if (!visible.length) {
    return <p className="py-6 text-center text-sm text-muted">Nothing here.</p>;
  }

  const tile = (item: SellItem) => {
    // Any line of this item counts as "in the cart" — loose or any bundle.
    const inCart = cart.find((l) => l.itemId === item.id);
    // "5 · 10 · 20" under the price, so the sizes are discoverable without a
    // tap. Without this the sheet is a surprise the first few times.
    const sizes = item.bundles.map((b) => formatQty(b.sizeMilli, item.unit).replace(/\s*\w+$/, "")).join(" · ");
    const out = item.qtyMilli <= 0;
    const unpriced = listPrice(item) === 0;
    const { base, size } = splitName(item.name);
    // "25 drums · 1,000 kg". The owner counts containers on the floor; the
    // counter sells out of them by the kilogram. Neither number on its own
    // answers "can I sell this order", so a weighed item carries both.
    const stock = stockLabel(item);
    // The item's own colour, and how large its name can be set. See lib/swatch.
    const sw = swatchFor(item.name);
    const body = (
      <button
        type="button"
        onClick={() => onAdd(item)}
        title={item.name}
        // A fixed height on every tile is what turns forty of these from a
        // ragged pile into something scannable: price sits at the same eye
        // level in every column, so the grid can be read down as well as across.
        //
        // One height for every tile, made-here or not. They used to differ by
        // the height of the footer as well as carrying it, so a product cost two
        // footers of screen — on a 13" laptop that was a row of items per board.
        // The footer now simply adds itself underneath.
        //
        // Laptop sizes are their own step rather than inheriting the tablet's.
        // 1280×800 is the screen this shop actually uses and the one with the
        // least room to spare: everything above the grid competes with it, so
        // the tile is sized to its content there and nothing more.
        className={`relative flex h-[6.75rem] w-full flex-col overflow-hidden rounded-2xl py-2.5 pl-3.5 pr-3 text-left shadow-card ring-1 transition-colors md:h-[6rem] lg:h-[5rem] xl:h-[4.75rem] xl:py-2 xl:pl-3 xl:pr-2.5 2xl:h-[5.5rem] 3xl:h-[6.75rem] ${
          inCart ? "bg-brand-soft ring-brand/40" : "ring-ink/5 hover:ring-brand/30"
        } ${out ? "opacity-70" : ""}`}
        // The tint only when the tile is not already carrying the in-cart
        // highlight: two backgrounds fighting would lose the one that matters.
        style={inCart ? undefined : { backgroundColor: sw.tint }}
      >
        {/* What is on the bill for this item, in the unit it is sold in: "3"
            jerricans, or "1.5 kg". A weighed line showing "1" would be the one
            number on the tile that means nothing. */}
        {inCart ? (
          <span className="absolute right-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-brand px-1.5 text-xs font-extrabold text-white tnum">
            {item.basis === "unit" ? formatQty(inCart.qtyMilli, item.unit) : inCart.units}
          </span>
        ) : null}
        {/* The chemical's own colour, down the leading edge. Four pixels is
            enough to group a grid by at a glance and costs no room at all. */}
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[4px]"
          style={{ backgroundColor: sw.bar }}
        />

        {/* The name IS the picture here, so a short one is set large. Most of
            this shelf is four-letter abbreviations — see lib/swatch. */}
        <div className={`truncate font-extrabold ${nameSize(item.name)} ${inCart ? "pr-7" : ""}`}>
          {base}
        </div>

        {/*
          Size on the left, what is on the shelf on the right — but only from
          tablet up, where a tile is wide enough for both.

          The shelf count used to sit beside the price. On a five-column laptop
          grid it lost that fight and rendered as "99,952…", an ellipsis shoving
          the one figure a tile cannot be wrong about. Pairing it with the size
          instead gives the price its own line and the count room to be read.

          On a phone the tile is three to a row and about 110px wide, which is
          not enough for "1 L" and "181 jerricans" side by side, so there the
          count drops back under the price where it has the full width.
        */}
        {/* The size is set larger than the shelf count beside it. When one
            chemical has three packs — H.C.L at 250 g, 500 g and 1 kg — the size
            is the whole difference between them, and it was the smallest thing
            on the tile. */}
        <div className="mt-0.5 flex h-[1.05rem] items-baseline gap-1.5">
          {/* For a weighed chemical the container size is not what is being
              bought, so the line says what it IS sold by. */}
          <span className="shrink-0 text-[12.5px] font-bold" style={{ color: sw.bar }}>
            {/* When there are sizes to choose from, say so here rather than
                "per kg" — "5 · 10 · 20" is what a tap is about to offer, and a
                sheet nobody expects is a sheet nobody uses. */}
            {sizes || (item.basis === "unit" ? `per ${item.unit}` : (size ?? ""))}
          </span>
          <span
            className={`ml-auto hidden min-w-0 truncate text-right text-[11px] font-semibold tnum md:block ${
              out ? "font-bold text-bad" : "text-muted/80"
            }`}
          >
            {stock}
          </span>
        </div>

        <div className="mt-auto flex flex-col gap-0.5">
          {/* Just the money.

              This used to read "KES 742.60/kg", and three tiles to a row on a
              390px phone leaves eighty-eight pixels, which that does not fit in
              at any size worth reading — so the "/kg" was being clipped off the
              end, turning a rate into what looked like the price of the whole
              drum. The tile already says "per kg" under the name, two lines up.
              Saying it twice was what cost the room. A long price still steps
              down a size rather than wrap or truncate; see `priceSize`. */}
          <span
            className={`whitespace-nowrap font-extrabold leading-none tnum ${
              unpriced
                ? "text-[13px] font-bold text-muted"
                : `${priceSize(formatKes(listPrice(item)))} text-brand-deep`
            }`}
          >
            {unpriced ? "No price set" : formatKes(listPrice(item))}
          </span>
          <span
            className={`truncate text-[11px] leading-none tnum md:hidden ${
              out ? "font-bold text-bad" : "text-muted"
            }`}
          >
            {stock}
          </span>
        </div>
      </button>
    );

    return <div key={item.id}>{body}</div>;
  };

  // Measured against the column, not the window (see the @container above), and
  // chosen so a tile is never narrower than about 180px — the width at which
  // product names start being eaten by the ellipsis again.
  const cols =
    "grid grid-cols-2 gap-2 @[22rem]:grid-cols-3 @[30rem]:grid-cols-4 @[30rem]:gap-2.5 @[44rem]:grid-cols-5 @[62rem]:grid-cols-6";

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
            Stock arrives by{" "}
            <Link href="/purchases" className="font-semibold text-brand">recording a delivery</Link>.
            Already have some in the store that is not showing? Fix it with a{" "}
            <Link href="/stock?panel=count" className="font-semibold text-brand">Stock take</Link>.
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
  onStep,
  onQuantity,
  onPrice,
  onKeepPrice,
}: {
  /** Null for a mixed product sold by the size — it is on no shelf. */
  item: SellItem | null;
  line: CartLine;
  /** One more, or one fewer — one container, or one kilogram. */
  onStep: (delta: number) => void;
  /** A quantity typed outright, in containers or in kg / L. */
  onQuantity: (value: number) => void;
  onPrice: (cents: number) => void;
  /** Make the price on this line the shop's price from now on. */
  onKeepPrice: (
    ownerPin?: string,
  ) => Promise<{ ok: true; message: string } | { ok: false; error: string; needsPin: boolean }>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => centsToInput(line.priceCents));
  /** Held while the box is being typed in, so a half-typed "2" of "20" is not applied. */
  const [qtyDraft, setQtyDraft] = useState<string | null>(null);
  const bundled = line.bundleId !== null;
  /*
    A bundle line is priced whole, so it is not the shop's per-kilogram price
    that it is being compared against — it has its own. Marking it "discounted"
    against the loose rate would put a red pencil on every bundle ever sold.
  */
  /** A mixed product sold by the size: no item, no shelf, no band. */
  const mixed = Boolean(line.mixKey);
  const name = item?.name ?? line.mixName ?? "";
  const unit = item?.unit ?? "L";
  const list = bundled ? line.priceCents : item ? listPrice(item) : line.priceCents;
  const discounted = line.priceCents !== list;
  const weighed = !mixed && item?.basis === "unit" && !bundled;
  /** What the box shows: "2" bundles, "3" jerricans, or "1.5" kilograms. */
  const shown = weighed ? milliToInput(line.qtyMilli) : String(line.units);
  const over = item ? line.qtyMilli > item.qtyMilli : false;

  /*
    Keeping the price.

    Two different things happen when an attendant changes a price here, and only
    the person standing there knows which: this customer talked them down (one
    sale), or the supplier's price moved and this is the real number from now on
    (every sale). Guessing would be wrong either way, so the second is an
    explicit second tap — offered only once the price actually differs, and gone
    again the moment it is taken.
  */
  const [keepState, setKeepState] = useState<"idle" | "busy" | "pin" | "done">("idle");
  const [keepPin, setKeepPin] = useState("");
  const [keepNote, setKeepNote] = useState<string | null>(null);

  async function keep(pin?: string) {
    setKeepState("busy");
    setKeepNote(null);
    try {
      const result = await onKeepPrice(pin);
      if (result.ok) {
        setKeepState("done");
        setKeepNote(result.message);
        setKeepPin("");
      } else {
        setKeepState(result.needsPin ? "pin" : "idle");
        setKeepNote(result.error);
      }
    } catch {
      setKeepState("idle");
      setKeepNote("Could not reach the till. The sale is unaffected.");
    }
  }

  function commit() {
    const cents = parseCents(draft);
    if (cents !== null) onPrice(cents);
    else setDraft(centsToInput(line.priceCents));
    setEditing(false);
  }

  const { base, size } = splitName(name);

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
    <div className="py-2">
    <div className="flex items-center gap-2.5">
      <div className="flex shrink-0 items-center rounded-lg bg-white ring-1 ring-inset ring-line">
        <button
          type="button"
          onClick={() => onStep(-1)}
          aria-label={`Less ${name}`}
          className="h-8 w-6 rounded-l-lg text-base font-extrabold text-brand-dark hover:bg-wash"
        >
          −
        </button>
        {/*
          Typing beats tapping: twenty of something was twenty taps.

          A weighed chemical accepts a decimal point, and that box is the whole
          of what replaced the repacking bench — 250 g of caustic used to mean
          somebody having made up a 250 g pack in advance, and now it means
          typing 0.25. So the filter lets a dot through, but only for things
          actually sold by weight: half a jerrican is still not a thing.
        */}
        <input
          className={`bg-transparent text-center text-[13px] font-extrabold tnum outline-none ${
            weighed ? "w-11" : "w-7"
          }`}
          value={qtyDraft ?? shown}
          onChange={(e) =>
            setQtyDraft(e.target.value.replace(weighed ? /[^\d.]/g : /[^\d]/g, ""))
          }
          onFocus={(e) => {
            setQtyDraft(shown);
            e.currentTarget.select();
          }}
          onBlur={() => {
            const n = Number(qtyDraft);
            if (qtyDraft !== null && qtyDraft !== "" && Number.isFinite(n) && n > 0) onQuantity(n);
            setQtyDraft(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setQtyDraft(null);
              e.currentTarget.blur();
            }
          }}
          inputMode={weighed ? "decimal" : "numeric"}
          aria-label={weighed ? `How much ${name}, in ${unit}` : `How many ${name}`}
        />
        {weighed ? (
          <span className="pr-1 text-[10px] font-bold text-muted">{item.unit}</span>
        ) : null}
        <button
          type="button"
          onClick={() => onStep(1)}
          aria-label={`More ${name}`}
          className="h-8 w-6 rounded-r-lg text-base font-extrabold text-brand-dark hover:bg-wash"
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
            aria-label={`Price for ${name}`}
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
            <div className="truncate text-[13px] font-bold leading-tight" title={name}>
              {base}
            </div>
            <button
              type="button"
              onClick={() => {
                setDraft(centsToInput(line.priceCents));
                setEditing(true);
              }}
              // Not truncated. This line carries the rate — "KES 473/L" — and a
              // weighed line's stepper is wide enough to squeeze the column to
              // where an ellipsis ate exactly the digits the price consists of.
              // Wrapping to a second line is the right failure here.
              className="mt-0.5 block text-[11px] font-semibold text-brand"
              aria-label={`Change the price of ${name}`}
              title={`Tap to agree a different price for ${name}`}
            >
              {bundled ? (
                <span className="text-muted">
                  {formatQty(line.bundleSizeMilli, unit)} bundle ·{" "}
                </span>
              ) : !weighed && size ? (
                <span className="text-muted">{size} · </span>
              ) : null}
              <span className="underline decoration-brand/30 decoration-dotted underline-offset-2">
                {weighed ? priceLabel(item, line.priceCents) : `${formatKes(line.priceCents)} each`}
              </span>
              {/* A pencil, once, small. The dotted underline alone was not
                  enough for an attendant to know a price could be argued down
                  here — the owner asked for this to be possible, and a thing
                  nobody can find is not possible. */}
              <span aria-hidden className="ml-1 text-[10px] text-brand/60">
                ✎
              </span>
              {discounted ? (
                <span className="ml-1.5 text-muted line-through">
                  {weighed ? priceLabel(item, list) : formatKes(list)}
                </span>
              ) : null}
              {/* Named on the line it belongs to, not only in the banner above:
                  with six lines on the bill, "not enough stock" without a name
                  is a hunt. */}
              {over && item ? (
                <span className="ml-1.5 font-bold text-warn">
                  only {formatQty(Math.max(0, item.qtyMilli), unit)} left
                </span>
              ) : null}
            </button>
          </div>
          <div className="shrink-0 text-right text-sm font-extrabold tnum">
            {formatKes(lineCents(item, line))}
          </div>
        </>
      )}
    </div>

    {/*
      Offered only once the price differs from the shop's, because until then
      there is nothing to keep. A second tap, not a side effect of the first:
      most price changes here are one customer haggling, and quietly moving the
      shelf price every time somebody argued would be a catalogue written by
      whoever pushed hardest.
    */}
    {discounted && !editing ? (
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {keepState === "done" ? (
          <span className="text-[11px] font-bold text-good">✓ {keepNote}</span>
        ) : keepState === "pin" ? (
          <>
            <input
              className="min-h-8 w-24 rounded-lg border border-warn/40 bg-white px-2 text-[12px] font-bold tnum"
              value={keepPin}
              onChange={(e) => setKeepPin(e.target.value)}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              placeholder="Owner PIN"
              aria-label={`Owner's PIN to set ${name} below its floor`}
            />
            <button
              type="button"
              onClick={() => keep(keepPin.trim())}
              disabled={!keepPin.trim()}
              className="rounded-full bg-warn px-3 py-1 text-[11px] font-bold text-white disabled:opacity-50"
            >
              Approve
            </button>
            {keepNote ? <span className="text-[11px] font-semibold text-warn">{keepNote}</span> : null}
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => keep()}
              disabled={keepState === "busy"}
              className="rounded-full bg-brand-soft px-3 py-1 text-[11px] font-bold text-brand-dark hover:bg-brand hover:text-white disabled:opacity-50"
            >
              {keepState === "busy" ? "Saving…" : "Keep as the new price"}
            </button>
            {keepNote ? <span className="text-[11px] font-semibold text-bad">{keepNote}</span> : null}
          </>
        )}
      </div>
    ) : null}
    </div>
  );
}


/**
 * A window in the middle of the screen.
 *
 * The size picker was a sheet rising from the bottom, and on the counter phone
 * the last row of it sat under the cart bar and the navigation — the 20 kg was
 * off the screen. A bottom sheet is right for the cart, which is a long list
 * read downwards; it is wrong for a short grid of choices, which wants to be
 * in the middle where the thumb and the eye already are.
 *
 * Centred, capped at 85% of the viewport, and it scrolls inside itself, so
 * nothing can be pushed off the bottom however many sizes a chemical has.
 */
function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div
      className="no-print fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-3"
      role="dialog"
      aria-modal="true"
    >
      {/* The backdrop closes it. A full-size button rather than a click handler
          on the div so a keyboard and a screen reader can both reach it. */}
      <button type="button" className="absolute inset-0" aria-label="Close" onClick={onClose} />

      <div className="relative flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-start gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-extrabold">{title}</h2>
            {subtitle ? <p className="text-[12px] text-muted">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto -mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg font-bold text-muted hover:bg-wash"
          >
            ✕
          </button>
        </div>

        {/* The only part that scrolls. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>

        {footer ? (
          <div className="border-t border-line bg-wash/60 px-4 py-3">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One tappable size.
 *
 * The whole design rests on this staying a plain button that adds one of the
 * thing. The counter's rhythm is tap-tap-tap — three jerricans is three taps on
 * the same square, exactly as it was before bundles existed — so a tap adds and
 * the window stays open. The badge is what makes that safe: it says how many
 * are already on the bill, so nobody has to count their own taps.
 */
function SizeChip({
  size,
  price,
  per,
  inCart,
  onPick,
}: {
  size: string;
  price: string;
  per?: string | null;
  inCart: number;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      /*
        Said properly for a screen reader.

        The badge sits in the corner visually but comes first in the reading
        order, so without this the chip announced itself as "times two, twenty
        kilogrammes, KES 8,800" — the count before the thing it counts. This
        says what the tap will do, then what is already on the bill.
      */
      aria-label={
        `Add ${size} for ${price}` + (inCart > 0 ? ` — ${inCart} already on the bill` : "")
      }
      className={`relative flex min-h-[4.5rem] flex-col items-start justify-center rounded-2xl px-3 py-2 text-left ring-1 ring-inset transition-colors ${
        inCart > 0
          ? "bg-brand text-white ring-brand"
          : "bg-brand-soft text-brand-deep ring-brand/25 hover:ring-brand/60"
      }`}
    >
      {inCart > 0 ? (
        <span
          className="absolute right-1.5 top-1.5 min-w-[1.25rem] rounded-full bg-white px-1 text-center text-[11px] font-extrabold text-brand-deep tnum"
          aria-label={`${inCart} on the bill`}
        >
          ×{inCart}
        </span>
      ) : null}
      <span className="text-[15px] font-extrabold">{size}</span>
      <span className={`mt-0.5 text-[14px] font-bold tnum ${inCart > 0 ? "" : "text-ink"}`}>
        {price}
      </span>
      {per ? (
        <span className={`text-[11px] tnum ${inCart > 0 ? "text-white/75" : "text-muted"}`}>
          {per}
        </span>
      ) : null}
    </button>
  );
}

/**
 * How much of it? — the window that opens when a tile with sizes is tapped.
 *
 * The basic unit is the FIRST chip, always, and it behaves exactly as the tile
 * did before any of this existed: one tap, one kilogram, the price goes up by
 * one kilogram's worth. The bundles sit beside it as further choices, each
 * adding one of itself at its own price. Nothing about the counter's habit
 * changes; there are simply more squares to tap.
 *
 * There is no box for an odd weight here. It was a second way to say the same
 * thing in a window whose whole job is one tap, and the cart line already has a
 * quantity box — 2.4 kg is a tap on "1 kg" and then the number typed on the
 * line, which is where every other quantity on the bill is edited.
 *
 * A dropdown on the tile was the other candidate and is worse three ways: it
 * doubles tile height so half as many items fit, most of the catalogue has no
 * bundles so the majority of tiles would carry an empty control, and a size on
 * the tile plus a quantity in the cart gives "20 kg" two meanings at two
 * prices.
 */
function SizePicker({
  item,
  lines,
  onLoose,
  onBundle,
  onClose,
}: {
  item: SellItem;
  /** This item's lines as they stand, for the badges and the running total. */
  lines: CartLine[];
  onLoose: (qtyMilli: number) => void;
  onBundle: (bundle: BundleChoice) => void;
  onClose: () => void;
}) {
  const list = listPrice(item);
  const weighed = item.basis === "unit";
  const step = stepMilli(item);

  const looseLine = lines.find((l) => l.bundleId === null);
  const countOf = (bundleId: number) =>
    lines.find((l) => l.bundleId === bundleId)?.units ?? 0;

  /*
    What the basic unit says on its chip.

    For a weighed chemical it is one kilogram at the per-kilogram price — the
    number already on the tile. For anything sold whole it is one of whatever
    the container is called.
  */
  const baseSize = weighed ? formatQty(step, item.unit) : `1 ${item.unitLabel}`;
  const baseInCart = weighed
    ? looseLine
      ? Math.round(looseLine.qtyMilli / step)
      : 0
    : (looseLine?.units ?? 0);

  const billCents = lines.reduce((sum, l) => sum + lineCents(item, l), 0);
  const onBill = lines
    .map((l) =>
      l.bundleId === null
        ? weighed
          ? formatQty(l.qtyMilli, item.unit)
          : `${l.units} × ${item.unitLabel}`
        : `${l.units} × ${formatQty(l.bundleSizeMilli, item.unit)}`,
    )
    .join(", ");

  return (
    <Modal title={item.name} subtitle={stockLabel(item)} onClose={onClose} footer={
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          {lines.length ? (
            <>
              <p className="truncate text-[12px] text-muted">{onBill}</p>
              <p className="text-[15px] font-extrabold tnum">{formatKes(billCents)}</p>
            </>
          ) : (
            <p className="text-[12px] text-muted">Tap a size to put it on the bill.</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex min-h-11 items-center rounded-xl bg-brand px-5 text-sm font-bold text-white xl:min-h-10"
        >
          Done
        </button>
      </div>
    }>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {/* The basic unit, first and always — this is the tile's old behaviour,
            kept where the hand already expects it. */}
        {list > 0 ? (
          <SizeChip
            size={baseSize}
            price={formatKes(list)}
            per={weighed ? `per ${item.unit}` : null}
            inCart={baseInCart}
            onPick={() => onLoose(step)}
          />
        ) : null}

        {item.bundles.map((b) => {
          const rate = b.sizeMilli > 0 ? Math.round((b.priceCents * 1000) / b.sizeMilli) : 0;
          return (
            <SizeChip
              key={b.id}
              size={formatQty(b.sizeMilli, item.unit)}
              price={formatKes(b.priceCents)}
              per={`${formatKes(rate)}/${item.unit}`}
              inCart={countOf(b.id)}
              onPick={() => onBundle(b)}
            />
          );
        })}
      </div>

    </Modal>
  );
}

/**
 * The same window for a mixed product.
 *
 * The difference is the bottom row. A chemical has a per-kilogram price, so its
 * first chip is one kilogram; a recipe does not — it is mixed to a size — so
 * the way to an odd quantity is the batch pricer the shop already had, which
 * bills the chemicals for a volume typed in.
 */
function RecipeSizePicker({
  recipe,
  lines,
  onBundle,
  onBatch,
  onClose,
}: {
  recipe: RecipeChoice;
  lines: CartLine[];
  onBundle: (bundle: BundleChoice) => void;
  onBatch: () => void;
  onClose: () => void;
}) {
  const countOf = (bundleId: number) =>
    lines.find((l) => l.bundleId === bundleId)?.units ?? 0;
  const billCents = lines.reduce((sum, l) => sum + l.priceCents * l.units, 0);
  const onBill = lines
    .map((l) => `${l.units} × ${formatQty(l.bundleSizeMilli, "L")}`)
    .join(", ");

  return (
    <Modal
      title={recipe.name}
      subtitle={`Mixed to order from ${recipe.ingredientCount} chemical${recipe.ingredientCount === 1 ? "" : "s"}`}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            {lines.length ? (
              <>
                <p className="truncate text-[12px] text-muted">{onBill}</p>
                <p className="text-[15px] font-extrabold tnum">{formatKes(billCents)}</p>
              </>
            ) : (
              <p className="text-[12px] text-muted">Tap a size to put it on the bill.</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-11 items-center rounded-xl bg-brand px-5 text-sm font-bold text-white xl:min-h-10"
          >
            Done
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {recipe.bundles.map((b) => (
          <SizeChip
            key={b.id}
            size={formatQty(b.sizeMilli, "L")}
            price={formatKes(b.priceCents)}
            per={`${formatKes(b.sizeMilli > 0 ? Math.round((b.priceCents * 1000) / b.sizeMilli) : 0)}/L`}
            inCart={countOf(b.id)}
            onPick={() => onBundle(b)}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={onBatch}
        className="mt-3 flex min-h-11 w-full items-center justify-center rounded-xl border border-line bg-white px-4 text-sm font-bold text-brand-dark hover:bg-wash xl:min-h-10"
      >
        Another quantity — price up a batch →
      </button>
    </Modal>
  );
}

function Sheet({
  title,
  onClose,
  action,
  children,
}: {
  title: string;
  onClose: () => void;
  /** Optional control beside Close — the cart's "Clear", and nothing else yet. */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="no-print fixed inset-0 z-40 flex flex-col bg-black/40" role="dialog" aria-modal="true">
      <button type="button" className="flex-1" aria-label="Close" onClick={onClose} />
      <div className="mx-auto max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-lg font-bold">{title}</h2>
          <div className="ml-auto flex items-center gap-2">
            {action}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-muted"
            >
              Close
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Empty the cart.
 *
 * It asks twice. On the desktop panel this button sits beside "Current sale"
 * under a mouse, but on a phone the cart is a sheet held in one hand with a
 * customer waiting, and a thumb that lands on "Clear" instead of "Close" throws
 * away a basket that has just been counted out loud. The second tap costs a
 * moment; rebuilding the sale costs the queue.
 *
 * The armed state resets on its own, so a Clear tapped by accident and then
 * left alone does nothing at all.
 */
function ClearCart({ onClear }: { onClear: () => void }) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <button
      type="button"
      onClick={() => {
        if (armed) {
          onClear();
          setArmed(false);
        } else {
          setArmed(true);
        }
      }}
      className={`shrink-0 whitespace-nowrap rounded-lg px-2 py-1.5 text-[11px] font-bold ${
        armed ? "bg-bad/10 text-bad" : "text-muted hover:bg-wash hover:text-bad"
      }`}
    >
      {armed ? "Tap again to empty" : "Clear"}
    </button>
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
