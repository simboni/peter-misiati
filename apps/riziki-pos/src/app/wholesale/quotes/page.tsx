import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { wholesaleQuotes, quoteStateCounts, type QuoteState } from "@/lib/wholesale-lists";
import { formatKes, formatDate } from "@/lib/units";
import { Card, Empty, PageTitle } from "@/components/ui";
import { WholesaleNav, NewBanner, BackLink, ListToolbar, Pager } from "@/components/wholesale-nav";

export const dynamic = "force-dynamic";

const STATE_TONE: Record<string, string> = {
  approved: "bg-good-soft text-good",
  sent: "bg-warn-soft text-warn",
  draft: "bg-wash text-muted",
  declined: "bg-bad-soft text-bad",
  invoiced: "bg-brand-soft text-brand-dark",
};

const ORDER: Array<{ key: QuoteState; label: string }> = [
  { key: "all", label: "All" },
  { key: "approved", label: "Approved" },
  { key: "sent", label: "Sent" },
  { key: "draft", label: "Draft" },
  { key: "invoiced", label: "Invoiced" },
  { key: "declined", label: "Declined" },
];

export default async function QuotesPage(props: {
  searchParams: Promise<{ q?: string; state?: string; page?: number | string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const sp = await props.searchParams;
  const q = (sp.q ?? "").trim();
  const state = (ORDER.find((s) => s.key === sp.state)?.key ?? "all") as QuoteState;
  const page = Number(sp.page ?? 1) || 1;

  const { rows, total, pages, page: current } = wholesaleQuotes({ q, state, page });
  const counts = quoteStateCounts();
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <BackLink href="/wholesale" label="Wholesale" />
      <PageTitle title="Quotes" subtitle="Prices offered, and what became of them" />
      <WholesaleNav current="/wholesale/quotes" />

      <NewBanner
        href="/wholesale/quotes/new"
        title="New quote"
        blurb="Put a price in writing. Nothing moves until the customer accepts it."
        cta="Start"
      />

      <ListToolbar
        action="/wholesale/quotes"
        q={q}
        placeholder="Customer, quote number, or a word from the note…"
        filters={ORDER.map((s) => ({ ...s, count: counts[s.key] ?? 0 }))}
        current={state}
      />

      {rows.length ? (
        <div className="overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-ink/5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-wash text-left text-[10px] uppercase tracking-[0.12em] text-muted">
                <th className="px-3 py-2">Customer</th>
                <th className="hidden px-3 py-2 sm:table-cell">Number</th>
                <th className="hidden px-3 py-2 lg:table-cell">Raised</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                // A price that has run out is still a price somebody may quote
                // back at you, so it is flagged rather than hidden.
                const lapsed =
                  r.valid_until &&
                  r.valid_until < today &&
                  (r.status === "sent" || r.status === "draft");
                return (
                  <tr key={r.id} className="border-t border-line hover:bg-wash/60">
                    <td className="px-3 py-2">
                      <Link
                        href={`/wholesale/quotes/${r.id}`}
                        className="block font-bold text-ink hover:text-brand"
                      >
                        {r.customer_name || "Unnamed customer"}
                      </Link>
                      <span className="text-[11px] text-muted sm:hidden">{r.quote_no}</span>
                    </td>
                    <td className="hidden px-3 py-2 text-[12px] text-muted tnum sm:table-cell">
                      {r.quote_no}
                    </td>
                    <td className="hidden px-3 py-2 text-muted lg:table-cell">
                      {formatDate(r.created_at)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                          STATE_TONE[r.status] ?? "bg-wash text-muted"
                        }`}
                      >
                        {r.status}
                      </span>
                      {lapsed ? (
                        <span className="ml-1.5 text-[10px] font-bold uppercase text-bad">lapsed</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tnum">
                      <span className="block font-bold">{formatKes(r.total_cents)}</span>
                      {/* Under the figure, not beside it: "KES 5,103" and "1L"
                          on one line read as a single wrong number. */}
                      <span className="block text-[10px] font-semibold text-muted">
                        {r.line_count} item{r.line_count === 1 ? "" : "s"}
                      </span>
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
              : "No quotes yet. Raise one when a customer asks what something would cost."}
          </Empty>
        </Card>
      )}

      <Pager
        action="/wholesale/quotes"
        page={current}
        pages={pages}
        total={total}
        noun="quotes"
        params={{ ...(q ? { q } : {}), ...(state !== "all" ? { state } : {}) }}
      />
    </div>
  );
}
