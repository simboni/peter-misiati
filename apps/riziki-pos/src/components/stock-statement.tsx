import type { ReactNode } from "react";
import Link from "next/link";
import { formatKes, formatQty } from "@/lib/units";
import {
  STATEMENT_PERIODS,
  STATEMENT_PERIOD_LABEL,
  type StatementPeriod,
  type StatementRow,
  type StatementTotals,
} from "@/lib/stock-statement";
import { describeRange, type DateRange } from "@/lib/reports";
import { Alert, TableWrap, Th, Td } from "@/components/ui";

/**
 * The period strip for a stock statement.
 *
 * Plain links and a GET form, like every other picker in this app: the back
 * button works, a date can be bookmarked or sent to the accountant, and it all
 * still functions on a counter phone that has decided not to run JavaScript.
 */
export function StatementPeriods({
  action,
  current,
  range,
  anchor = "",
}: {
  action: string;
  current: StatementPeriod;
  range: DateRange;
  anchor?: string;
}) {
  const href = (p: StatementPeriod) => {
    const q = new URLSearchParams({ period: p });
    if (p === "custom") {
      q.set("from", range.from);
      q.set("to", range.to);
    }
    return `${action}?${q.toString()}${anchor}`;
  };

  return (
    <div className="no-print">
      <div className="flex flex-wrap items-center gap-1.5">
        {STATEMENT_PERIODS.map((p) => (
          <Link
            key={p}
            href={href(p)}
            aria-current={p === current ? "page" : undefined}
            className={`inline-flex min-h-9 items-center rounded-full px-3 text-[12px] font-bold transition-colors ${
              p === current
                ? "bg-brand text-white"
                : "bg-white text-muted ring-1 ring-line hover:text-ink"
            }`}
          >
            {STATEMENT_PERIOD_LABEL[p]}
          </Link>
        ))}
      </div>

      {current === "custom" ? (
        <form action={action} className="mt-2 flex flex-wrap items-end gap-2">
          <input type="hidden" name="period" value="custom" />
          <label className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
            <span className="block">From</span>
            <input
              type="date"
              name="from"
              defaultValue={range.from}
              className="mt-1 min-h-10 rounded-xl border border-line bg-white px-2.5 text-sm font-semibold text-ink"
            />
          </label>
          <label className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
            <span className="block">To</span>
            <input
              type="date"
              name="to"
              defaultValue={range.to}
              className="mt-1 min-h-10 rounded-xl border border-line bg-white px-2.5 text-sm font-semibold text-ink"
            />
          </label>
          <button
            type="submit"
            className="min-h-10 rounded-xl bg-brand px-4 text-[12px] font-bold text-white"
          >
            Show
          </button>
        </form>
      ) : null}
    </div>
  );
}

/**
 * The shop's whole movement for the period, in money.
 *
 * Money and not quantity, and that is not a presentation choice. Kilos, litres
 * and pieces do not add up — a "total stock 4,312" that silently mixes all
 * three is a number somebody will act on. Value at cost is the only honest
 * total across a shelf of different units.
 */
