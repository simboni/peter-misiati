/**
 * Reports — the owner's dashboard. OWNER ONLY.
 *
 * Everything here is cost or profit, which staff must never see. The gate is a
 * server-side permission check before a single figure is read, so a staff
 * session never receives the bytes; hiding a tab would still ship the data.
 *
 * WHY IT IS SHAPED LIKE THIS. The old version was a correct report and a poor
 * screen: eleven sections of equal weight, every figure a bare total with
 * nothing to measure it against, and the answer to "how are we doing" buried
 * four scrolls down. A shop owner does not read a report — he checks on his
 * shop, in ninety seconds, usually standing up, usually on a phone.
 *
 * So the page is ordered as that check:
 *
 *   RIGHT NOW      today's takings, today's profit, what is owed, what is held.
 *                  Four numbers that are true at this second, whatever period
 *                  is selected. This is what the app gets opened for.
 *   THE PERIOD     sales, gross, net, margin — each against the same span of
 *                  days immediately before it, each with the shape of the
 *                  period drawn under it. A number with nothing beside it says
 *                  nothing; "up a fifth on the fortnight before" is a fact.
 *   ATTENTION      the short list of things that are wrong and can be fixed,
 *                  each one a link to the screen that fixes it. Computed, not
 *                  written: if the list is empty the shop is told so plainly.
 *   THE TREND      sales as bars, profit as a line, at day, week or month
 *                  grain. One plot, because the question is one question: am I
 *                  selling more, and am I keeping more of it?
 *   THE MONEY      what came in and how, credit given, old debts settled, who
 *                  owes, who buys. Takings are not sales and the screen says
 *                  which is which.
 *   WHAT EARNS     per product, per line of business, and the honest reasons a
 *                  margin might be wrong rather than a bare accusation.
 *   DAY BY DAY     the ledger, because eventually somebody asks "which day".
 *   THE LONG VIEW  six months of sales, what the shelf is worth, and the
 *                  whole book since the day the shop was cleared.
 *   LEAKS          discounts, dead stock, shrinkage.
 *
 * The figures come from `lib/dashboard.ts` — one range, one pass, tested as a
 * whole against raw SQL — and the drawing from `dash-parts.tsx`. No chart
 * library: every chart here is SVG or divs, server-rendered, with the same
 * figures in a table one tap away. This screen opens over Nairobi mobile data.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { currentUser, requirePermission, can } from "@/lib/auth";
import {
  formatKes,
  formatKesRounded,
  formatQty,
  formatDate,
  businessDate,
  pct,
} from "@/lib/units";
import {
  periodRange,
  describeRange,
  booksStart,
  clampRange,
  dailyProfit,
  profitSummary,
  monthlySales,
  profitPerProduct,
  businessLineSplit,
  discountSummary,
  discountsByPerson,
  discountsByItem,
  discountedSales,
  deadStock,
  shrinkageByMonth,
  isPeriod,
  type Period,
  type ProductProfit,
} from "@/lib/reports";
import { dashboard, change, topCustomers, type Grain } from "@/lib/dashboard";
import {
  PageTitle,
  Card,
  SectionLabel,
  TableWrap,
  Th,
  Td,
  Empty,
  Chip,
  Alert,
  ListRow,
} from "@/components/ui";
import { SalesChart } from "./sales-chart";
import { PeriodPicker } from "./period-picker";
import { ExportBar } from "./export-bar";
import { Tile, TrendChart, SplitBar, RankRow } from "./dash-parts";
import { Fold } from "./fold";

export const dynamic = "force-dynamic";

const GRAINS: Grain[] = ["day", "week", "month"];
const GRAIN_LABEL: Record<Grain, string> = { day: "Daily", week: "Weekly", month: "Monthly" };

function isGrain(v: string | undefined): v is Grain {
  return v === "day" || v === "week" || v === "month";
}

/**
 * The line under a product's name on the profit list.
 *
 * A losing row used to say "-4% margin" and stop there, which is an accusation
 * with no evidence: the owner cannot tell whether the product really is sold
 * below cost or whether the cost price on file is wrong. So a row that loses
 * money — or one whose cost is an estimate — shows the two figures the
 * judgement actually rests on, in the unit the shop buys and sells in: what it
 * went out at, and what it is costed at.
 */
function productMeta(p: ProductProfit): string {
  const sold = `${p.units} sold · ${formatKes(p.revenue_cents)} sales`;

  if (p.uncosted) return `${sold} · no cost price recorded`;

  const margin = `${p.margin_pct.toFixed(0)}% margin${p.estimated ? " (cost estimated)" : ""}`;

  // Per kilogramme, litre or piece — the only comparison that means anything
  // across a 5 kg bundle and a 20 kg one.
  if ((p.profit_cents < 0 || p.estimated) && p.qty_milli > 0 && p.unit) {
    const per = (cents: number) => formatKes(Math.round((cents * 1000) / p.qty_milli));
    return `${sold} · ${margin} · sold at ${per(p.revenue_cents)}/${p.unit}, costed at ${per(p.cost_cents)}/${p.unit}`;
  }

  return `${sold} · ${margin}`;
}

