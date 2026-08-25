"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, SectionLabel, inputClass } from "@/components/ui";
import { formatKes } from "@/lib/units";
import ItemPicker, { type PickItem } from "./item-picker";
import CustomerPicker, { type PickCustomer } from "./customer-picker";

export type { PickItem };
export type { PickCustomer };
export interface QuoteChoice {
  id: number;
  quoteNo: string;
  customerName: string;
  totalCents: number;
  lineCount: number;
}
export interface DraftLine {
  itemId: number;
  /** Whole containers. Ignored once the item is priced per kilogram. */
  units: number;
  /** Per container, or per kg / L. */
  unitPriceCents: number;
  /** How much substance, in milli, for an item priced per kilogram. */
  qtyMilli: number;
}

/** What one draft line comes to. Matches `quoteLineCents` on the server. */
function draftCents(item: PickItem | undefined, l: DraftLine): number {
  if (item?.basis === "unit") return Math.round((l.unitPriceCents * l.qtyMilli) / 1000);
  return l.units * l.unitPriceCents;
}

export type SaveResult = { error?: string; quoteId?: number; saleId?: number };

/**
 * One builder, three ways in.
 *
 * Raising a quote, billing a regular customer with no quote, and turning an
 * approved quote into an invoice are the same act — name the buyer, agree the
 * lines, commit — differing only in what happens at the end and whether the
 * lines start empty. Three screens would have meant three places for the price
 * arithmetic to drift apart, so there is one, and `mode` decides the ending.
 *
 * Prices are editable in every mode, including when converting: a customer who
 * approved on Monday and collects on Thursday may be billed at a figure agreed
 * in between, and the alternative — voiding the quote and raising another —
 * loses the thread that connects the two.
 */
