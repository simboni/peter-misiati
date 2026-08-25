import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, requireUser } from "@/lib/auth";
import { all, get, run } from "@/lib/db";
import {
  getQuote,
  quoteLines,
  listQuotes,
  saveQuote,
  invoiceQuote,
  invoiceDirect,
} from "@/lib/quotes";
import { PageTitle } from "@/components/ui";
import Builder, { type SaveResult } from "./builder";

export const dynamic = "force-dynamic";

/**
 * Raise a quote, or raise an invoice — the same screen, told which by `mode`.
 *
 * `from` pre-fills it from an approved quote, which is how converting works:
 * the lines arrive already agreed and stay editable, because the price on
 * collection day is not always the price on approval day.
 */
export default async function NewWholesalePage(props: {
  searchParams: Promise<{ mode?: string; from?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const { mode: modeParam, from } = await props.searchParams;
  const mode = modeParam === "invoice" ? "invoice" : "quote";
  const fromQuoteId = from ? Number(from) : null;

  // Chemicals and containers in one list: on a document the person already
  // knows what they want, so making them choose a board first is a question
  // with no purpose. Whether a thing is priced by the kilogram rides along as
  // a label, because that decides what the quantity box is asking for.
  const items = all<{
    id: number;
    name: string;
    kind: string;
    price_basis: "pack" | "unit";
    canonical_unit: "kg" | "L" | "pcs";
    wholesale_cents: number;
    retail_cents: number;
  }>(
    `SELECT id, name, kind, price_basis, canonical_unit, wholesale_cents, retail_cents
       FROM items
      WHERE active = 1 AND sellable = 1 AND (retail_cents > 0 OR wholesale_cents > 0)
      ORDER BY CASE kind WHEN 'bulk' THEN 0 ELSE 1 END, name`,
  ).map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    basis: r.price_basis === "unit" ? ("unit" as const) : ("pack" as const),
    canonicalUnit: r.canonical_unit,
    wholesaleCents: r.wholesale_cents,
    retailCents: r.retail_cents,
  }));

  const customers = all<{ id: number; name: string; phone: string; kind: string }>(
    `SELECT id, name, phone, kind FROM customers WHERE active = 1 ORDER BY kind DESC, name`,
  );

  // Only approved quotes are offered: an invoice built on one the customer has
  // not accepted is a bill for a price nobody agreed.
  const approved = listQuotes("approved", 40).map((q) => ({
    id: q.id,
    quoteNo: q.quote_no,
    customerName: q.customer_name || "Unnamed",
    totalCents: q.total_cents,
    lineCount: q.line_count,
  }));

  /*
   * A fortnight, unless somebody says otherwise.
   *
   * An empty expiry means the price holds for ever, which in a trade where the
   * drum moves with the shilling is the expensive field to leave blank. Two
   * weeks is long enough for a customer to think and short enough to protect
   * the margin; it is a starting point, and it is editable.
   */
  const twoWeeks = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);

  const source = fromQuoteId ? getQuote(fromQuoteId) : undefined;
  const sourceLines = source ? quoteLines(source.id) : [];

  /**
   * What a draft line comes to, before anything is written.
   *
   * Only ever used to decide two things — whether this bill is going to leave
   * money on account, and how much "the whole bill on credit" means. The money
   * that is actually charged is worked out from the items themselves, inside
   * `recordSale`, which is the only place allowed to price anything.
   *
   * A line carries either a quantity of substance or a count of containers, and
   * `qtyMilli` is set only for the first; that is what tells them apart here.
   */
  function draftCents(l: { units: number; unitPriceCents: number; qtyMilli: number }): number {
    return l.qtyMilli > 0
      ? Math.round((l.unitPriceCents * l.qtyMilli) / 1000)
      : l.units * l.unitPriceCents;
  }

  async function save(payload: {
    mode: "quote" | "invoice";
    fromQuoteId: number | null;
    customerId: number | null;
    customerName: string;
    note: string;
    validUntil: string;
    lines: Array<{ itemId: number; units: number; unitPriceCents: number; qtyMilli: number }>;
    paidCents: number;
    payMethod: "cash" | "mpesa";
    mpesaCode: string;
    clientUuid: string;
  }): Promise<SaveResult> {
    "use server";
    try {
      const me = await requireUser();

      if (payload.mode === "quote") {
        const { quoteId } = saveQuote({
          quoteId: payload.fromQuoteId ?? undefined,
          customerId: payload.customerId,
          customerName: payload.customerName,
          note: payload.note,
          validUntil: payload.validUntil,
          lines: payload.lines,
          userId: me.id,
        });
        return { quoteId };
      }

      /*
       * Debt needs a debtor.
       *
       * A quote is often raised for a name that is not on the books yet — that
       * is the normal order of events, since the shop meets the customer before
       * it decides to give them terms. Left alone, that dead-ends at the last
       * step: the customer approves, the goods are ready, and the invoice
       * refuses because credit has nobody to sit against.
       *
       * So when a bill is about to leave money on account and the only thing
       * missing is the record, the record is written. They start on a zero
       * credit limit, which is the app's existing way of saying "the owner has
       * not agreed terms with this one yet" — nothing is waved through, the
       * sale simply stops being impossible.
       */
      let customerId = payload.customerId;
      const provisionalTotal = payload.lines.reduce((s, l) => s + draftCents(l), 0);
      if (customerId === null && payload.paidCents < provisionalTotal && payload.customerName.trim()) {
        const existing = get<{ id: number }>(
          `SELECT id FROM customers WHERE lower(name) = lower(?) AND active = 1`,
          payload.customerName.trim(),
        );
        customerId =
          existing?.id ??
          Number(
            run(
              `INSERT INTO customers (name, kind, credit_limit_cents) VALUES (?, 'wholesale', 0)`,
              payload.customerName.trim(),
            ).lastInsertRowid,
          );
      }

      const total = payload.lines.reduce((s, l) => s + draftCents(l), 0);
      const tenders: Array<{ method: "cash" | "mpesa" | "credit"; amountCents: number; ref?: string | null }> = [];
      if (payload.paidCents > 0) {
        tenders.push({
          method: payload.payMethod,
          amountCents: Math.min(payload.paidCents, total),
          ref: payload.payMethod === "mpesa" ? payload.mpesaCode || null : null,
        });
      }
      const owing = total - Math.min(payload.paidCents, total);
      if (owing > 0) tenders.push({ method: "credit", amountCents: owing });

      // Converting keeps the thread back to the quote; a blank invoice has none.
      const res = payload.fromQuoteId
        ? invoiceQuote({
            quoteId: payload.fromQuoteId,
            customerId,
            userId: me.id,
            clientUuid: payload.clientUuid,
            tenders,
            lines: payload.lines,
          })
        : invoiceDirect({
            customerId,
            customerName: payload.customerName,
            note: payload.note,
            lines: payload.lines,
            tenders,
            userId: me.id,
            clientUuid: payload.clientUuid,
          });

      return { saleId: res.saleId };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Could not save." };
    }
  }

  return (
    <div>
      <Link
        href="/wholesale"
        className="mb-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-brand hover:underline xl:min-h-9"
      >
        <span aria-hidden>←</span> Wholesale
      </Link>

      <PageTitle
        title={mode === "quote" ? (source ? `Edit ${source.quote_no}` : "New quote") : "New invoice"}
        subtitle={
          mode === "quote"
            ? "A price in writing. Nothing moves until it is accepted."
            : source
              ? `From ${source.quote_no} — prices stay editable`
              : "Bill a customer directly, or start from an approved quote"
        }
      />

      <Builder
        mode={mode}
        items={items}
        customers={customers}
        quotes={approved}
        initial={{
          fromQuoteId: source ? source.id : null,
          customerId: source?.customer_id ?? null,
          customerName: source?.customer_name ?? "",
          note: source?.note ?? "",
          validUntil: source?.valid_until || (mode === "quote" ? twoWeeks : ""),
          lines: sourceLines.map((l) => ({
            itemId: l.item_id,
            units: l.units,
            unitPriceCents: l.unit_price_cents,
            qtyMilli: l.qty_milli,
          })),
        }}
        onSave={save}
      />
    </div>
  );
}
