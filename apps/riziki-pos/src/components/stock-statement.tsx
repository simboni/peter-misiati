import type { ReactNode } from "react";
import Link from "next/link";
import { formatKes, formatQty } from "@/lib/units";
import {
  STATEMENT_PERIODS,
  STATEMENT_PERIOD_LABEL,
  type StatementPeriod,
  type StatementRow,
  type StatementTotals,
  type StatementSort,
  type SortDirection,
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
  keep = {},
}: {
  action: string;
  current: StatementPeriod;
  range: DateRange;
  anchor?: string;
  /** Anything that must survive a change of date — the sort, for one. */
  keep?: Record<string, string>;
}) {
  const href = (p: StatementPeriod) => {
    const q = new URLSearchParams({ period: p });
    if (p === "custom") {
      q.set("from", range.from);
      q.set("to", range.to);
    }
    for (const [k, v] of Object.entries(keep)) if (v) q.set(k, v);
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
          {Object.entries(keep).map(([k, v]) =>
            v ? <input key={k} type="hidden" name={k} value={v} /> : null,
          )}
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
/**
 * The sort arrows, drawn rather than typed.
 *
 * They were characters — ⇅ for "this can be sorted", ▲▼ for the live one — and
 * on the shop's Windows desktop they could not be seen at all. Two reasons, and
 * both had to go: the idle pair was `text-line`, which is #dde8e8 on a #f2f7f7
 * header and about 1.2:1 against it, and ⇅ (U+21C5) is not in every font
 * Windows reaches for, so where the colour did not lose it the typeface could.
 *
 * An inline SVG has no font to miss and no glyph to substitute. It renders the
 * same on the counter desktop as on a phone, and the colours below are muted
 * and brand — both of which pass against this header at this size.
 */
function SortArrow({ state }: { state: "idle" | "asc" | "desc" }) {
  const up = state === "asc";
  const down = state === "desc";
  const live = up || down;
  return (
    <svg
      width="9"
      height="12"
      viewBox="0 0 9 12"
      aria-hidden
      // 75%, not less: muted at 60% lands near 2.6:1 on this header, under the
      // 3:1 a control that is not text has to clear to be seen on a bright
      // counter screen.
      className={live ? "text-brand" : "text-muted opacity-75"}
      style={{ flex: "none" }}
    >
      <path d="M4.5 0.5 L8 4.5 L1 4.5 Z" fill="currentColor" opacity={down ? 0.25 : 1} />
      <path d="M4.5 11.5 L1 7.5 L8 7.5 Z" fill="currentColor" opacity={up ? 0.25 : 1} />
    </svg>
  );
}

/**
 * A column heading that sorts.
 *
 * A link and not a button: the sort lives in the URL, so the back button
 * works, a sorted view can be sent to somebody, and the page still sorts on a
 * counter phone that has decided not to run JavaScript today. Pressing the
 * column you are already on flips the direction, which is what every table
 * anybody has used does.
 *
 * The idle arrows sit on every sortable column on purpose. Without them the
 * only column that looks pressable is the one already sorted, and nobody finds
 * the feature.
 */
function SortTh({
  label,
  col,
  sort,
  dir,
  hrefFor,
  align = "right",
}: {
  label: string;
  col: StatementSort;
  sort?: StatementSort;
  dir?: SortDirection;
  hrefFor?: (col: StatementSort, dir: SortDirection) => string;
  align?: "left" | "right";
}) {
  if (!hrefFor) return <Th align={align}>{label}</Th>;

  const active = sort === col;
  // Numbers open on biggest-first, names on A–Z: that is what each is asked for.
  const next: SortDirection = active ? (dir === "desc" ? "asc" : "desc") : col === "name" ? "asc" : "desc";
  const state = active ? (dir === "asc" ? "asc" : "desc") : "idle";

  return (
    <Th align={align}>
      <Link
        href={hrefFor(col, next)}
        scroll={false}
        aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
        title={`Sort by ${label.toLowerCase()}`}
        className={`inline-flex min-h-8 items-center gap-1 whitespace-nowrap rounded-md px-1 -mx-1 hover:bg-white hover:text-ink ${
          active ? "font-extrabold text-ink" : ""
        }`}
      >
        {align === "right" ? null : <span>{label}</span>}
        <SortArrow state={state} />
        {align === "right" ? <span>{label}</span> : null}
      </Link>
    </Th>
  );
}

export function StatementTable({
  rows,
  className = "",
  sort,
  dir,
  hrefFor,
}: {
  rows: StatementRow[];
  /** Lets the printed copy release the sideways scroll that clips it on paper. */
  className?: string;
  sort?: StatementSort;
  dir?: SortDirection;
  /** Omitted on a screen that does not sort — the headings stay plain. */
  hrefFor?: (col: StatementSort, dir: SortDirection) => string;
}) {
  const th = (label: string, col: StatementSort, align: "left" | "right" = "right") => (
    <SortTh label={label} col={col} sort={sort} dir={dir} hrefFor={hrefFor} align={align} />
  );

  return (
    <TableWrap className={className}>
      <thead>
        <tr>
          {th("Item", "name", "left")}
          {th("Opening", "opening")}
          {th("Bought", "bought")}
          {th("Made", "made")}
          {th("Sold", "sold")}
          {th("Used", "used")}
          {th("Adjusted", "adjusted")}
          {th("Closing", "closing")}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.itemId} className="hover:bg-wash/50">
            <Td>
              <Link href={`/stock/${r.itemId}`} className="font-semibold hover:underline">
                {r.name}
              </Link>
              {r.packs ? <Containers row={r} /> : null}
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

/**
 * WHAT THE KILOGRAMMES ARE STANDING IN.
 *
 * "203 kg of Ungerol" is a true answer to a question nobody asks. The shop
 * keeps seven 20 kg jerricans, ten 5 kg jerricans and the rest in the drum, and
 * that is the only form of the number that can be checked against the yard by
 * eye.
 *
 * The summary line carries the closing answer, so the common question is
 * answered with nothing to press — a fold that must be opened to see what is
 * there is a fold that stays shut. Opening it gives both ends and everything
 * between: what was standing at the start, what was poured, what went out, what
 * was tipped back, and what is standing now.
 */
function Containers({ row }: { row: StatementRow }) {
  const p = row.packs!;
  const standing = p.sizes.filter((s) => s.closingPacks > 0);
  const unit = p.unit;

  const summary =
    standing.length === 0
      ? `all ${formatQty(p.closingLooseMilli, unit)} loose`
      : standing.map((s) => `${s.closingPacks} × ${s.label}`).join(" · ") +
        (p.closingLooseMilli > 0 ? ` · ${formatQty(p.closingLooseMilli, unit)} loose` : "");

  return (
    <details className="mt-0.5">
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1 text-[11px] text-muted hover:text-ink xl:min-h-6">
        <span aria-hidden className="text-brand">▸</span>
        <span className="tnum">{summary}</span>
      </summary>

      <div className="mt-1 rounded-xl border border-line bg-wash/60 p-2">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="text-muted">
              <th className="py-0.5 pr-2 text-left font-semibold">Size</th>
              <th className="py-0.5 px-1 text-right font-semibold">Opening</th>
              <th className="py-0.5 px-1 text-right font-semibold">Filled</th>
              <th className="py-0.5 px-1 text-right font-semibold">Sold</th>
              <th className="py-0.5 px-1 text-right font-semibold">Opened</th>
              <th className="py-0.5 pl-1 text-right font-semibold">Closing</th>
            </tr>
          </thead>
          <tbody>
            {p.sizes.map((s) => (
              <tr key={s.bundleId} className="border-t border-line/70">
                <td className="py-0.5 pr-2 font-semibold whitespace-nowrap">{s.label}</td>
                <td className="py-0.5 px-1 text-right tnum text-muted">{s.openingPacks || "—"}</td>
                <td className="py-0.5 px-1 text-right tnum text-good">
                  {s.filledPacks ? `+${s.filledPacks}` : "—"}
                </td>
                <td className="py-0.5 px-1 text-right tnum">{s.soldPacks ? `−${s.soldPacks}` : "—"}</td>
                <td className="py-0.5 px-1 text-right tnum text-muted">
                  {s.openedPacks ? `−${s.openedPacks}` : "—"}
                </td>
                <td className="py-0.5 pl-1 text-right font-extrabold tnum">{s.closingPacks}</td>
              </tr>
            ))}
            <tr className="border-t border-line">
              <td className="py-0.5 pr-2 font-semibold text-muted">Loose in the drum</td>
              <td className="py-0.5 px-1 text-right tnum text-muted">
                {formatQty(p.openingLooseMilli, unit)}
              </td>
              <td colSpan={3} />
              <td className="py-0.5 pl-1 text-right font-extrabold tnum">
                {formatQty(p.closingLooseMilli, unit)}
              </td>
            </tr>
          </tbody>
        </table>

        {p.batches.length ? (
          <p className="mt-1.5 border-t border-line pt-1.5 text-[11px] text-muted">
            Filled from {p.batches.length === 1 ? "batch" : "batches"}{" "}
            <span className="font-semibold">{p.batches.join(", ")}</span>.
          </p>
        ) : null}

        <p className="mt-1 text-[11px] text-muted">
          Containers, not weight. The {formatQty(row.closingMilli, unit)} in the Closing column is
          these and the drum together.
        </p>
      </div>
    </details>
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
