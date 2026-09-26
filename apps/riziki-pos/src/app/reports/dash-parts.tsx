import Link from "next/link";
import { formatKes } from "@/lib/units";
import { TableWrap, Th, Td } from "@/components/ui";
import type { TrendPoint, Grain } from "@/lib/dashboard";

/**
 * The pieces the dashboard is drawn from.
 *
 * All server components: no chart library, no client JavaScript, nothing that
 * has to boot before the owner sees a figure. This screen opens over Nairobi
 * mobile data on whatever phone is to hand, and a dashboard that takes three
 * seconds to assemble itself is one nobody opens twice.
 *
 * Everything drawn is also written: each chart carries a table behind a
 * `<details>`, which is the version a screen reader gets, the version that
 * survives a printer, and the version somebody copies into WhatsApp. That is
 * not a concession — a picture of six numbers is worse than the six numbers
 * whenever the question is "what exactly".
 */

// ------------------------------------------------------------------ change

/**
 * A movement against the period before, said the way somebody says it.
 *
 * Null means there is nothing to compare against — a first week in business is
 * not "up 100%", and a screen that claims it is lying in the owner's favour.
 */
export function Delta({
  pct: value,
  invert = false,
  unit = "pct",
}: {
  pct: number | null;
  /** True where DOWN is the good direction — expenses, discounts. */
  invert?: boolean;
  /**
   * "pct" for a proportional move, "pts" where the figure is itself a
   * percentage. A margin that goes from 30% to 33% moved three POINTS, not ten
   * percent, and calling it ten percent is the kind of flattery that gets a
   * dashboard mistrusted.
   */
  unit?: "pct" | "pts";
}) {
  if (value === null) {
    return <span className="text-[11px] font-semibold text-muted">no period before</span>;
  }

  const flat = Math.abs(value) < (unit === "pts" ? 0.1 : 0.5);
  const good = invert ? value < 0 : value > 0;
  const tone = flat ? "text-muted" : good ? "text-good" : "text-bad";
  const arrow = flat ? "→" : value > 0 ? "↑" : "↓";

  return (
    <span className={`text-[11px] font-bold tnum ${tone}`}>
      {arrow} {Math.abs(value).toFixed(unit === "pts" ? 1 : 0)}
      {unit === "pts" ? " pts" : "%"}
    </span>
  );
}

// ---------------------------------------------------------------- sparkline

/**
 * The shape of the period, small enough to sit inside a figure.
 *
 * No axis, no labels, no grid: it answers "which way is this going" and hands
 * every other question to the chart below. Drawn as one polyline over a
 * normalised box so it cannot distort — a flat run is flat, not noise
 * stretched to fill the height.
 */
