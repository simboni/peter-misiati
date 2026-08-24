import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import {
  wholesaleInvoices,
  wholesaleInvoiceTotals,
  type InvoiceState,
} from "@/lib/wholesale-lists";
import { ageDays } from "@/lib/credit";
import { formatKes, formatKesRounded, formatDate } from "@/lib/units";
import { Card, Empty, PageTitle, Stat } from "@/components/ui";
import { WholesaleNav, NewBanner, BackLink, ListToolbar, Pager } from "@/components/wholesale-nav";

export const dynamic = "force-dynamic";

const STATES: Array<{ key: InvoiceState; label: string }> = [
  { key: "all", label: "All" },
  { key: "owing", label: "Owing" },
  { key: "paid", label: "Paid" },
  { key: "voided", label: "Voided" },
];

/**
 * Every wholesale bill, as a list rather than a wall of cards.
 *
 * A card grid reads well at a dozen rows and becomes unusable at a thousand,
 * which this shop will reach. So: one line per invoice, the money right-aligned
 * so a column of figures can be scanned down, and the filtering done by the
 * database rather than the browser.
 *
 * "Owing" is the important filter and the reason the separate debts screen
 * could go: a partly paid invoice and a debt are the same fact seen from two
 * sides, and keeping two screens for it meant two places that could disagree.
 */
export default async function InvoicesPage(props: {
  searchParams: Promise<{ q?: string; state?: string; page?: number | string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const sp = await props.searchParams;
  const q = (sp.q ?? "").trim();
  const state = (STATES.find((s) => s.key === sp.state)?.key ?? "all") as InvoiceState;
  const page = Number(sp.page ?? 1) || 1;

  const { rows, total, pages, page: current } = wholesaleInvoices({ q, state, page });
  const sums = wholesaleInvoiceTotals();

  return (
    <div>
      <BackLink href="/wholesale" label="Wholesale" />
      <PageTitle title="Invoices" subtitle="Every wholesale bill, paid or outstanding" />
      <WholesaleNav current="/wholesale/invoices" />

      <NewBanner
        href="/wholesale/invoices/new"
        title="New invoice"
        blurb="Bill a customer directly, or start from a quote they have approved."
        cta="Start"
      />

      {/* Totals for the whole book, not for the page on screen. */}
      <div className="mb-4 grid grid-cols-2 gap-2.5 xl:grid-cols-4">
        <Stat label="Invoices" value={String(sums.count)} detail="all time" />
        <Stat label="Billed" value={formatKesRounded(sums.billed)} detail="all time" />
        <Stat
          label="Still owed"
          value={formatKesRounded(sums.owed)}
          detail={sums.owingCount ? `across ${sums.owingCount} invoice${sums.owingCount === 1 ? "" : "s"}` : "all settled"}
        />
        <Stat
          label="Late over 30 days"
          value={formatKesRounded(sums.overdue)}
          detail={
            sums.overdueCount
              ? `${sums.overdueCount} to chase`
              : "nothing has gone stale"
          }
        />
      </div>

      <ListToolbar
        action="/wholesale/invoices"
        q={q}
        placeholder="Customer, invoice number, or a word from the note…"
        filters={STATES}
        current={state}
      />

      {rows.length ? (
        <div className="overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-ink/5">
          <table className="w-full table-fixed text-sm sm:table-auto">
            <thead>
              <tr className="border-b border-line bg-wash text-left text-[10px] uppercase tracking-[0.12em] text-muted">
                <th className="px-2 py-2 sm:px-3">Customer</th>
                <th className="hidden px-3 py-2 sm:table-cell">Date</th>
                <th className="hidden px-3 py-2 lg:table-cell">Reference</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-2 py-2 text-right sm:px-3">Owing</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const owing = Math.max(0, r.total_cents - r.paid_cents);
                const voided = r.status !== "completed";
                const days = ageDays(r.at);
                return (
                  <tr key={r.id} className="border-t border-line hover:bg-wash/60">
                    <td className="px-2 py-2 sm:px-3">
                      <Link
                        href={`/invoice/${r.id}`}
                        // Stretched over the cell padding: bare text is a 20px
                        // target on a phone.
                        className="-my-2 block py-2 font-bold text-ink hover:text-brand"
                      >
                        {r.customer_name ?? "Walk-in"}
                      </Link>
                      <span className="text-[11px] text-muted sm:hidden">{formatDate(r.at)}</span>
                    </td>
                    <td className="hidden px-3 py-2 text-muted sm:table-cell">{formatDate(r.at)}</td>
                    <td className="hidden px-3 py-2 text-[12px] text-muted lg:table-cell">
                      {r.quote_no ?? r.invoice_no ?? `#${r.id}`}
                    </td>
                    <td className={`px-3 py-2 text-right font-bold tnum ${voided ? "text-muted line-through" : ""}`}>
                      {formatKes(r.total_cents)}
                    </td>
                    <td className="px-2 py-2 text-right tnum sm:px-3">
                      {voided ? (
                        <span className="text-[11px] font-bold uppercase text-bad">voided</span>
                      ) : owing > 0 ? (
                        <>
                          <span className="font-bold text-warn">{formatKes(owing)}</span>
                          {/* How long it has been owed — the one thing the debts
                              screen showed that a bare invoice list did not.
                              Nothing is said about a bill raised today, because
                              "0d" is not information. */}
                          {days >= 1 ? (
                            <span
                              className={`ml-1.5 text-[10px] font-bold uppercase ${
                                days > 30 ? "text-bad" : "text-muted"
                              }`}
                            >
                              {days}d
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-[11px] font-bold uppercase text-good">paid</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Card>
          <Empty>
            {q || state !== "all"
              ? "Nothing matches that. Try a different search, or clear the filter."
              : "No wholesale invoices yet."}
          </Empty>
        </Card>
      )}

      <Pager
        action="/wholesale/invoices"
        page={current}
        pages={pages}
        total={total}
        noun="invoices"
        params={{ ...(q ? { q } : {}), ...(state !== "all" ? { state } : {}) }}
      />
    </div>
  );
}