export default async function ReportsPage(props: {
  searchParams: Promise<{
    period?: string;
    from?: string;
    to?: string;
    grain?: string;
    open?: string;
  }>;
}) {
  const {
    period: periodParam,
    from = "",
    to = "",
    grain: grainParam,
    open: openParam,
  } = await props.searchParams;
  const user = await currentUser();
  if (!user) redirect("/login");
  // Bounce anybody without it before a single cost or profit query runs. The
  // owner has it by being the owner; anybody else has it only by name.
  if (!can(user, "cost")) redirect("/");
  await requirePermission("cost");

  const today = businessDate();

  /*
    One period, read by everything below it, and stated on the screen.

    Every figure here was once the current month, chosen in the code and said
    nowhere — so "sales 214,000" answered a question the owner had not asked.
  */
  const period: Period = isPeriod(periodParam) ? periodParam : "month";
  /*
    Held inside the books here rather than only inside each query.

    "This year" on a shop whose books start in July is not a year, and a screen
    headed "1 Jan – 26 Sept" above a chart that begins in July invites exactly
    the question the books-start line was written to answer. Clamping once, at
    the top, means the picker, every heading, the chart and the export all name
    the same span — the one the figures actually cover.
  */
  const asked = periodRange(period, today, from, to);
  const range = clampRange(asked);
  const periodName = describeRange(range);
  const grainChoice = isGrain(grainParam) ? grainParam : undefined;
  /*
    One link that unfolds the whole report.

    The folds remember themselves in the browser, which is right for daily use
    and wrong for two cases: printing, where a browser will not print what a
    fold is hiding, and the morning somebody wants the old everything-at-once
    report. Both are answered by a link rather than by a setting: ?open=all
    renders every section open, server-side, and does not touch what this
    browser remembers.
  */
  const openAll = openParam === "all";
  const books = booksStart();

  /*
    Dates that end before the books begin.

    Clamping an already-impossible range leaves `from` after `to`, and the page
    used to render that as a wall of honest zeroes headed "20 Jul – 30 Jun" —
    an impossible span, a "0 days before it", and nothing anywhere saying why.
    One sentence and the picker is the whole answer.
  */
  if (range.from > range.to) {
    return (
      <div>
        <PageTitle
          title="Reports"
          subtitle="Owner only · costs and profit are never shown to staff"
        />
        <PeriodPicker current={period} range={asked} from={from} to={to} />
        <Alert tone="warn">
          These books start on {formatDate(books)}, the day the shop was cleared and this system
          took over. {describeRange(asked)} ends before that, so there is nothing recorded to
          report. Pick dates on or after {formatDate(books)}.
        </Alert>
      </div>
    );
  }

  const d = dashboard(range, grainChoice);

  const products = profitPerProduct(range);
  const losers = products.filter((p) => p.profit_cents < 0);
  const lines = businessLineSplit(range);
  const customers = topCustomers(range, 5);
  const discounts = discountSummary(range);
  const byPerson = discountsByPerson(range);
  const byItem = discountsByItem(range);
  const discountedBills = discountedSales(range, 12);
  const dead = deadStock(60);
  const deadValue = dead.reduce((sum, x) => sum + x.value_cents, 0);
  const shrink = shrinkageByMonth(6, today);
  const months = monthlySales(6, today);
  const days = dailyProfit(range);

  // The whole book, for the one question a period can never answer: is this
  // shop, taken altogether, ahead?
  const everything = { from: books || "2000-01-01", to: today };
  const allTime = profitSummary(everything);
  const allDays = dailyProfit(everything);
  const tradingDays = allDays.filter((x) => x.saleCount > 0).length;

  const salesSpark = d.trend.points.map((p) => p.salesCents);
  const grossSpark = d.trend.points.map((p) => p.grossProfitCents);
  const netSpark = d.trend.points.map((p) => p.netProfitCents);

  const hrefWith = (extra: Record<string, string | undefined>) => {
    const q = new URLSearchParams({ period });
    if (period === "custom") {
      q.set("from", range.from);
      q.set("to", range.to);
    }
    if (grainChoice) q.set("grain", grainChoice);
    if (openAll) q.set("open", "all");
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined) q.delete(k);
      else q.set(k, v);
    }
    return `/reports?${q.toString()}`;
  };
  const grainHref = (g: Grain) => hrefWith({ grain: g });

  /*
    WHAT NEEDS ATTENTION, worked out rather than written.

    A dashboard that only totals things leaves the owner to notice what is
    wrong, which is the one job a screen can do better than a person: it can
    check all nine things every time. Each entry is a fact with an amount and a
    link to the screen that fixes it — never "review your stock levels".
  */
  const watch: Array<{ tone: "bad" | "warn" | "neutral"; href?: string; body: ReactNode }> = [];

  if (d.summary.uncostedSalesCents > 0) {
    watch.push({
      tone: "bad",
      href: "/purchases",
      body: (
        <>
          <strong>{formatKes(d.summary.uncostedSalesCents)} of these sales have no cost price</strong>{" "}
          — they are counted as pure profit above, which they are not. Record what those goods cost
          on the delivery, and every profit figure on this page comes right.
        </>
      ),
    });
  }
  if (losers.length) {
    watch.push({
      tone: "bad",
      href: `${hrefWith({ open: "all" })}#earns`,
      body: (
        <>
          <strong>
            {losers.length} {losers.length === 1 ? "product sold" : "products sold"} below cost
          </strong>{" "}
          — {losers.map((p) => `${p.name} (${formatKes(p.profit_cents)})`).join(", ")}. Either the
          price is too low or the cost on file is wrong.
        </>
      ),
    });
  }
  if (d.shelf.owedCount > 0) {
    watch.push({
      tone: "bad",
      href: "/stock",
      body: (
        <>
          <strong>
            {d.shelf.owedCount} {d.shelf.owedCount === 1 ? "item shows" : "items show"} below zero
          </strong>{" "}
          — sold and not yet replaced. Until the delivery is entered, their cost is a guess.
        </>
      ),
    });
  }
  if (d.debtors.totalCents > 0) {
    watch.push({
      tone: d.debtors.oldestDays >= 30 ? "bad" : "warn",
      href: "/wholesale/debts",
      body: (
        <>
          <strong>{formatKes(d.debtors.totalCents)} owed by {d.debtors.customerCount}</strong>{" "}
          {d.debtors.customerCount === 1 ? "customer" : "customers"} — the oldest unpaid bill is{" "}
          {d.debtors.oldestDays} {d.debtors.oldestDays === 1 ? "day" : "days"} old.
        </>
      ),
    });
  }
  if (d.shelf.lowCount > 0) {
    watch.push({
      tone: "warn",
      href: "/stock",
      body: (
        <>
          <strong>
            {d.shelf.lowCount} {d.shelf.lowCount === 1 ? "item is" : "items are"} at or under the
            level you set
          </strong>{" "}
          — order before they run out, not after a customer asks.
        </>
      ),
    });
  }
  if (d.shelf.uncostedCount > 0) {
    watch.push({
      tone: "warn",
      href: "/items",
      body: (
        <>
          <strong>
            {d.shelf.uncostedCount === 1
              ? "1 item on the shelf has"
              : `${d.shelf.uncostedCount} items on the shelf have`}{" "}
            no cost price
          </strong>{" "}
          — until there is one, nothing{" "}
          {d.shelf.uncostedCount === 1 ? "it earns is" : "they earn is"} knowable.
        </>
      ),
    });
  }
  if (discounts.belowFloorLines > 0) {
    watch.push({
      tone: "warn",
      href: `${hrefWith({ open: "all" })}#discounts`,
      body: (
        <>
          <strong>
            {discounts.belowFloorLines}{" "}
            {discounts.belowFloorLines === 1 ? "line went" : "lines went"} under your minimum price
          </strong>{" "}
          — each one needed your PIN, so each one is a moment you were asked and said yes.
        </>
      ),
    });
  }
  if (deadValue > 0) {
    watch.push({
      tone: "neutral",
      href: `${hrefWith({ open: "all" })}#leaks`,
      body: (
        <>
          <strong>{formatKes(deadValue)} has not moved in 60 days</strong> — cash sitting on the
          shelf across {dead.length} {dead.length === 1 ? "item" : "items"}.
        </>
      ),
    });
  }
  const lastShrink = shrink.find((s) => s.value_cents < 0);
  if (lastShrink) {
    watch.push({
      tone: "neutral",
      href: `${hrefWith({ open: "all" })}#leaks`,
      body: (
        <>
          <strong>{formatKes(Math.abs(lastShrink.value_cents))} short at the last count</strong> —{" "}
          {lastShrink.label} {lastShrink.ym.slice(0, 4)}. A small gap is ordinary; one that grows
          month on month is not.
        </>
      ),
    });
  }


  /*
    A line of what is inside each fold, shown while it is shut.

    The whole point of folding is that the owner should not have to open a
    section to find out whether it is worth opening. "26 trading days · best
    7 Sept 2026" is frequently the entire answer, and the fold never gets
    opened at all — which is the screen doing its job.
  */
  const move = (now: number, before: number) => {
    const c = change(now, before);
    return c === null ? "nothing to compare" : `${c > 0 ? "+" : ""}${c.toFixed(0)}%`;
  };
  const shrinkTotal = shrink.reduce((n, x) => n + Math.min(0, x.value_cents), 0);
  const hints = {
    compare: `sales ${move(d.now.salesCents, d.before.salesCents)} · net profit ${move(
      d.now.netProfitCents,
      d.before.netProfitCents,
    )}`,
    people:
      (d.debtors.totalCents > 0
        ? `${formatKesRounded(d.debtors.totalCents)} owed by ${d.debtors.customerCount}`
        : "nobody owes anything") +
      (customers.length ? ` · best customer ${customers[0].name}` : ""),
    earns: products.length
      ? `${products[0].name} leads at ${formatKesRounded(products[0].profit_cents)}` +
        (losers.length ? ` · ${losers.length} below cost` : "")
      : "nothing sold in this period",
    days: days.length
      ? `${periodName} · ${days.length} ${days.length === 1 ? "day" : "days"}` +
        (d.bestDay ? ` · best ${formatDate(d.bestDay.date)}` : "")
      : `${periodName} · nothing traded`,
    book:
      (books ? `since ${formatDate(books)} · ` : "") +
      `${formatKesRounded(allTime.salesCents)} sold · ${formatKesRounded(
        allTime.netProfitCents,
      )} kept`,
    discounts:
      discounts.discountCents > 0
        ? `${formatKesRounded(discounts.discountCents)} given away · ${discounts.pct.toFixed(
            1,
          )}% of what was asked`
        : "nothing went under its asking price",
    leaks:
      dead.length || shrinkTotal < 0
        ? [
            dead.length ? `${formatKesRounded(deadValue)} not moving` : "",
            shrinkTotal < 0 ? `${formatKesRounded(Math.abs(shrinkTotal))} short at the counts` : "",
          ]
            .filter(Boolean)
            .join(" · ")
        : "nothing dead, nothing short",
    export: "PDF, spreadsheets and a full backup",
  };

  return (
    <div>
      <PageTitle
        title="Reports"
        subtitle="Owner only · costs and profit are never shown to staff"
      />
      <PeriodPicker current={period} range={range} from={from} to={to} />

      {/*
        Where the books start, said on the screen that counts from it.

        Without this line the figures are a claim with no scope: the shop was
        trialled, emptied and started again, and a month that quietly includes
        the practice trading is a month the owner is right to distrust.
      */}
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1">
        {books ? (
          <p className="text-xs text-muted">
            These books start on <span className="font-bold text-ink">{formatDate(books)}</span> —
            the day the shop was cleared and this system took over. Nothing before it is counted.{" "}
            <Link href="/settings" className="font-bold text-brand">
              Change
            </Link>
          </p>
        ) : (
          <p className="text-xs text-muted">
            Counting everything ever recorded, including any trial run.{" "}
            <Link href="/settings" className="font-bold text-brand">
              Set the day the books start
            </Link>{" "}
            to leave the practice figures out.
          </p>
        )}

        {/* The one control for the folds below. It is also how the report is
            printed: a browser will not print what a fold is hiding. */}
        <Link
          href={hrefWith({ open: openAll ? undefined : "all" })}
          className="no-print shrink-0 text-xs font-bold text-brand"
        >
          {openAll ? "Back to the short view" : "Open every section"}
        </Link>
      </div>

      {/* ------------------------------------------------------- right now */}

      <SectionLabel>Right now · {formatDate(today)}</SectionLabel>
      <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4 xl:gap-3">
        <Tile
          label="Sales today"
          value={formatKesRounded(d.today.salesCents)}
          detail={`${d.today.saleCount} ${d.today.saleCount === 1 ? "sale" : "sales"}${
            d.today.saleCount ? ` · ${formatKesRounded(d.today.averageSaleCents)} average` : ""
          }`}
          href="/sales"
        />
        <Tile
          label="Profit today"
          value={formatKesRounded(d.today.netProfitCents)}
          tone={d.today.netProfitCents < 0 ? "bad" : "good"}
          detail="after cost of goods and expenses"
          href="/day-close"
        />
        <Tile
          label="Owed to the shop"
          value={formatKesRounded(d.debtors.totalCents)}
          tone={d.debtors.totalCents > 0 ? "bad" : "plain"}
          detail={
            d.debtors.totalCents > 0
              ? `${d.debtors.customerCount} ${
                  d.debtors.customerCount === 1 ? "customer" : "customers"
                } · oldest ${d.debtors.oldestDays} days`
              : "nothing outstanding"
          }
          href="/wholesale/debts"
        />
        <Tile
          label="On the shelf, at cost"
          value={formatKesRounded(d.shelf.atCostCents)}
          detail={`worth ${formatKesRounded(d.shelf.atRetailCents)} at today's prices`}
          href="/stock"
        />
      </div>

      {/* --------------------------------------------------- the period */}

      <SectionLabel>
        {periodName} · {d.days === 1 ? "against yesterday" : `against the ${d.days} days before it`}
      </SectionLabel>
      <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4 xl:gap-3">
        <Tile
          label="Sales"
          value={formatKesRounded(d.now.salesCents)}
          delta={change(d.now.salesCents, d.before.salesCents)}
          detail={`${d.now.saleCount} ${
            d.now.saleCount === 1 ? "sale" : "sales"
          } · ${formatKesRounded(d.now.averageSaleCents)} average`}
          spark={salesSpark}
        />
        <Tile
          label="Gross profit"
          value={formatKesRounded(d.now.grossProfitCents)}
          delta={change(d.now.grossProfitCents, d.before.grossProfitCents)}
          detail={`after ${formatKesRounded(d.now.cogsCents)} of goods`}
          spark={grossSpark}
          sparkTone="good"
        />
        <Tile
          label="Net profit"
          value={formatKesRounded(d.now.netProfitCents)}
          tone={d.now.netProfitCents < 0 ? "bad" : "good"}
          delta={change(d.now.netProfitCents, d.before.netProfitCents)}
          detail={`after ${formatKesRounded(d.now.expensesCents)} of expenses`}
          spark={netSpark}
          sparkTone={d.now.netProfitCents < 0 ? "bad" : "good"}
        />
        <Tile
          label="Margin"
          value={`${d.now.marginPct.toFixed(1)}%`}
          delta={d.before.salesCents > 0 ? d.now.marginPct - d.before.marginPct : null}
          deltaUnit="pts"
          detail={
            d.before.salesCents > 0
              ? `was ${d.before.marginPct.toFixed(1)}% before`
              : "gross profit as a share of sales"
          }
        />
      </div>

      <p className="mt-2.5 text-xs text-muted">
        {d.now.saleCount === 0 ? (
          <>Nothing was sold in this period.</>
        ) : (
          <>
            {d.days === 1 ? (
              <>
                {d.now.saleCount} {d.now.saleCount === 1 ? "sale" : "sales"} today, averaging{" "}
                <span className="font-bold text-ink">
                  {formatKesRounded(d.now.averageSaleCents)}
                </span>
                .{" "}
              </>
            ) : (
              <>
                {formatKesRounded(d.now.salesCents)} over {d.days} days — about{" "}
                <span className="font-bold text-ink">
                  {formatKesRounded(Math.round(d.now.salesCents / d.days))}
                </span>{" "}
                a day.{" "}
                {d.bestDay ? (
                  <>
                    The best day was {formatDate(d.bestDay.date)} at{" "}
                    {formatKesRounded(d.bestDay.salesCents)}.{" "}
                  </>
                ) : null}
              </>
            )}
            Net profit is {pct(d.now.netProfitCents, d.now.salesCents).toFixed(1)}% of sales.
          </>
        )}
      </p>

      {/* --------------------------------------------------- attention */}

      <SectionLabel>Needs your attention</SectionLabel>
      {watch.length ? (
        <Card className="!py-2">
          {watch.map((w, i) => (
            <WatchRow key={i} tone={w.tone} href={w.href}>
              {w.body}
            </WatchRow>
          ))}
        </Card>
      ) : (
        <Alert tone="good">
          Nothing needs your attention. Every product has a cost price, nothing is selling below
          cost, no bill is unpaid and no shelf is short.
        </Alert>
      )}

      {/* --------------------------------------------------- trend + money */}

      <div className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-x-4 xl:gap-x-5">
        <div className="lg:col-span-7 2xl:col-span-8">
          <SectionLabel>How it is going</SectionLabel>
          <Card>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-brand-deep">Sales and profit · {periodName}</h3>
              {/* Daily, weekly, monthly — the owner decides, not the code. The
                  default follows the span so a year is never 365 bars. */}
              <div className="no-print flex gap-1">
                {GRAINS.map((g) => (
                  <Link
                    key={g}
                    href={grainHref(g)}
                    aria-current={d.trend.grain === g ? "true" : undefined}
                    className={`flex min-h-8 items-center rounded-full px-2.5 text-[11px] font-bold ${
                      d.trend.grain === g
                        ? "bg-brand text-white"
                        : "bg-wash text-muted ring-1 ring-inset ring-line hover:text-ink"
                    }`}
                  >
                    {GRAIN_LABEL[g]}
                  </Link>
                ))}
              </div>
            </div>
            <TrendChart points={d.trend.points} grain={d.trend.grain} />
          </Card>
        </div>

        <div className="lg:col-span-5 2xl:col-span-4">
          <SectionLabel>Money in</SectionLabel>
          <Card>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-bold text-brand-deep">
                {formatKes(d.money.totalCollectedCents)} collected
              </h3>
              <span className="text-[11px] font-semibold text-muted">by the day it arrived</span>
            </div>
            <div className="mt-3">
              <SplitBar
                parts={[
                  { label: "Cash", cents: d.money.cashCents, className: "bg-brand" },
                  { label: "M-Pesa", cents: d.money.mpesaCents, className: "bg-leaf" },
                ]}
              />
            </div>
            <dl className="mt-3 space-y-1.5 border-t border-line pt-2.5 text-[13px]">
              <MoneyRow
                label="Of it, old bills settled"
                value={formatKes(d.money.settledOldCents)}
              />
              <MoneyRow
                label="Credit given on the day"
                value={formatKes(d.money.creditGivenCents)}
              />
              <MoneyRow
                label="Of this period's sales, still unpaid"
                value={formatKes(d.money.stillOwedCents)}
                tone={d.money.stillOwedCents > 0 ? "bad" : undefined}
              />
            </dl>
            <p className="mt-2.5 text-[11px] leading-snug text-muted">
              Sales are counted on the day the goods left; money on the day it arrived. The two
              differ by the credit given and the old debts paid off — which is why both are here
              rather than one figure pretending to be both.
            </p>
          </Card>
        </div>
      </div>

      {/* ----------------------------------------------- everything else, folded */}

      {/*
        The same period, side by side with the one before it.

        The tiles carry the movement as an arrow; this is the arithmetic under
        the arrow, for the owner who wants to see it and for the printed copy
        that goes to the bank.
      */}
      <Fold
        id="compare"
        title="This period against the one before"
        hint={hints.compare}
        force={openAll}
      >
        <TableWrap>
            <thead>
              <tr>
                <Th>Figure</Th>
                <Th align="right">{periodName}</Th>
                <Th align="right">{describeRange(d.previous)}</Th>
                <Th align="right">Change</Th>
              </tr>
            </thead>
            <tbody>
              <CompareRow label="Sales" now={d.now.salesCents} before={d.before.salesCents} />
              <CompareRow
                label="Cost of goods sold"
                now={d.now.cogsCents}
                before={d.before.cogsCents}
                invert
              />
              <CompareRow
                label="Gross profit"
                now={d.now.grossProfitCents}
                before={d.before.grossProfitCents}
                strong
              />
              <CompareRow
                label="Expenses"
                now={d.now.expensesCents}
                before={d.before.expensesCents}
                invert
              />
              <CompareRow
                label="Net profit"
                now={d.now.netProfitCents}
                before={d.before.netProfitCents}
                strong
              />
              <CompareRow
                label="Sales rung up"
                now={d.now.saleCount}
                before={d.before.saleCount}
                money={false}
              />
              <CompareRow
                label="Average sale"
                now={d.now.averageSaleCents}
                before={d.before.averageSaleCents}
              />
            </tbody>
          </TableWrap>
          {d.summary.uncostedSalesCents > 0 || d.summary.estimatedCostCents > 0 ? (
            <p className="mt-1.5 text-xs text-muted">
              {d.summary.uncostedSalesCents > 0 ? (
                <>
                  {formatKes(d.summary.uncostedSalesCents)} of these sales have no cost price at all
                  and are counted as pure profit above.{" "}
                </>
              ) : null}
              {d.summary.estimatedCostCents > 0 ? (
                <>
                  {formatKes(d.summary.estimatedCostCents)} of the cost is valued at what those
                  goods cost today, because no cost was recorded when they were sold.
                </>
              ) : null}
            </p>
          ) : null}
      </Fold>

      <Fold id="people" title="Who owes, and who buys" hint={hints.people} force={openAll}>
        <div className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-x-4 xl:gap-x-5">
          <div className="lg:col-span-6">
            <h3 className="mb-2 text-sm font-bold text-brand-deep">Who owes</h3>
          {d.debtors.top.length ? (
            <Card className="!py-2.5">
              {d.debtors.top.map((c) => (
                <RankRow
                  key={c.id}
                  name={c.name}
                  value={formatKes(c.owedCents)}
                  share={c.owedCents / Math.max(1, d.debtors.top[0].owedCents)}
                  meta={`oldest bill ${c.oldestDays} ${c.oldestDays === 1 ? "day" : "days"} old`}
                  tone={c.oldestDays >= 30 ? "bad" : "brand"}
                  href={`/customers/${c.id}`}
                />
              ))}
              {d.debtors.customerCount > d.debtors.top.length ? (
                <p className="px-2.5 pt-1.5 text-[11px] text-muted">
                  and {d.debtors.customerCount - d.debtors.top.length} more ·{" "}
                  <Link href="/wholesale/debts" className="font-bold text-brand">
                    see all
                  </Link>
                </p>
              ) : null}
            </Card>
          ) : (
            <Card>
              <Empty>Nobody owes the shop anything.</Empty>
            </Card>
          )}
          </div>
          <div className="mt-3 lg:col-span-6 lg:mt-0">
            <h3 className="mb-2 text-sm font-bold text-brand-deep">Who buys most</h3>
          {customers.length ? (
            <Card className="!py-2.5">
              {customers.map((c) => (
                <RankRow
                  key={c.id ?? "walk-in"}
                  name={c.name}
                  value={formatKes(c.salesCents)}
                  share={c.salesCents / Math.max(1, customers[0].salesCents)}
                  meta={`${c.saleCount} ${c.saleCount === 1 ? "sale" : "sales"} · ${pct(
                    c.salesCents,
                    d.now.salesCents,
                  ).toFixed(0)}% of the period`}
                  href={c.id ? `/customers/${c.id}` : undefined}
                />
              ))}
            </Card>
          ) : (
            <Card>
              <Empty>Nothing sold in this period.</Empty>
            </Card>
          )}
          </div>
        </div>
      </Fold>

      {/* --------------------------------------------------- what earns */}

      <Fold
        id="earns"
        anchor="earns"
        title="What earns"
        hint={hints.earns}
        defaultOpen
        force={openAll}
      >
        <div className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-x-4 xl:gap-x-5">
        <div className="lg:col-span-7 2xl:col-span-8">
          {losers.length ? (
            <div className="mb-2">
              <Alert tone="bad">
                <strong>Losing money:</strong>{" "}
                {losers.map((p) => `${p.name} (${formatKes(p.profit_cents)})`).join(", ")}.{" "}
                {losers.some((p) => p.estimated)
                  ? "Each row below says what it sold at and what it is costed at, per kg or litre. Where the cost is an estimate, the loss may be the cost price rather than the selling price — check it on the delivery, or under Products and prices."
                  : "Check the price or the cost."}
              </Alert>
            </div>
          ) : null}
          {products.length ? (
            <Card className="!py-2.5">
              {products.slice(0, 10).map((p) => (
                <RankRow
                  key={`${p.item_id}-${p.name}`}
                  name={p.name}
                  value={`${formatKes(p.profit_cents)} profit`}
                  share={
                    Math.abs(p.profit_cents) /
                    Math.max(1, ...products.map((x) => Math.abs(x.profit_cents)))
                  }
                  meta={productMeta(p)}
                  tone={p.profit_cents < 0 ? "bad" : "good"}
                />
              ))}
              {products.length > 10 ? (
                <details className="pt-2">
                  <summary className="cursor-pointer px-2.5 text-sm font-bold text-brand-dark">
                    All {products.length} products
                  </summary>
                  <div className="mt-1">
                    {products.slice(10).map((p) => (
                      <RankRow
                        key={`${p.item_id}-${p.name}`}
                        name={p.name}
                        value={`${formatKes(p.profit_cents)} profit`}
                        share={
                          Math.abs(p.profit_cents) /
                          Math.max(1, ...products.map((x) => Math.abs(x.profit_cents)))
                        }
                        meta={productMeta(p)}
                        tone={p.profit_cents < 0 ? "bad" : "good"}
                      />
                    ))}
                  </div>
                </details>
              ) : null}
            </Card>
          ) : (
            <Card>
              <Empty>Nothing sold in this period, so there is nothing to rank.</Empty>
            </Card>
          )}
          <p className="mt-1.5 text-xs text-muted">
            Prices and costs are the ones recorded on each sale. Changing a price today never
            changes what a past month earned.
          </p>
        </div>

        <div className="mt-3 lg:col-span-5 lg:mt-0 2xl:col-span-4">
          <h3 className="mb-2 text-sm font-bold text-brand-deep">Which line earns</h3>
          {lines.length ? (
            <Card>
              <SplitBar
                parts={lines.map((l, i) => ({
                  label: l.line,
                  cents: l.revenue_cents,
                  className: ["bg-brand", "bg-leaf", "bg-warn"][i % 3],
                }))}
              />
              <div className="mt-3 space-y-2 border-t border-line pt-2.5">
                {lines.map((l) => (
                  <div key={l.line} className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] font-semibold">{l.line}</span>
                    <span className="flex items-baseline gap-2">
                      <span className="text-[13px] font-bold tnum">
                        {formatKes(l.profit_cents)}
                      </span>
                      <Chip
                        tone={l.margin_pct >= 25 ? "good" : l.margin_pct >= 10 ? "warn" : "bad"}
                      >
                        {l.margin_pct.toFixed(1)}%
                      </Chip>
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-2.5 text-[11px] text-muted">
                The bar is the share of sales; the figure beside each name is the profit it kept,
                and the chip its margin.
              </p>
            </Card>
          ) : (
            <Card>
              <Empty>Nothing sold in this period, so there is no split to show.</Empty>
            </Card>
          )}
        </div>
        </div>
      </Fold>

      {/* --------------------------------------------------- day by day */}

      {/*
        DAY BY DAY, NOT ONE LUMP.

        A month's total answers "did we make money" and nothing else. The
        question actually asked of this screen is "which days" — because that is
        the one that can be acted on. A Tuesday that lost money has an
        explanation somewhere; a month that made money has none, and hides every
        Tuesday inside it.
      */}
      <Fold id="days" title="Day by day" hint={hints.days} force={openAll}>
      {days.length ? (
        <div className="overflow-x-auto">
          <TableWrap>
            <thead>
              <tr>
                <Th>Day</Th>
                <Th align="right">Sales</Th>
                <Th align="right">Cost</Th>
                <Th align="right">Expenses</Th>
                <Th align="right">Net profit</Th>
              </tr>
            </thead>
            <tbody>
              {days.map((x) => (
                <tr key={x.date} className="hover:bg-wash/50">
                  <Td className="whitespace-nowrap">
                    <span className="font-semibold">{formatDate(x.date)}</span>
                    <span className="ml-1.5 text-[11px] text-muted">
                      {x.saleCount} {x.saleCount === 1 ? "sale" : "sales"}
                    </span>
                  </Td>
                  <Td align="right" className="whitespace-nowrap tnum">
                    {formatKes(x.salesCents)}
                  </Td>
                  <Td align="right" className="whitespace-nowrap tnum text-muted">
                    {x.cogsCents ? `− ${formatKes(x.cogsCents)}` : "—"}
                  </Td>
                  <Td align="right" className="whitespace-nowrap tnum text-muted">
                    {x.expensesCents ? `− ${formatKes(x.expensesCents)}` : "—"}
                  </Td>
                  <Td align="right" className="whitespace-nowrap tnum font-bold">
                    <span className={x.netProfitCents < 0 ? "text-bad" : "text-good"}>
                      {formatKes(x.netProfitCents)}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
      ) : (
        <Card>
          <Empty>Nothing traded in this period.</Empty>
        </Card>
      )}
      </Fold>

      {/* --------------------------------------------------- the long view */}

      <Fold
        id="book"
        title="The whole book"
        hint={hints.book}
        force={openAll}
      >
      <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4 xl:gap-3">
        <Tile label="Sales, all of them" value={formatKesRounded(allTime.salesCents)} />
        <Tile label="Gross profit" value={formatKesRounded(allTime.grossProfitCents)} />
        <Tile
          label="Net profit"
          value={formatKesRounded(allTime.netProfitCents)}
          tone={allTime.netProfitCents < 0 ? "bad" : "good"}
          detail={
            allTime.salesCents > 0
              ? `${pct(allTime.netProfitCents, allTime.salesCents).toFixed(1)}% of sales`
              : undefined
          }
        />
        <Tile
          label="Days traded"
          value={String(tradingDays)}
          detail={
            tradingDays > 0
              ? `${formatKesRounded(Math.round(allTime.salesCents / tradingDays))} on an average day`
              : "no trading recorded yet"
          }
        />
      </div>

      <div className="mt-3 lg:grid lg:grid-cols-12 lg:items-start lg:gap-x-4 xl:gap-x-5">
        <div className="lg:col-span-7 2xl:col-span-8">
          <Card>
            <h3 className="mb-2 text-sm font-bold text-brand-deep">Last 6 months</h3>
            <SalesChart
              data={months.map((m) => ({ ym: m.ym, label: m.label, salesCents: m.salesCents }))}
            />
          </Card>
        </div>
        <div className="mt-3 lg:col-span-5 lg:mt-0 2xl:col-span-4">
          <Card>
            <h3 className="text-sm font-bold text-brand-deep">What the shelf is holding</h3>
            <div className="mt-2.5 grid grid-cols-3 gap-2">
              <Figure label="At cost" value={formatKesRounded(d.shelf.atCostCents)} />
              <Figure label="At today's prices" value={formatKes(d.shelf.atRetailCents)} />
              <Figure
                label="Profit in it"
                value={formatKes(d.shelf.atRetailCents - d.shelf.atCostCents)}
                strong
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Chip tone={d.shelf.lowCount ? "warn" : "good"}>
                {d.shelf.lowCount} running low
              </Chip>
              <Chip tone={d.shelf.owedCount ? "bad" : "good"}>
                {d.shelf.owedCount} below zero
              </Chip>
              <Chip tone={d.shelf.uncostedCount ? "warn" : "good"}>
                {d.shelf.uncostedCount} without a cost price
              </Chip>
            </div>
            <p className="mt-2.5 text-[11px] leading-snug text-muted">
              Cost is the weighted average of what was actually paid for what is still on the
              shelf. The third figure is what it would earn if all of it sold at today’s asking
              prices — money the shop is holding rather than money it has made.
            </p>
            <Link href="/stock" className="mt-2 inline-block text-[12px] font-bold text-brand">
              Open stock
            </Link>
          </Card>
        </div>
      </div>
      </Fold>

      {/* --------------------------------------------------- leaks */}

      {/*
        Haggling, as a number.

        Prices here are negotiated — an attendant who cannot come down loses the
        sale — so none of this is here to stop it. It is here because twenty
        shillings off a kilo, fifty times a month, is the difference between a
        good month and a flat one, and until the asking price was recorded on
        each line the only trace of it was a sentence in the activity log.

        Every figure is the same subtraction: what the lines would have come to
        at the price the shop was ASKING when they were rung up, less what was
        actually charged. Nothing re-reads today's shelf price, so last month's
        discount does not move when this week's price does.
      */}
      <Fold
        id="discounts"
        anchor="discounts"
        title="Discounts given"
        hint={hints.discounts}
        force={openAll}
      >
      {discounts.discountCents > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4 xl:gap-3">
            <Tile
              label="Given away"
              value={formatKesRounded(discounts.discountCents)}
              tone="bad"
              detail={`${discounts.pct.toFixed(1)}% of what was asked`}
            />
            <Tile
              label="Asked"
              value={formatKesRounded(discounts.atListCents)}
              detail="at the shelf price of the day"
            />
            <Tile
              label="Lines cut"
              value={String(discounts.lines)}
              detail={`across ${
                discountedBills.length >= 12 ? "12 or more" : discountedBills.length
              } bills`}
            />
            {/* The one figure that is a control rather than a fact: below the
                floor is the price the owner said nobody may go under without
                him, so each of these is a moment he was asked and said yes. */}
            <Tile
              label="Below the floor"
              value={String(discounts.belowFloorLines)}
              tone={discounts.belowFloorLines ? "bad" : "plain"}
              detail={
                discounts.belowFloorLines ? "each needed your PIN" : "none went under your minimum"
              }
            />
          </div>

          <details className="mt-3">
            <summary className="cursor-pointer text-[13px] font-bold text-brand">
              Who agreed them, and on what
            </summary>
            <div className="mt-2 lg:grid lg:grid-cols-12 lg:items-start lg:gap-x-4">
              <div className="lg:col-span-4">
                <p className="mb-1.5 text-xs text-muted">
                  Who agreed them. A good attendant discounts — the one who never does may be
                  losing the sale instead.
                </p>
                <Card className="!py-2.5">
                  {byPerson.length ? (
                    byPerson.map((r) => (
                      <ListRow
                        key={r.user_id ?? "none"}
                        title={r.user_name ?? "Not recorded"}
                        value={formatKes(r.discount_cents)}
                        valueTone="bad"
                        meta={`${pct(r.discount_cents, r.at_list_cents).toFixed(1)}% off · ${
                          r.lines
                        } line${r.lines === 1 ? "" : "s"} on ${r.sales} bill${
                          r.sales === 1 ? "" : "s"
                        }`}
                      />
                    ))
                  ) : (
                    <Empty>Nobody is recorded against these.</Empty>
                  )}
                </Card>
              </div>
              <div className="mt-3 lg:col-span-4 lg:mt-0">
                <p className="mb-1.5 text-xs text-muted">
                  What gets argued down. A chemical discounted on nearly every sale is usually a
                  shelf price nobody believes — change the price rather than override it.
                </p>
                <Card className="!py-2.5">
                  {byItem.length ? (
                    byItem.map((r) => (
                      <ListRow
                        key={r.item_id ?? r.name}
                        title={r.name}
                        value={formatKes(r.discount_cents)}
                        valueTone="bad"
                        meta={`${pct(r.discount_cents, r.at_list_cents).toFixed(1)}% off · ${
                          r.lines
                        } line${r.lines === 1 ? "" : "s"}`}
                      />
                    ))
                  ) : (
                    <Empty>No single item stands out.</Empty>
                  )}
                </Card>
              </div>
              <div className="mt-3 lg:col-span-4 lg:mt-0">
                <p className="mb-1.5 text-xs text-muted">The bills those came off.</p>
                <Card className="!py-2.5">
                  {discountedBills.length ? (
                    discountedBills.map((b) => (
                      <ListRow
                        key={b.sale_id}
                        href={`/invoice/${b.sale_id}`}
                        title={b.invoice_no ?? `Sale #${b.sale_id}`}
                        value={formatKes(b.discount_cents)}
                        valueTone="bad"
                        meta={`${formatDate(b.at)} · ${b.customer_name ?? "Walk-in"} · ${
                          b.user_name ?? "not recorded"
                        } · bill ${formatKes(b.total_cents)}`}
                      />
                    ))
                  ) : (
                    <Empty>No bill carries a discount.</Empty>
                  )}
                </Card>
              </div>
            </div>
          </details>
        </>
      ) : (
        <Card>
          <Empty>Nothing was sold under its asking price in this period.</Empty>
        </Card>
      )}
      </Fold>

      <Fold id="leaks" anchor="leaks" title="Dead stock and shrinkage" hint={hints.leaks} force={openAll}>
      <div className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-x-4 xl:gap-x-5">
        <div className="lg:col-span-7 2xl:col-span-8">
          <h3 className="mb-2 text-sm font-bold text-brand-deep">
            Dead stock · nothing sold in 60 days
          </h3>
          {dead.length ? (
            <>
              <p className="mb-1.5 text-xs text-muted">
                <span className="font-bold tnum">{formatKes(deadValue)}</span> of cash is sitting on
                these shelves, valued at what it cost.
              </p>
              <TableWrap>
                <thead>
                  <tr>
                    <Th>Item</Th>
                    <Th align="right">On hand</Th>
                    <Th align="right">At cost</Th>
                    <Th>Last sold</Th>
                  </tr>
                </thead>
                <tbody>
                  {dead.map((x) => (
                    <tr key={x.id}>
                      <Td>{x.name}</Td>
                      <Td align="right">{formatQty(x.qty_milli, x.canonical_unit)}</Td>
                      <Td align="right">{formatKes(x.value_cents)}</Td>
                      <Td>
                        {x.last_sold_at ? (
                          formatDate(x.last_sold_at)
                        ) : (
                          <span className="text-muted">never</span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </>
          ) : (
            <Card>
              <Empty>Every item in stock has sold within the last 60 days.</Empty>
            </Card>
          )}
        </div>

        <div className="mt-3 lg:col-span-5 lg:mt-0 2xl:col-span-4">
          <h3 className="mb-2 text-sm font-bold text-brand-deep">
            Shrinkage · what the count says the book missed
          </h3>
          {shrink.some((s) => s.milli !== 0 || s.value_cents !== 0) ? (
            <>
              <Card className="!py-2.5">
                {shrink
                  .filter((s) => s.milli !== 0 || s.value_cents !== 0)
                  .map((s) => (
                    <ListRow
                      key={s.ym}
                      title={`${s.label} ${s.ym.slice(0, 4)}`}
                      value={formatKes(s.value_cents)}
                      valueTone={s.value_cents < 0 ? "bad" : "plain"}
                      meta={`${(s.milli / 1000).toFixed(3)} kg/L lost or gained`}
                    />
                  ))}
              </Card>
              <p className="mt-1.5 text-xs text-muted">
                A small gap is ordinary — spillage, a scale that reads a little light. One that
                grows month on month is not.
              </p>
            </>
          ) : (
            <Card>
              <Empty>No shrinkage recorded in the last six months.</Empty>
            </Card>
          )}
        </div>
      </div>
      </Fold>

      <Fold id="export" title="Take it out" hint={hints.export} force={openAll}>
        <ExportBar range={range} />
        {/* A browser prints what is on the page, and a folded section is not
            on the page. Said here rather than discovered on the printout. */}
        <p className="no-print mt-2 text-xs text-muted">
          Printing takes the report as it stands, so anything folded away is left out.{" "}
          <Link href={hrefWith({ open: "all" })} className="font-bold text-brand">
            Open every section
          </Link>{" "}
          first for the full report.
        </p>
      </Fold>
    </div>
  );
}

/**
 * One line of the attention list: a word for how bad it is, the fact, and the
 * screen that fixes it.
 */
function WatchRow({
  tone,
  href,
  children,
}: {
  tone: "bad" | "warn" | "neutral";
  href?: string;
  children: ReactNode;
}) {
  const word = tone === "bad" ? "Fix" : tone === "warn" ? "Check" : "Note";
  const row = (
    <div className="flex items-start gap-2.5 border-t border-line px-1 py-2.5 first:border-t-0">
      <span className="shrink-0 pt-0.5">
        <Chip tone={tone}>{word}</Chip>
      </span>
      <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug">{children}</span>
      {href ? (
        <span aria-hidden className="shrink-0 pt-0.5 text-[12px] font-bold text-brand">
          →
        </span>
      ) : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block hover:bg-wash/60">
      {row}
    </Link>
  ) : (
    row
  );
}

/** One row of the period-against-period table. */
function CompareRow({
  label,
  now,
  before,
  strong,
  invert,
  money = true,
}: {
  label: string;
  now: number;
  before: number;
  strong?: boolean;
  invert?: boolean;
  money?: boolean;
}) {
  const show = (n: number) => (money ? formatKes(n) : String(n));
  const delta = change(now, before);
  return (
    <tr>
      <Td className={strong ? "font-bold" : undefined}>{label}</Td>
      <Td align="right" className={`whitespace-nowrap tnum ${strong ? "font-bold" : ""}`}>
        {show(now)}
      </Td>
      <Td align="right" className="whitespace-nowrap tnum text-muted">
        {show(before)}
      </Td>
      <Td align="right" className="whitespace-nowrap">
        {delta === null ? (
          <span className="text-[11px] font-semibold text-muted">—</span>
        ) : (
          <span
            className={`text-[12px] font-bold tnum ${
              Math.abs(delta) < 0.5
                ? "text-muted"
                : (invert ? delta < 0 : delta > 0)
                  ? "text-good"
                  : "text-bad"
            }`}
          >
            {delta > 0 ? "+" : ""}
            {delta.toFixed(0)}%
          </span>
        )}
      </Td>
    </tr>
  );
}

function MoneyRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "bad";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={`font-semibold tnum ${tone === "bad" ? "text-bad" : ""}`}>{value}</dd>
    </div>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className={`tnum ${strong ? "font-extrabold text-good" : "font-semibold"}`}>{value}</div>
    </div>
  );
}