export function Spark({ values, tone = "brand" }: { values: number[]; tone?: "brand" | "good" | "bad" }) {
  if (values.length < 2) return null;

  const high = Math.max(...values);
  const low = Math.min(...values, 0);
  const span = high - low || 1;
  const step = 100 / (values.length - 1);

  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(28 - ((v - low) / span) * 26).toFixed(1)}`)
    .join(" ");

  const stroke =
    tone === "good" ? "var(--color-good)" : tone === "bad" ? "var(--color-bad)" : "var(--color-brand)";

  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-7 w-full" aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// --------------------------------------------------------------- stat tile

export function Tile({
  label,
  value,
  delta,
  deltaUnit,
  invert,
  detail,
  spark,
  sparkTone,
  href,
  tone = "plain",
}: {
  label: string;
  value: string;
  delta?: number | null;
  deltaUnit?: "pct" | "pts";
  invert?: boolean;
  detail?: string;
  spark?: number[];
  sparkTone?: "brand" | "good" | "bad";
  href?: string;
  tone?: "plain" | "good" | "bad";
}) {
  const body = (
    <>
      <span aria-hidden className="brand-thread absolute inset-x-0 top-0 h-[3px]" />
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
          {label}
        </span>
        {delta === undefined ? null : <Delta pct={delta} invert={invert} unit={deltaUnit} />}
      </div>
      {/* A long figure steps down a size rather than wrapping onto two lines.
          Two tiles fit across a 360px phone, which leaves about 130px for the
          number, and "KES 12,729,795" broken after "KES" is a figure the eye
          has to reassemble. */}
      <div
        className={`mt-1.5 whitespace-nowrap font-extrabold leading-none tracking-tight tnum ${
          value.length <= 10
            ? "text-[19px] xl:text-[26px]"
            : value.length <= 13
              ? "text-[17px] xl:text-[23px]"
              : "text-[15px] xl:text-[21px]"
        } ${tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : "text-brand-deep"}`}
      >
        {value}
      </div>
      {detail ? <div className="mt-1.5 text-[11px] font-medium text-muted">{detail}</div> : null}
      {spark && spark.length > 1 ? (
        <div className="mt-2">
          <Spark values={spark} tone={sparkTone} />
        </div>
      ) : null}
    </>
  );

  // Same shell as `Stat`: this screen has to look like the rest of the product,
  // not like a dashboard bolted onto it.
  const shell =
    "relative block overflow-hidden rounded-3xl bg-white p-3.5 pt-4 shadow-card ring-1 ring-ink/5 xl:p-4 xl:pt-5" +
    (href ? " transition-shadow hover:shadow-lg" : "");

  return href ? (
    <Link href={href} className={shell}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}

// -------------------------------------------------------------- trend chart

const GRAIN_WORD: Record<Grain, string> = {
  day: "by day",
  week: "by week",
  month: "by month",
};

/**
 * Sales as bars, profit as a line over them.
 *
 * Two series on one plot because the question is one question: "am I selling
 * more, and am I keeping more of it?" Sales alone can rise while profit falls,
 * and a shop that only ever sees the first figure discovers the second in a
 * bank balance months later.
 *
 * Drawn in SVG against a single scale, so the line and the bars are comparable
 * by eye — which is the whole point of putting them on one plot. Marks never
 * leave the box: the viewBox carries the label gutters.
 */
export function TrendChart({
  points,
  grain,
  profitLabel = "Gross profit",
}: {
  points: TrendPoint[];
  grain: Grain;
  profitLabel?: string;
}) {
  if (!points.length) {
    return <p className="text-sm text-muted">Nothing traded in this period.</p>;
  }

  /*
    One bucket is not a trend, and drawn as a chart it is a single block the
    width of the card that says nothing a figure has not already said. So it
    says the figure instead, and points at the periods that do have a shape.
  */
  if (points.length === 1) {
    const only = points[0];
    return (
      <p className="text-sm text-muted">
        <span className="font-bold text-ink">{only.label}</span> — {formatKes(only.salesCents)} of
        sales and {formatKes(only.grossProfitCents)} gross profit across {only.saleCount}{" "}
        {only.saleCount === 1 ? "sale" : "sales"}. One {grain} on its own has no shape to draw;
        choose a longer period above to see the trend.
      </p>
    );
  }

  const W = 100;
  const H = 46;
  const peak = Math.max(1, ...points.map((p) => Math.max(p.salesCents, p.grossProfitCents)));
  const step = W / points.length;
  const barW = Math.max(1.2, step * 0.62);

  const y = (cents: number) => H - (Math.max(0, cents) / peak) * H;

  const line = points
    .map((p, i) => `${(i * step + step / 2).toFixed(2)},${y(p.grossProfitCents).toFixed(2)}`)
    .join(" ");

  // Every second label on a crowded axis, so a month of days stays legible.
  const labelEvery = points.length > 16 ? Math.ceil(points.length / 8) : 1;
  const total = points.reduce((n, p) => n + p.salesCents, 0);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-xs text-muted">
          Sales {GRAIN_WORD[grain]} · peak {formatKes(peak)}
        </p>
        <p className="flex items-center gap-3 text-[11px] font-semibold">
          <span className="flex items-center gap-1.5 text-muted">
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm bg-brand" /> Sales
          </span>
          <span className="flex items-center gap-1.5 text-muted">
            <span aria-hidden className="inline-block h-0.5 w-4 rounded bg-good" /> {profitLabel}
          </span>
        </p>
      </div>

      <div
        role="img"
        aria-label={`Sales ${GRAIN_WORD[grain]} over ${points.length} periods, totalling ${formatKes(
          total,
        )}. Highest ${formatKes(peak)}.`}
      >
        <svg
          viewBox={`0 0 ${W} ${H + 1}`}
          preserveAspectRatio="none"
          className="h-40 w-full xl:h-48"
        >
          {/* A hairline grid: something to read heights against, nothing more. */}
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <line
              key={f}
              x1="0"
              x2={W}
              y1={H - H * f}
              y2={H - H * f}
              stroke="var(--color-line)"
              strokeWidth="0.3"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {points.map((p, i) => {
            const top = y(p.salesCents);
            return (
              <rect
                key={p.key}
                x={i * step + (step - barW) / 2}
                y={p.salesCents > 0 ? top : H - 0.4}
                width={barW}
                height={p.salesCents > 0 ? Math.max(0.6, H - top) : 0.4}
                rx="0.6"
                fill="var(--color-brand)"
                opacity={i === points.length - 1 ? 1 : 0.55}
              />
            );
          })}

          <polyline
            points={line}
            fill="none"
            stroke="var(--color-good)"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/*
          Labels hung under the bar they belong to rather than laid out in a
          row of equal cells. In equal cells a thinned axis gives each label
          one bar's width, and a month of days comes out as "Tu…", "We…",
          "Th…" — which is not a date. Centred and free to overhang the empty
          space either side, the same label reads "Tue 1".
        */}
        <div aria-hidden className="relative mt-1 h-4">
          {points.map((p, i) => {
            const last = i === points.length - 1;
            // The final bucket always gets its label; a thinned one that would
            // land on top of it is dropped rather than printed over it.
            const tooClose = points.length - 1 - i < Math.max(1, Math.floor(labelEvery / 2));
            if (!last && (i % labelEvery !== 0 || tooClose)) return null;
            // The two on the ends anchor to the edge instead of to their own
            // centre, or half of each would hang off the chart.
            const place = last
              ? { right: 0 }
              : i === 0
                ? { left: 0 }
                : { left: `${((i + 0.5) / points.length) * 100}%` };
            return (
              <span
                key={p.key}
                className={`absolute whitespace-nowrap text-[10px] ${
                  last ? "font-bold text-ink" : "text-muted"
                } ${last || i === 0 ? "" : "-translate-x-1/2"}`}
                style={place}
              >
                {p.label}
              </span>
            );
          })}
        </div>
      </div>

      {/* The same figures, in words. See the note at the top of this file. */}
      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] font-bold text-brand">
          The figures behind this chart
        </summary>
        <div className="mt-2">
          <TableWrap>
            <thead>
              <tr>
                <Th>{grain === "day" ? "Day" : grain === "week" ? "Week of" : "Month"}</Th>
                <Th align="right">Sales</Th>
                <Th align="right">{profitLabel}</Th>
                <Th align="right">Sales count</Th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.key}>
                  <Td className="whitespace-nowrap">{p.label}</Td>
                  <Td align="right" className="tnum">{formatKes(p.salesCents)}</Td>
                  <Td align="right" className="tnum">{formatKes(p.grossProfitCents)}</Td>
                  <Td align="right" className="tnum text-muted">{p.saleCount}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------- split bar

/**
 * How one total divides — cash against M-Pesa, one line of business against
 * another.
 *
 * A stacked bar rather than a pie, for the reason pies are wrong for this: the
 * owner compares these shares with LAST month's, and lengths along a common
 * baseline can be compared by eye where angles cannot.
 */
export function SplitBar({
  parts,
}: {
  parts: Array<{ label: string; cents: number; className: string }>;
}) {
  const total = parts.reduce((n, p) => n + Math.max(0, p.cents), 0);
  if (total <= 0) {
    return <p className="text-sm text-muted">Nothing came in this period.</p>;
  }

  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-wash" aria-hidden>
        {parts.map((p) =>
          p.cents > 0 ? (
            <div
              key={p.label}
              className={p.className}
              style={{ width: `${(p.cents / total) * 100}%` }}
            />
          ) : null,
        )}
      </div>
      <dl className="mt-2 space-y-1">
        {parts.map((p) => (
          <div key={p.label} className="flex items-baseline justify-between gap-3 text-[13px]">
            <dt className="flex items-center gap-1.5 text-muted">
              <span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-sm ${p.className}`} />
              {p.label}
            </dt>
            <dd className="font-semibold tnum">
              {formatKes(p.cents)}
              <span className="ml-1.5 text-[11px] font-normal text-muted">
                {((p.cents / total) * 100).toFixed(0)}%
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// --------------------------------------------------------------- rank rows

