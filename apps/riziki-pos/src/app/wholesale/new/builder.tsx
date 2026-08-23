"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, SectionLabel, inputClass } from "@/components/ui";
import { formatKes } from "@/lib/units";

export interface PickItem {
  id: number;
  name: string;
  wholesaleCents: number;
  retailCents: number;
}
export interface PickCustomer {
  id: number;
  name: string;
  phone: string;
  kind: string;
}
export interface QuoteChoice {
  id: number;
  quoteNo: string;
  customerName: string;
  totalCents: number;
  lineCount: number;
}
export interface DraftLine {
  itemId: number;
  units: number;
  unitPriceCents: number;
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
    initial.lines.length ? initial.lines : [{ itemId: 0, units: 1, unitPriceCents: 0 }],
  );
  const [paid, setPaid] = useState("");
  const [payMethod, setPayMethod] = useState<"cash" | "mpesa">("cash");
  const [mpesaCode, setMpesaCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = lines.reduce((s, l) => s + l.units * l.unitPriceCents, 0);
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
    const clean = lines.filter((l) => l.itemId > 0 && l.units > 0);
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
      else if (res.quoteId) router.push(`/wholesale/${res.quoteId}`);
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
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
              Customer on the books
            </span>
            <select
              className={inputClass}
              value={customerId ?? ""}
              onChange={(e) => {
                const id = e.target.value ? Number(e.target.value) : null;
                setCustomerId(id);
                const c = customers.find((x) => x.id === id);
                if (c) setCustomerName(c.name);
              }}
            >
              <option value="">Not on the books yet</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.kind === "wholesale" ? " (wholesale)" : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
              Name on the document
            </span>
            <input
              className={inputClass}
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Mama Njeri Hardware"
            />
          </label>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="block">
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
                <label className="col-span-12 md:col-span-6">
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-muted md:hidden">
                    Item
                  </span>
                  <select
                    className={inputClass}
                    value={l.itemId || ""}
                    onChange={(e) => chooseItem(i, Number(e.target.value))}
                    aria-label={`Item on line ${i + 1}`}
                  >
                    <option value="">Choose an item…</option>
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="col-span-3 md:col-span-2">
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                    Units
                  </span>
                  <input
                    className={`${inputClass} tnum`}
                    inputMode="numeric"
                    value={l.units}
                    onChange={(e) => setLine(i, { units: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })}
                    aria-label={`Units on line ${i + 1}`}
                  />
                </label>

                <label className="col-span-5 md:col-span-3">
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                    Price each
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
          onClick={() => setLines((prev) => [...prev, { itemId: 0, units: 1, unitPriceCents: 0 }])}
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
            <div className="grid gap-3 md:grid-cols-3">
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