export default function Builder({
  mode,
  items,
  customers,
  quotes,
  initial,
  onSave,
}: {
  mode: "quote" | "invoice";
  items: PickItem[];
  customers: PickCustomer[];
  quotes: QuoteChoice[];
  initial: {
    fromQuoteId: number | null;
    customerId: number | null;
    customerName: string;
    note: string;
    validUntil: string;
    lines: DraftLine[];
  };
  onSave: (payload: {
    mode: "quote" | "invoice";
    fromQuoteId: number | null;
    customerId: number | null;
    customerName: string;
    note: string;
    validUntil: string;
    lines: DraftLine[];
    paidCents: number;
    payMethod: "cash" | "mpesa";
    mpesaCode: string;
    clientUuid: string;
  }) => Promise<SaveResult>;
}) {
  const router = useRouter();
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const [fromQuoteId, setFromQuoteId] = useState<number | null>(initial.fromQuoteId);
  const [customerId, setCustomerId] = useState<number | null>(initial.customerId);
  const [customerName, setCustomerName] = useState(initial.customerName);
  const [note, setNote] = useState(initial.note);
  const [validUntil, setValidUntil] = useState(initial.validUntil);
  const [lines, setLines] = useState<DraftLine[]>(
    initial.lines.length ? initial.lines : [{ itemId: 0, units: 1, unitPriceCents: 0, qtyMilli: 1000 }],
  );
  const [paid, setPaid] = useState("");
  const [payMethod, setPayMethod] = useState<"cash" | "mpesa">("cash");
  const [mpesaCode, setMpesaCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = lines.reduce((s, l) => s + draftCents(byId.get(l.itemId), l), 0);
  const paidCents = Math.max(0, Math.round(Number(paid || 0) * 100));
  const onCredit = Math.max(0, total - paidCents);

  function setLine(i: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  }

  /** Choosing an item seeds its wholesale price — the starting point of the
   *  argument, not the end of it. */
  function chooseItem(i: number, itemId: number) {
    const item = byId.get(itemId);
    setLine(i, {
      itemId,
      unitPriceCents: item ? (item.wholesaleCents > 0 ? item.wholesaleCents : item.retailCents) : 0,
    });
  }

  async function pullFromQuote(id: number | null) {
    setFromQuoteId(id);
    if (id === null) return;
    // A full page load rather than a fetch: the server already knows how to
    // assemble a quote into this form, and doing it twice is how the two
    // versions start to differ.
    router.push(`/wholesale/new?mode=invoice&from=${id}`);
  }

  async function submit() {
    setError(null);
    /*
      One shape leaves this form, whatever the boxes looked like.

      `qtyMilli` is zeroed for anything sold whole and `units` for anything sold
      by the kilogram, so nothing downstream has to guess which number to read.
      A line carrying both would be a line the server could price two ways.
    */
    const clean = lines
      .map((l) => {
        const weighed = byId.get(l.itemId)?.basis === "unit";
        return {
          ...l,
          units: weighed ? 1 : l.units,
          qtyMilli: weighed ? l.qtyMilli : 0,
        };
      })
      .filter((l) => l.itemId > 0 && (l.qtyMilli > 0 || l.units > 0));
    if (!clean.length) return setError("Add at least one line.");
    if (!customerName.trim() && customerId === null) return setError("Say who this is for.");

    setBusy(true);
    try {
      const res = await onSave({
        mode,
        fromQuoteId,
        customerId,
        customerName,
        note,
        validUntil,
        lines: clean,
        paidCents,
        payMethod,
        mpesaCode: mpesaCode.trim(),
        clientUuid: crypto.randomUUID(),
      });
      if (res.error) setError(res.error);
      else if (res.saleId) router.push(`/invoice/${res.saleId}`);
      else if (res.quoteId) router.push(`/wholesale/quotes/${res.quoteId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 2xl:max-w-6xl">
      {error ? <Alert tone="bad">{error}</Alert> : null}

      {mode === "invoice" && quotes.length ? (
        <Card>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
              Start from an approved quote
            </span>
            <select
              className={inputClass}
              value={fromQuoteId ?? ""}
              onChange={(e) => pullFromQuote(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Blank invoice — no quote</option>
              {quotes.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.quoteNo} · {q.customerName} · {formatKes(q.totalCents)} ({q.lineCount} lines)
                </option>
              ))}
            </select>
          </label>
        </Card>
      ) : null}

      <Card>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_13rem]">
          <div>
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
              Who is this for
            </span>
            <CustomerPicker
              customers={customers}
              customerId={customerId}
              customerName={customerName}
              onPick={(id, name) => {
                setCustomerId(id);
                setCustomerName(name);
              }}
            />
          </div>

          {mode === "quote" ? (
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                Price holds until
              </span>
              <input
                className={inputClass}
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            </label>
          ) : null}
        </div>

        {/* A note and an expiry date are worth having and are almost never
            needed, which is exactly what a disclosure is for. Naming the
            customer and listing the goods is the whole job; everything else
            waits to be asked for. */}
        <details className="mt-2.5">
          <summary className="cursor-pointer py-1 text-[12px] font-bold text-muted">
            Add a note
          </summary>
          <label className="mt-2 block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
              Note (prints on the document)
            </span>
            <input
              className={inputClass}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Collecting Friday"
            />
          </label>
        </details>
      </Card>

      <SectionLabel>Lines</SectionLabel>
      <Card>
        <div className="space-y-2">
          {lines.map((l, i) => {
            const item = byId.get(l.itemId);
            const list = item ? (item.wholesaleCents > 0 ? item.wholesaleCents : item.retailCents) : 0;
            const cut = item && l.unitPriceCents < list;
            return (
              <div key={i} className="grid grid-cols-12 items-end gap-2">
                <div className="col-span-12 md:col-span-6">
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-muted md:hidden">
                    Item
                  </span>
                  <ItemPicker
                    items={items}
                    value={l.itemId}
                    onChange={(id) => chooseItem(i, id)}
                    label={`Item on line ${i + 1}`}
                  />
                </div>

                {/* One box, two questions. A chemical is quoted as a quantity —
                    "400 kg of caustic" — and a container as a count. Asking for
                    "units" of something sold by the kilogram was how a
                    four-hundred-kilo order became a multiplication done on
                    paper and typed back in as a discount. */}
                <label className="col-span-3 md:col-span-2">
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                    {item?.basis === "unit" ? item.canonicalUnit : "Units"}
                  </span>
                  <input
                    className={`${inputClass} tnum`}
                    inputMode={item?.basis === "unit" ? "decimal" : "numeric"}
                    value={
                      item?.basis === "unit"
                        ? String(Number((l.qtyMilli / 1000).toFixed(3)))
                        : l.units
                    }
                    onChange={(e) =>
                      setLine(
                        i,
                        item?.basis === "unit"
                          ? { qtyMilli: Math.max(0, Math.round(Number(e.target.value) * 1000 || 0)) }
                          : { units: Math.max(0, Math.trunc(Number(e.target.value) || 0)) },
                      )
                    }
                    aria-label={
                      item?.basis === "unit"
                        ? `How much on line ${i + 1}, in ${item.canonicalUnit}`
                        : `Units on line ${i + 1}`
                    }
                  />
                </label>

                <label className="col-span-5 md:col-span-3">
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                    {item?.basis === "unit" ? `Price per ${item.canonicalUnit}` : "Price each"}
                  </span>
                  <input
                    className={`${inputClass} tnum ${cut ? "text-warn" : ""}`}
                    inputMode="decimal"
                    value={l.unitPriceCents ? (l.unitPriceCents / 100).toString() : ""}
                    onChange={(e) =>
                      setLine(i, { unitPriceCents: Math.max(0, Math.round(Number(e.target.value || 0) * 100)) })
                    }
                    aria-label={`Price on line ${i + 1}`}
                  />
                </label>

                <div className="col-span-4 md:col-span-1 md:pb-2.5">
                  <button
                    type="button"
                    onClick={() => setLines((prev) => prev.filter((_, k) => k !== i))}
                    className="flex min-h-11 w-full items-center justify-center rounded-xl text-xs font-bold text-muted hover:bg-wash hover:text-bad xl:min-h-9"
                    aria-label={`Remove line ${i + 1}`}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() =>
            setLines((prev) => [...prev, { itemId: 0, units: 1, unitPriceCents: 0, qtyMilli: 1000 }])
          }
          className="mt-3 flex min-h-11 items-center rounded-xl px-3 text-sm font-bold text-brand hover:bg-wash xl:min-h-9"
        >
          + Another line
        </button>

        <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
          <span className="text-sm font-bold text-muted">Total</span>
          <span className="text-2xl font-extrabold text-brand-deep tnum">{formatKes(total)}</span>
        </div>
      </Card>

      {mode === "invoice" ? (
        <>
          <SectionLabel>Payment</SectionLabel>
          <Card>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                  Paid now (KES)
                </span>
                <input
                  className={`${inputClass} tnum`}
                  inputMode="decimal"
                  value={paid}
                  onChange={(e) => setPaid(e.target.value)}
                  placeholder="0"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                  How
                </span>
                <select
                  className={inputClass}
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value as "cash" | "mpesa")}
                >
                  <option value="cash">Cash</option>
                  <option value="mpesa">M-Pesa</option>
                </select>
              </label>
              {payMethod === "mpesa" ? (
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                    M-Pesa code
                  </span>
                  <input
                    className={inputClass}
                    value={mpesaCode}
                    onChange={(e) => setMpesaCode(e.target.value.toUpperCase())}
                    placeholder="SLJ7XK2P1Q"
                  />
                </label>
              ) : null}
            </div>

            {onCredit > 0 ? (
              <div className="mt-3 rounded-xl bg-warn-soft px-3 py-2 text-sm font-bold text-warn">
                {formatKes(onCredit)} goes on account
                {customerId === null ? " — which needs a customer on the books." : "."}
              </div>
            ) : (
              <div className="mt-3 rounded-xl bg-good-soft px-3 py-2 text-sm font-bold text-good">
                Paid in full.
              </div>
            )}
          </Card>
        </>
      ) : null}

      <Button className="w-full" disabled={busy} onClick={submit}>
        {busy
          ? "Saving…"
          : mode === "quote"
            ? `Save quote — ${formatKes(total)}`
            : `Create invoice — ${formatKes(total)}`}
      </Button>
    </div>
  );
}