/**
 * A ranked row with the bar drawn behind the words.
 *
 * The bar is not decoration: reading twelve money figures down a column and
 * working out which is twice another is work, and a length does it at a
 * glance. Behind the text rather than beside it, so the name still has the
 * full width on a phone.
 */
export function RankRow({
  name,
  value,
  share,
  meta,
  tone = "brand",
  href,
}: {
  name: string;
  value: string;
  /** 0–1 of the biggest row, for the bar behind. */
  share: number;
  meta?: string;
  tone?: "brand" | "good" | "bad";
  href?: string;
}) {
  const fill = tone === "good" ? "bg-good/15" : tone === "bad" ? "bg-bad/15" : "bg-brand/12";

  const inner = (
    <div className="relative overflow-hidden rounded-lg px-2.5 py-2">
      <div
        aria-hidden
        className={`absolute inset-y-0 left-0 ${fill}`}
        style={{ width: `${Math.max(2, Math.min(100, share * 100))}%` }}
      />
      <div className="relative flex items-baseline justify-between gap-3">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{name}</span>
        <span className="shrink-0 text-[13px] font-bold tnum">{value}</span>
      </div>
      {meta ? <div className="relative mt-0.5 text-[11px] text-muted">{meta}</div> : null}
    </div>
  );

  return href ? (
    <Link href={href} className="block hover:opacity-90">
      {inner}
    </Link>
  ) : (
    inner
  );
}