export function StatementFlow({
  totals,
  uncosted,
  children,
}: {
  totals: StatementTotals;
  uncosted: string[];
  /** The takings line, where the screen is allowed to show it. */
  children?: ReactNode;
}) {
  const steps: Array<{ label: string; cents: number; sign: "" | "+" | "−" | "±" }> = [
    { label: "Opening stock", cents: totals.openingValueCents, sign: "" },
    { label: "Bought", cents: totals.boughtValueCents, sign: "+" },
    { label: "Made", cents: totals.madeValueCents, sign: "+" },
    { label: "Sold, at cost", cents: totals.soldValueCents, sign: "−" },
    { label: "Used in mixing", cents: totals.usedValueCents, sign: "−" },
    { label: "Adjusted", cents: totals.adjustedValueCents, sign: "±" },
    { label: "Closing stock", cents: totals.closingValueCents, sign: "" },
  ];

  return (
    <div>
      {/*
        THE HEADING IS NOT DECORATION.

        Every figure in this strip is a COST. It sits on the same page as
        "Sales today", which is takings, and the owner read the two as two
        answers to the same question — reasonably, because one of these tiles
        used to say simply "Sold". Two numbers about the same goods, differing
        by exactly the profit, with nothing on the screen to say which was
        which.
      */}
      <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
        What the shelf was worth — cost prices, not takings
      </div>

      {/*
        Seven cells, and the two that matter are the ends. Two to a row on a
        phone so nothing is squeezed to four characters, all seven across on a
        laptop where the whole sentence can be read left to right.
      */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-line sm:grid-cols-4 xl:grid-cols-7">
        {steps.map((s, i) => {
          const end = i === 0 || i === steps.length - 1;
          // Seven cells into a two- or four-column grid leaves a hole at the
          // end. Closing stock fills it rather than sitting beside an empty
          // tinted box — and it is the figure that deserves the width anyway.
          const last = i === steps.length - 1;
          return (
            <div
              key={s.label}
              className={`p-2.5 ${end ? "bg-wash" : "bg-white"} ${
                last ? "col-span-2 sm:col-span-2 xl:col-span-1" : ""
              }`}
            >
              <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
                {s.sign ? `${s.sign} ` : ""}
                {s.label}
              </div>
              <div
                className={`mt-0.5 tnum ${end ? "text-[15px] font-extrabold" : "text-sm font-bold"} ${
                  s.sign === "±" && s.cents < 0 ? "text-bad" : ""
                }`}
              >
                {formatKes(s.cents)}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-1.5 text-[11px] text-muted">
        Valued at what each thing costs today. Opening and closing are the same shelf priced the
        same way, so the difference between them is real movement and not a price change.
      </p>

      {children}

      {uncosted.length ? (
        <div className="mt-2">
          <Alert tone="warn">
            {uncosted.length === 1
              ? `${uncosted[0]} has stock but no cost price, so it is valued at nothing above.`
              : `${uncosted.length} things have stock but no cost price, so they are valued at nothing above: ${uncosted.slice(0, 6).join(", ")}${uncosted.length > 6 ? ` and ${uncosted.length - 6} more` : ""}.`}{" "}
            The quantities are still right.
          </Alert>
        </div>
      ) : null}
    </div>
  );
}

/** A quantity column: a dash where nothing happened, so the eye finds what did. */
function Qty({
  milli,
  unit,
  sign = "",
  tone = "",
}: {
  milli: number;
  unit: string;
  sign?: "+" | "−" | "";
  tone?: string;
}) {
  if (milli === 0) return <span className="text-line">—</span>;
  const signed = sign === "" && milli < 0 ? "−" : sign;
  return (
    <span className={`tnum ${tone}`}>
      {signed}
      {formatQty(Math.abs(milli), unit)}
    </span>
  );
}

/**
 * Every item, in its own unit, with the columns that make up the closing figure.
 *
 * Quantities per row and never a total: see `StatementFlow`. The row links to
 * that item's own stock card, because the next question after "where did
 * forty kilos go" is always "which entries", and that screen has them.
 */
export function StatementTable({ rows }: { rows: StatementRow[] }) {
  return (
    <TableWrap>
      <thead>
        <tr>
          <Th>Item</Th>
          <Th align="right">Opening</Th>
          <Th align="right">Bought</Th>
          <Th align="right">Made</Th>
          <Th align="right">Sold</Th>
          <Th align="right">Used</Th>
          <Th align="right">Adjusted</Th>
          <Th align="right">Closing</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.itemId} className="hover:bg-wash/50">
            <Td>
              <Link href={`/stock/${r.itemId}`} className="font-semibold hover:underline">
                {r.name}
              </Link>
            </Td>
            <Td align="right" className="text-muted">
              <Qty milli={r.openingMilli} unit={r.unit} />
            </Td>
            <Td align="right">
              <Qty milli={r.boughtMilli} unit={r.unit} sign="+" tone="text-good" />
            </Td>
            <Td align="right">
              <Qty milli={r.madeMilli} unit={r.unit} sign="+" tone="text-good" />
            </Td>
            <Td align="right">
              <Qty milli={r.soldMilli} unit={r.unit} sign="−" tone="text-muted" />
            </Td>
            <Td align="right">
              <Qty milli={r.usedMilli} unit={r.unit} sign="−" tone="text-muted" />
            </Td>
            <Td align="right">
              <Qty milli={r.adjustedMilli} unit={r.unit} tone={r.adjustedMilli < 0 ? "text-bad" : ""} />
            </Td>
            <Td align="right">
              <span
                className={`font-extrabold tnum ${r.closingMilli < 0 ? "text-bad" : ""}`}
              >
                {formatQty(r.closingMilli, r.unit)}
              </span>
            </Td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

/** "Today", or "1–14 Oct 2026" — what the figures above are about. */
export function StatementCaption({ range }: { range: DateRange }) {
  return <span className="text-[11px] text-muted">{describeRange(range)}</span>;
}

/**
 * The one line that stops the stock statement and the takings looking like an
 * argument.
 *
 * "Sales today KES 12,275" and "Sold KES 6,984" are both true and are not the
 * same question: the first is what the customers paid, the second is what those
 * goods had cost the shop. The gap between them IS the profit, and saying so
 * out loud turns two numbers that look like a contradiction into one sentence.
 *
 * The figures come from the sales record — the same source the Reports screen
 * reads — rather than from the stock valuation above, so the two screens cannot
 * disagree by a rounding cent.
 */
export function StatementTakings({
  salesCents,
  cogsCents,
  profitCents,
  href = "/reports",
}: {
  salesCents: number;
  cogsCents: number;
  profitCents: number;
  href?: string;
}) {
  if (salesCents === 0 && cogsCents === 0) return null;
  return (
    <p className="mt-2 rounded-xl bg-wash px-2.5 py-2 text-[11px] leading-relaxed">
      <strong className="text-ink">Those goods sold for {formatKes(salesCents)}</strong> and had
      cost {formatKes(cogsCents)}, so the gross profit on them is{" "}
      <strong className={profitCents < 0 ? "text-bad" : "text-good"}>
        {formatKes(profitCents)}
      </strong>
      . The tiles above are cost prices — they are what the shelf is worth, never what it sold
      for.{" "}
      <Link href={href} className="font-bold text-brand-dark">
        Full profit report →
      </Link>
    </p>
  );
}
