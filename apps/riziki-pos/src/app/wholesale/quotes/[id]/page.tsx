import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser, requireUser } from "@/lib/auth";
import { get } from "@/lib/db";
import { getQuote, quoteLines, setQuoteStatus } from "@/lib/quotes";
import { formatKes, formatDateTime } from "@/lib/units";
import { Alert, Card, PageTitle, SectionLabel } from "@/components/ui";
import ShareRow from "./share-row";

export const dynamic = "force-dynamic";

export default async function QuotePage(props: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const { id } = await props.params;
  const quote = getQuote(Number(id));
  if (!quote) notFound();

  const lines = quoteLines(quote.id);
  const shop = get<{ value: string }>(`SELECT value FROM settings WHERE key = 'business.name'`);
  const phone = quote.customer_id
    ? (get<{ phone: string }>(`SELECT phone FROM customers WHERE id = ?`, quote.customer_id)?.phone ?? "")
    : "";

  async function move(status: "sent" | "approved" | "declined" | "draft") {
    "use server";
    const me = await requireUser();
    setQuoteStatus(Number(id), status, me.id);
    redirect(`/wholesale/quotes/${id}`);
  }

  const sent = move.bind(null, "sent");
  const approve = move.bind(null, "approved");
  const decline = move.bind(null, "declined");

  const shopName = shop?.value || "Riziki Industrial Chemicals";
  // The message that goes out on WhatsApp. Written to be read on a phone by
  // somebody who is not looking at the app: the number, the lines, the total,
  // and what to say back.
  const message =
    `*${shopName}*\nQuotation ${quote.quote_no}\n` +
    (quote.customer_name ? `For: ${quote.customer_name}\n` : "") +
    `\n` +
    lines
      .map((l) => `${l.units} x ${l.item_name} @ ${formatKes(l.unit_price_cents)} = ${formatKes(l.units * l.unit_price_cents)}`)
      .join("\n") +
    `\n\n*Total: ${formatKes(quote.total_cents)}*` +
    (quote.valid_until ? `\nPrice holds until ${quote.valid_until}` : "") +
    (quote.note ? `\n\n${quote.note}` : "") +
    `\n\nReply YES to accept and we will raise the invoice.`;

  return (
    <div>
      <Link
        href="/wholesale/quotes"
        className="mb-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-brand hover:underline xl:min-h-9"
      >
        <span aria-hidden>←</span> Wholesale
      </Link>

      <PageTitle
        title={quote.quote_no}
        subtitle={`${quote.customer_name || "Unnamed customer"} · raised ${formatDateTime(quote.created_at)}`}
      />

      {quote.status === "invoiced" && quote.sale_id ? (
        <div className="mb-3">
          <Alert tone="good">
            Invoiced.{" "}
            <Link href={`/invoice/${quote.sale_id}`} className="font-bold underline">
              Open invoice
            </Link>
          </Alert>
        </div>
      ) : null}
      {quote.status === "declined" ? (
        <div className="mb-3">
          <Alert tone="bad">The customer declined this quote.</Alert>
        </div>
      ) : null}

      <Card>
        <div className="divide-y divide-line">
          {lines.map((l) => {
            const list = l.wholesale_cents > 0 ? l.wholesale_cents : l.retail_cents;
            const cut = list > 0 && l.unit_price_cents < list;
            return (
              <div key={l.id} className="flex items-baseline gap-2 py-2">
                <span className="min-w-0 flex-1 truncate text-sm font-bold">{l.item_name}</span>
                <span className="shrink-0 text-[12px] text-muted tnum">
                  {l.units} × {formatKes(l.unit_price_cents)}
                  {cut ? <span className="ml-1 text-warn">↓</span> : null}
                </span>
                <span className="w-28 shrink-0 text-right text-sm font-bold tnum">
                  {formatKes(l.units * l.unit_price_cents)}
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex items-baseline justify-between border-t border-line pt-3">
          <span className="text-sm font-bold text-muted">Total</span>
          <span className="text-2xl font-extrabold text-brand-deep tnum">
            {formatKes(quote.total_cents)}
          </span>
        </div>
        {quote.note ? <p className="mt-2 text-sm text-muted">{quote.note}</p> : null}
        {quote.valid_until ? (
          <p className="mt-1 text-[12px] font-semibold text-muted">
            Price holds until {quote.valid_until}
          </p>
        ) : null}
      </Card>

      <SectionLabel>Send it</SectionLabel>
      <ShareRow
        phone={phone}
        message={message}
        subject={`Quotation ${quote.quote_no} — ${shopName}`}
        printHref={`/wholesale/quotes/${quote.id}/print`}
      />

      {quote.status !== "invoiced" ? (
        <>
          <SectionLabel>Where it stands</SectionLabel>
          <Card>
            <div className="flex flex-wrap gap-2">
              {quote.status === "draft" ? (
                <form action={sent}>
                  <button className="flex min-h-11 items-center rounded-xl bg-white px-4 text-sm font-bold text-brand-dark ring-1 ring-inset ring-line xl:min-h-10">
                    Mark as sent
                  </button>
                </form>
              ) : null}

              {quote.status !== "approved" && quote.status !== "declined" ? (
                <form action={approve}>
                  <button className="flex min-h-11 items-center rounded-xl bg-good px-4 text-sm font-bold text-white xl:min-h-10">
                    Customer approved
                  </button>
                </form>
              ) : null}

              {quote.status === "approved" ? (
                <Link
                  href={`/wholesale/invoices/new?from=${quote.id}`}
                  className="flex min-h-11 items-center rounded-xl bg-brand px-4 text-sm font-bold text-white shadow-sm xl:min-h-10"
                >
                  Convert to invoice →
                </Link>
              ) : null}

              <Link
                href={`/wholesale/quotes/new?from=${quote.id}`}
                className="flex min-h-11 items-center rounded-xl px-4 text-sm font-bold text-muted hover:bg-wash xl:min-h-10"
              >
                Edit lines
              </Link>

              {quote.status !== "declined" ? (
                <form action={decline}>
                  <button className="flex min-h-11 items-center rounded-xl px-4 text-sm font-bold text-muted hover:bg-wash hover:text-bad xl:min-h-10">
                    Customer declined
                  </button>
                </form>
              ) : null}
            </div>
            {quote.status === "approved" ? (
              <p className="mt-2.5 text-[12px] text-muted">
                Converting opens the lines again — bill what was finally agreed, not what was
                quoted, if the two have drifted apart.
              </p>
            ) : null}
          </Card>
        </>
      ) : null}
    </div>
  );
}
