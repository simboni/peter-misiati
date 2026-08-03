"use client";

/**
 * The counter screen.
 *
 * Everything here is shaped by one number: four taps for an ordinary sale.
 *   tap the item  →  tap "Pay"  →  tap "Cash"  →  tap "Complete sale"
 * So there are no confirmation dialogs, no quantity prompt (tap again to add
 * another), and the payment amount defaults to whatever is still owing.
 *
 * Two things are deliberately NOT sent to this component:
 *   - `floor_cents`, because for a repacked chemical it is the cost price and
 *     staff must never see cost. A haggled price is offered to the server, the
 *     server refuses it, and only then is the owner's PIN asked for.
 *   - `cost_cents`, for the same reason.
 */

import Link from "next/link";
import { useActionState, useEffect, useMemo, useRef, useState, startTransition } from "react";
import type { PayMethod, Tier } from "@/lib/sales";
import { formatKes, formatUnits } from "@/lib/units";
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
    };

export const IDLE: SellState = { status: "idle" };

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

interface CartLine {
  itemId: number;
  units: number;
  priceCents: number;
}

interface Tender {
  key: string;
  method: PayMethod;
  amountCents: number;
  mpesaCode: string;
}

// ------------------------------------------------------------------- screen

export default function SellClient({
  items,
  topSellerIds,
  customers,
  action,
}: {
  items: SellItem[];
  topSellerIds: number[];
  customers: SellCustomer[];
  action: (prev: SellState, payload: SalePayload) => Promise<SellState>;
}) {
  const [tier, setTier] = useState<Tier>("retail");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [query, setQuery] = useState("");
  const [sheet, setSheet] = useState<"none" | "cart" | "pay">("none");

  const [tenders, setTenders] = useState<Tender[]>([]);
  const [amountInput, setAmountInput] = useState("");
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [ownerPin, setOwnerPin] = useState("");
  const [receipt, setReceipt] = useState<Extract<SellState, { status: "done" }> | null>(null);

  const uuid = useRef<string>(newUuid());
  const [state, submit, pending] = useActionState(action, IDLE);
  const handled = useRef<number>(0);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const lines = cart.map((l) => ({ line: l, item: byId.get(l.itemId)! })).filter((x) => x.item);
  const totalCents = lines.reduce((s, x) => s + x.line.priceCents * x.line.units, 0);
  const unitCount = cart.reduce((s, l) => s + l.units, 0);

  const tenderedCents = tenders.reduce((s, t) => s + t.amountCents, 0);
  const remainingCents = Math.max(0, totalCents - tenderedCents);
  const paidCents = tenders.filter((t) => t.method !== "credit").reduce((s, t) => s + t.amountCents, 0);
  const outstandingCents = totalCents - paidCents;

  const customer = customers.find((c) => c.id === customerId) ?? null;
  const mpesaIncomplete = tenders.some((t) => t.method === "mpesa" && !t.mpesaCode.trim());
  const needsCustomer = outstandingCents > 0 || tenders.some((t) => t.method === "credit");

  // --- after a completed sale, start clean --------------------------------
  // Resetting the tier is the point: a toggle left on wholesale silently
  // mis-prices every sale for the rest of the day.
  useEffect(() => {
    if (state.status !== "done" || handled.current === state.saleId) return;
    handled.current = state.saleId;
    setReceipt(state);
    setCart([]);
    setTenders([]);
    setAmountInput("");
    setCustomerId(null);
    setOwnerPin("");
    setTier("retail");
    setQuery("");
    setSheet("none");
    uuid.current = newUuid();
  }, [state]);

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

  // --- tenders ------------------------------------------------------------

  function addTender(method: PayMethod) {
    if (remainingCents <= 0 && !amountInput.trim()) return;
    const typed = parseCents(amountInput);
    const amountCents = typed ?? remainingCents;
    if (amountCents <= 0) return;

    setTenders((prev) => [
      ...prev,
      { key: `${method}-${Date.now()}-${prev.length}`, method, amountCents, mpesaCode: "" },
    ]);
    setAmountInput("");
  }

  function setCode(key: string, code: string) {
    setTenders((prev) => prev.map((t) => (t.key === key ? { ...t, mpesaCode: code } : t)));
  }

  function removeTender(key: string) {
    setTenders((prev) => prev.filter((t) => t.key !== key));
  }

  // --- submit -------------------------------------------------------------

  function complete(acknowledgeCredit = false) {
    const payload: SalePayload = {
      clientUuid: uuid.current,
      tier,
      lines: cart.map((l) => ({ itemId: l.itemId, units: l.units, unitPriceCents: l.priceCents })),
      tenders: tenders.map((t) => ({
        method: t.method,
        amountCents: t.amountCents,
        mpesaCode: t.method === "mpesa" ? t.mpesaCode.trim() : undefined,
      })),
      customerId,
      ownerPin: ownerPin.trim() || undefined,
      acknowledgeCredit,
    };
    startTransition(() => submit(payload));
  }

  // --- item lists ---------------------------------------------------------

  const q = query.trim().toLowerCase();
  const matches = q ? items.filter((i) => i.search.includes(q)) : [];
  const finished = items.filter((i) => i.kind === "finished");
  const packs = items.filter((i) => i.kind === "pack");
  const other = items.filter((i) => i.kind === "other");
  const top = topSellerIds.map((id) => byId.get(id)).filter((i): i is SellItem => Boolean(i));

  const wholesale = tier === "wholesale";

  return (
    <div className="pb-24">
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

      {receipt ? (
        <div className="mb-3">
          <Alert tone={receipt.outstandingCents > 0 ? "warn" : "good"}>
            Sale #{receipt.saleId} recorded — {formatKes(receipt.totalCents)}.{" "}
            {receipt.outstandingCents > 0
              ? `${formatKes(receipt.outstandingCents)} on credit.`
              : "Paid in full."}{" "}
            <Link href="/sales" className="font-bold underline">
              View
            </Link>
          </Alert>
        </div>
      ) : null}

      <input
        className={inputClass}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search — name, or chemical (sles, labsa…)"
        aria-label="Search items"
      />

      {q ? (
        <>
          <SectionLabel>{matches.length} match{matches.length === 1 ? "" : "es"}</SectionLabel>
          <Grid items={matches} tier={tier} onAdd={addItem} cart={cart} />
        </>
      ) : (
        <>
          {top.length ? (
            <>
              <SectionLabel>Top sellers today</SectionLabel>
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
                {top.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => addItem(item)}
                    className={`w-36 shrink-0 rounded-2xl border p-3 text-left ${
                      wholesale ? "border-warn/40 bg-warn-soft" : "border-brand/30 bg-brand-soft"
                    }`}
                  >
                    <div className="line-clamp-2 min-h-[2.4rem] text-[13px] font-bold leading-tight">
                      {item.name}
                    </div>
                    <div className={`mt-1 text-sm font-extrabold tnum ${wholesale ? "text-warn" : "text-brand"}`}>
                      {formatKes(listPrice(item, tier))}
                    </div>
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

      {/* Pay bar — sits above the tab bar, always one tap from payment. */}
      {cart.length ? (
        <div className="no-print fixed inset-x-0 bottom-[3.9rem] z-30 mx-auto max-w-lg px-3 pb-[env(safe-area-inset-bottom)]">
          <div className="flex items-stretch gap-2">
            <button
              type="button"
              onClick={() => setSheet("cart")}
              className="flex flex-col justify-center rounded-xl border border-line bg-white px-3 py-2 text-left shadow-lg"
            >
              <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
                {unitCount} item{unitCount === 1 ? "" : "s"}
              </span>
              <span className="text-xs font-bold text-brand">Edit cart</span>
            </button>
            <button
              type="button"
              onClick={() => setSheet("pay")}
              className={`flex-1 rounded-xl px-4 py-3 text-base font-extrabold text-white shadow-lg tnum ${
                wholesale ? "bg-warn" : "bg-brand"
              }`}
            >
              Pay {formatKes(totalCents)}
            </button>
          </div>
        </div>
      ) : null}

      {sheet === "cart" ? (
        <Sheet title="Cart" onClose={() => setSheet("none")}>
          <div className="space-y-2">
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
          <div className="rounded-2xl border border-line bg-wash p-3">
            <Row label="Order total" value={formatKes(totalCents)} strong />
            <Row label="Tendered" value={formatKes(tenderedCents)} />
            <Row
              label={remainingCents > 0 ? "Still to cover" : "Covered"}
              value={formatKes(remainingCents)}
              strong
            />
          </div>

          {tenders.length ? (
            <div className="mt-3 space-y-2">
              {tenders.map((t) => (
                <div key={t.key} className="rounded-xl border border-line p-2.5">
                  <div className="flex items-center gap-2">
                    <Chip tone={t.method === "credit" ? "warn" : "good"}>
                      {t.method === "mpesa" ? "M-Pesa" : t.method === "cash" ? "Cash" : "Credit"}
                    </Chip>
                    <span className="text-sm font-bold tnum">{formatKes(t.amountCents)}</span>
                    <button
                      type="button"
                      onClick={() => removeTender(t.key)}
                      className="ml-auto rounded-lg px-2 py-1 text-xs font-bold text-bad"
                    >
                      Remove
                    </button>
                  </div>
                  {t.method === "mpesa" ? (
                    <input
                      className={`${inputClass} mt-2 uppercase`}
                      value={t.mpesaCode}
                      onChange={(e) => setCode(t.key, e.target.value)}
                      placeholder="M-Pesa code, e.g. QGH7X1TEST"
                      aria-label="M-Pesa transaction code"
                      autoCapitalize="characters"
                      autoComplete="off"
                      required
                    />
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-3">
            <input
              className={inputClass}
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              inputMode="decimal"
              placeholder={`Amount — blank means all ${formatKes(remainingCents)}`}
              aria-label="Payment amount in shillings"
            />
            <div className="mt-2 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => addTender("cash")}
                className="rounded-xl bg-brand px-3 py-3.5 text-sm font-extrabold text-white"
              >
                Cash
              </button>
              <button
                type="button"
                onClick={() => addTender("mpesa")}
                className="rounded-xl bg-brand px-3 py-3.5 text-sm font-extrabold text-white"
              >
                M-Pesa
              </button>
              <button
                type="button"
                onClick={() => addTender("credit")}
                className="rounded-xl bg-warn px-3 py-3.5 text-sm font-extrabold text-white"
              >
                Credit
              </button>
            </div>
          </div>

          {needsCustomer || customers.length ? (
            <div className="mt-3">
              <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
                Customer {needsCustomer ? "(required — this sale is not fully paid)" : "(optional)"}
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

          {outstandingCents > 0 && customer ? (
            <p className="mt-3 text-xs text-muted">
              {formatKes(outstandingCents)} goes onto {customer.name}&apos;s account. They already owe{" "}
              {formatKes(customer.outstandingCents)}.
            </p>
          ) : null}

          <Button
            className="mt-4 w-full text-base"
            disabled={
              pending ||
              !cart.length ||
              mpesaIncomplete ||
              (needsCustomer && !customerId) ||
              (state.status === "pin" && !ownerPin.trim())
            }
            onClick={() => complete(state.status === "credit")}
          >
            {pending
              ? "Recording…"
              : state.status === "credit"
                ? "Sell on credit anyway"
                : outstandingCents > 0
                  ? `Complete — ${formatKes(outstandingCents)} on credit`
                  : `Complete sale — ${formatKes(totalCents)}`}
          </Button>

          {mpesaIncomplete ? (
            <p className="mt-2 text-xs font-semibold text-bad">
              Type the M-Pesa code before completing.
            </p>
          ) : null}
          {needsCustomer && !customerId ? (
            <p className="mt-2 text-xs font-semibold text-bad">
              Choose the customer who owes the balance.
            </p>
          ) : null}
        </Sheet>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------- parts

function Grid({
  items,
  tier,
  onAdd,
  cart,
}: {
  items: SellItem[];
  tier: Tier;
  onAdd: (item: SellItem) => void;
  cart: CartLine[];
}) {
  if (!items.length) {
    return <p className="py-6 text-center text-sm text-muted">Nothing here.</p>;
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((item) => {
        const inCart = cart.find((l) => l.itemId === item.id);
        const out = item.qtyMilli <= 0;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onAdd(item)}
            className={`relative rounded-2xl border p-3 text-left transition-colors ${
              inCart ? "border-brand bg-brand-soft" : "border-line bg-white"
            }`}
          >
            {inCart ? (
              <span className="absolute right-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-brand px-1.5 text-xs font-extrabold text-white tnum">
                {inCart.units}
              </span>
            ) : null}
            <div className="line-clamp-2 min-h-[2.4rem] pr-6 text-[13px] font-bold leading-tight">
              {item.name}
            </div>
            <div
              className={`mt-1 text-base font-extrabold tnum ${
                tier === "wholesale" ? "text-warn" : "text-ink"
              }`}
            >
              {formatKes(listPrice(item, tier))}
            </div>
            <div className={`mt-0.5 text-[11px] tnum ${out ? "font-bold text-bad" : "text-muted"}`}>
              {out ? "Out of stock" : formatUnits(item.qtyMilli, item.sizeMilli, item.unitLabel)}
            </div>
          </button>
        );
      })}
    </div>
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

  return (
    <div className="rounded-xl border border-line p-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold leading-tight">{item.name}</div>
          {editing ? (
            <div className="mt-1.5 flex items-center gap-2">
              <input
                className={inputClass}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                inputMode="decimal"
                autoFocus
                aria-label={`Price for ${item.name}`}
              />
              <Button variant="ghost" className="shrink-0 px-3 py-2" onClick={commit}>
                Set
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraft(centsToInput(line.priceCents));
                setEditing(true);
              }}
              className="mt-0.5 text-xs font-semibold text-brand"
            >
              {formatKes(line.priceCents)} each
              {discounted ? (
                <span className="ml-1.5 text-muted line-through">{formatKes(list)}</span>
              ) : null}
              <span className="ml-1 text-muted">· tap to change</span>
            </button>
          )}
        </div>
        <div className="text-right text-sm font-extrabold tnum">
          {formatKes(line.priceCents * line.units)}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onUnits(-1)}
          aria-label={`One less ${item.name}`}
          className="h-10 w-12 rounded-lg border border-line text-lg font-extrabold"
        >
          −
        </button>
        <span className="min-w-10 text-center text-base font-extrabold tnum">{line.units}</span>
        <button
          type="button"
          onClick={() => onUnits(1)}
          aria-label={`One more ${item.name}`}
          className="h-10 w-12 rounded-lg border border-line text-lg font-extrabold"
        >
          +
        </button>
        <span className="ml-auto text-[11px] text-muted">{item.unitLabel}</span>
      </div>
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
