import Link from "next/link";
import { PERIODS, PERIOD_LABEL, describeRange, type DateRange, type Period } from "@/lib/reports";

/**
 * What the report is read over.
 *
 * Every figure on this screen used to be the current month, decided in the
 * code and stated nowhere — so "sales 214,000" answered a question the owner
 * had not asked and could not change. Now the period is the first thing on the
 * page, the range it means is printed under it, and it rides in the URL, which
 * means a report can be bookmarked, sent to the accountant, and reloaded next
 * month to a different answer than the one that was sent.
 *
 * Six named periods and a pair of dates. The names are the questions the owner
 * actually asks — today, this week, this month, last month, this year — and
 * typing two dates to answer one of them is work the screen should be doing.
 *
 * Plain links and a GET form, no client state: the back button works, and it
 * still works on a counter phone that has decided not to run JavaScript.
 */
export function PeriodPicker({
  current,
  range,
  from,
  to,
}: {
  current: Period;
  range: DateRange;
  from: string;
  to: string;
}) {
  return (
    <div className="no-print mb-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {PERIODS.map((p) => (
          <Link
            key={p}
            href={p === "custom" ? `/reports?period=custom&from=${range.from}&to=${range.to}` : `/reports?period=${p}`}
            aria-current={current === p ? "true" : undefined}
            className={`flex min-h-9 items-center rounded-full px-3.5 text-[13px] font-bold transition-colors ${
              current === p
                ? "bg-brand text-white"
                : "bg-white text-muted ring-1 ring-inset ring-line hover:text-ink"
            }`}
          >
            {PERIOD_LABEL[p]}
          </Link>
        ))}

        {/* The range in words, beside the choice that produced it. A report
            headed only "This month" is ambiguous on the first of the month. */}
        <span className="ml-1 text-[13px] font-semibold text-muted">{describeRange(range)}</span>
      </div>

      {current === "custom" ? (
        <form method="get" action="/reports" className="mt-2 flex flex-wrap items-end gap-2">
          <input type="hidden" name="period" value="custom" />
          <label className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
            <span className="mb-1 block">From</span>
            <input
              type="date"
              name="from"
              defaultValue={from || range.from}
              className="min-h-11 rounded-xl border border-line bg-white px-3 text-sm font-semibold text-ink xl:min-h-10"
            />
          </label>
          <label className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
            <span className="mb-1 block">To</span>
            <input
              type="date"
              name="to"
              defaultValue={to || range.to}
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
