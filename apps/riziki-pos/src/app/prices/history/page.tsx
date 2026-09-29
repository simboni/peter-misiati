import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { priceHistoryPage, priceSourceCounts } from "@/lib/pricing";
import { listRange, readListPeriod } from "@/lib/list-range";
import { businessDate, formatKes, formatDateTime } from "@/lib/units";
import { PageTitle, Card, Empty } from "@/components/ui";
import { ListToolbar, Pager } from "@/components/section-nav";
import { DateBar } from "@/components/date-bar";
import { ExportButtons } from "@/components/export-buttons";

export const dynamic = "force-dynamic";

/** A screenful on a laptop, about two on the phone in the shop. */
const PER_PAGE = 25;

/**
 * What prices used to be.
 *
 * The reason a price change writes history rather than just overwriting a
 * column: a customer says "last week it was nine hundred", and somebody has to
 * be able to answer that with a record instead of a memory. It also shows the
 * owner what the counter has been doing with the freedom he handed over —
 * every change made at the till lands here, named.
 */
const SOURCES = [
  { key: "all", label: "Everywhere" },
  { key: "counter", label: "At the till" },
  { key: "admin", label: "Catalogue" },
  { key: "check", label: "Price check" },
];

export default async function PriceHistoryPage(props: {
  searchParams: Promise<{
    page?: string;
    q?: string;
    state?: string;
    period?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const sp = await props.searchParams;

  /*
    A customer says "last week it was nine hundred".

    That is the question this screen exists for, and until now answering it
    meant turning pages until the week showed up — the history was complete and
    unreachable. Now it takes a name and a date.
  */
  const q = (sp.q ?? "").trim();
  const source = SOURCES.some((s) => s.key === sp.state && s.key !== "all") ? sp.state! : "";
  const period = readListPeriod(sp);
  const range = listRange(period, businessDate(), sp.from, sp.to);

  const { rows, total, pages, page } = priceHistoryPage({
    page: Number(sp.page) || 1,
    perPage: PER_PAGE,
    q,
    range,
    source,
  });
  const counts = priceSourceCounts(range, q);

  const dates: Record<string, string> = {};
  if (period !== "all") dates.period = period;
  if (sp.from) dates.from = sp.from;
  if (sp.to) dates.to = sp.to;

  const filters: Record<string, string> = { ...dates };
  if (q) filters.q = q;
  if (source) filters.state = source;

  return (
    <div>
      <Link
        href="/sell"
        className="mb-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-brand hover:underline xl:min-h-9"
      >
        <span aria-hidden>←</span> Back to selling
      </Link>
      <PageTitle title="Price history" subtitle="Every change, who made it, and what it was before" />
      <div className="mb-3">
        <ExportButtons csv="price_changes" label="the price history" range={dates} />
      </div>

      <DateBar
        action="/prices/history"
        current={period}
        range={range}
        from={sp.from ?? ""}
        to={sp.to ?? ""}
        keep={{ ...(q ? { q } : {}), ...(source ? { state: source } : {}) }}
        label="Changed"
      />

      <ListToolbar
        action="/prices/history"
        q={q}
        placeholder="A product, or who changed it…"
        filters={SOURCES.map((s) => ({ key: s.key, label: s.label, count: counts[s.key] }))}
        current={source || "all"}
        extra={dates}
      />

      {rows.length ? (
        <div className="overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-ink/5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-wash text-left text-[10px] uppercase tracking-[0.12em] text-muted">
                <th className="px-3 py-2">Item</th>
                <th className="hidden px-3 py-2 sm:table-cell">When</th>
                <th className="hidden px-3 py-2 lg:table-cell">By</th>
                <th className="px-3 py-2 text-right">Price</th>
                <th className="hidden px-3 py-2 lg:table-cell">Where</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const up = r.new_price > r.old_price;
                const same = r.new_price === r.old_price;
                return (
                  <tr key={`${r.at}-${i}`} className="border-t border-line">
                    <td className="px-3 py-2">
                      <span className="block font-bold leading-tight">{r.item_name}</span>
                      <span className="text-[11px] text-muted sm:hidden">
                        {formatDateTime(r.at)}
                      </span>
                    </td>
                    <td className="hidden px-3 py-2 text-[12px] text-muted sm:table-cell">
                      {formatDateTime(r.at)}
                    </td>
                    <td className="hidden px-3 py-2 text-[12px] text-muted lg:table-cell">
                      {r.user_name ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right tnum">
                      {same ? (
                        <span className="text-muted">unchanged</span>
                      ) : (
                        <>
                          <span className="text-muted line-through">{formatKes(r.old_price)}</span>{" "}
                          <span className={`font-bold ${up ? "text-bad" : "text-good"}`}>
                            {formatKes(r.new_price)}
                          </span>
                        </>
                      )}
                    </td>
                    {/* Where a price was changed says something the amount does
                        not: at the counter means a customer was standing there. */}
                    <td className="hidden px-3 py-2 text-[12px] text-muted lg:table-cell">
                      {r.source === "counter"
                        ? "at the till"
                        : r.source === "admin"
                          ? "catalogue"
                          : "price check"}
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
            {q || source || period !== "all"
              ? "No change matches. Widen the dates, or clear the search."
              : "No price has been changed yet. The first change will appear here."}
          </Empty>
        </Card>
      )}

      <Pager
        action="/prices/history"
        page={page}
        pages={pages}
        total={total}
        noun="change"
        params={filters}
      />
    </div>
  );
}
