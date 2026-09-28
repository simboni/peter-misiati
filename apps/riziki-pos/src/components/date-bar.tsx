import Link from "next/link";
import { describeRange, type DateRange } from "@/lib/reports";
import { LIST_PERIODS, LIST_PERIOD_LABEL, type ListPeriod } from "@/lib/list-range";

/**
 * When a list is read over — the reports picker, for every other list.
 *
 * Sales, expenses, deliveries, price changes and the activity log are all
 * records that only grow, and every one of them was a wall of newest-first rows
 * with no way to say "the 22nd" but turning pages. This is the row of periods
 * from the dashboard, with **All** at the front, because a list is a record
 * rather than a report: somebody looking for one sale rarely knows which month
 * it was in.
 *
 * Plain links and a GET form. No client state, so the back button works, a
 * filtered list can be bookmarked or sent to somebody, and it all still
 * functions on a counter phone that has decided not to run JavaScript today.
 *
 * `keep` is what makes filters compose: a search term and a supplier stay put
 * while the dates change, instead of each control quietly clearing the others.
 */
export function DateBar({
  action,
  current,
  range,
  from,
  to,
  keep = {},
  label = "Showing",
}: {
  action: string;
  current: ListPeriod;
  /** What the choice works out to, or null for all time. */
  range: DateRange | null;
  from: string;
  to: string;
  keep?: Record<string, string>;
  label?: string;
}) {
  const href = (p: ListPeriod) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(keep)) if (v) q.set(k, v);
    if (p !== "all") q.set("period", p);
    if (p === "custom") {
      if (range) {
        q.set("from", range.from);
        q.set("to", range.to);
      }
    }
    const s = q.toString();
    return s ? `${action}?${s}` : action;
  };

  return (
    <div className="no-print mb-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {LIST_PERIODS.map((p) => (
          <Link
            key={p}
            href={href(p)}
            aria-current={current === p ? "true" : undefined}
            className={`flex min-h-9 items-center rounded-full px-3.5 text-[13px] font-bold transition-colors ${
              current === p
                ? "bg-brand text-white"
                : "bg-white text-muted ring-1 ring-inset ring-line hover:text-ink"
            }`}
          >
            {LIST_PERIOD_LABEL[p]}
          </Link>
        ))}

        {/* The range in words, beside the choice that produced it. "This month"
            alone is ambiguous on the first of the month. */}
        <span className="ml-1 text-[13px] font-semibold text-muted">
          {range ? `${label} ${describeRange(range)}` : "Everything, newest first"}
        </span>
      </div>

      {current === "custom" ? (
        <form method="get" action={action} className="mt-2 flex flex-wrap items-end gap-2">
          <input type="hidden" name="period" value="custom" />
          {Object.entries(keep).map(([k, v]) =>
            v ? <input key={k} type="hidden" name={k} value={v} /> : null,
          )}
          <label className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
            <span className="mb-1 block">From</span>
            <input
              type="date"
              name="from"
              defaultValue={from || range?.from || ""}
              className="min-h-11 rounded-xl border border-line bg-white px-3 text-sm font-semibold text-ink xl:min-h-10"
            />
          </label>
          <label className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
            <span className="mb-1 block">To</span>
            <input
              type="date"
              name="to"
              defaultValue={to || range?.to || ""}
              className="min-h-11 rounded-xl border border-line bg-white px-3 text-sm font-semibold text-ink xl:min-h-10"
            />
          </label>
          <button
            type="submit"
            className="flex min-h-11 items-center rounded-xl bg-brand px-4 text-sm font-bold text-white xl:min-h-10"
          >
            Show
          </button>
        </form>
      ) : null}
    </div>
  );
}
