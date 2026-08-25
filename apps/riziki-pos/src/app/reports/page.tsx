/**
 * Reports — OWNER ONLY.
 *
 * Everything here is cost or profit, which staff must never see. The gate is
 * `requireOwner()` on the server, before a single figure is read, so a staff
 * session never receives the bytes; hiding a tab would still ship the data.
 *
 * Ordered by what the owner actually opens the app to find out:
 *   1. did I make money today, and this month?
 *   2. is the trend up or down?
 *   3. which products earn?
 *   4. which of my two businesses earns?
 *   5. what is my money sleeping in?
 *   6. what is leaking?
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser, requireOwner } from "@/lib/auth";
import { formatKes, formatQty, formatDate, businessDate, pct } from "@/lib/units";
import {
  monthKey,
  monthRange,
  dayRange,
  profitSummary,
  monthlySales,
  profitPerProduct,
  businessLineSplit,
  deadStock,
  shrinkageByMonth,
  EXPORT_TABLES,
} from "@/lib/reports";
import {
  PageTitle,
  Card,
  SectionLabel,
  Stat,
  TableWrap,
  Th,
  Td,
  Empty,
  Chip,
  Alert,
  ListRow,
} from "@/components/ui";
import { SalesChart } from "./sales-chart";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  // Bounce staff before any cost or profit query runs.
  if (user.role !== "owner") redirect("/");
  await requireOwner();

  const today = businessDate();
  const ym = monthKey(today);

  const todaySummary = profitSummary(dayRange(today));
  const monthSummary = profitSummary(monthRange(ym));
  const months = monthlySales(6, today);
  const products = profitPerProduct(monthRange(ym));
  const losers = products.filter((p) => p.profit_cents < 0);
  const lines = businessLineSplit(monthRange(ym));
  const dead = deadStock(60);
  const shrink = shrinkageByMonth(6, today);

  const monthName = new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const deadValue = dead.reduce((sum, d) => sum + d.value_cents, 0);

  return (
    <div>
      <PageTitle title="Reports" subtitle="Owner only · costs and profit are never shown to staff" />

      <div className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-x-4 xl:gap-x-5 2xl:gap-x-6">
      <div className="lg:col-span-5">
      <SectionLabel>Today</SectionLabel>
      <div className="grid grid-cols-2 gap-2 xl:gap-2.5">
        <Stat
          label="Sales"
          value={formatKes(todaySummary.salesCents)}
          detail={`${todaySummary.saleCount} ${todaySummary.saleCount === 1 ? "sale" : "sales"}`}
        />
        <Stat
          label="Net profit"
          value={formatKes(todaySummary.netProfitCents)}
          detail="after cost and expenses"
        />
      </div>

      <SectionLabel>{monthName}</SectionLabel>
      <Card>
        <dl className="space-y-1.5 text-sm">
          <Line label="Sales" value={formatKes(monthSummary.salesCents)} />
          <Line label="Cost of goods sold" value={`− ${formatKes(monthSummary.cogsCents)}`} />
          <div className="flex items-baseline justify-between gap-3 border-t border-line pt-1.5">
            <dt className="font-semibold">Gross profit</dt>
            <dd className="font-bold tnum">{formatKes(monthSummary.grossProfitCents)}</dd>
          </div>
          <Line label="Expenses" value={`− ${formatKes(monthSummary.expensesCents)}`} />
          <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-line pt-2.5">
            <dt className="text-sm font-bold">Net profit</dt>
            <dd
              className={`text-xl font-extrabold tracking-tight tnum xl:text-2xl ${
                monthSummary.netProfitCents < 0 ? "text-bad" : "text-good"
              }`}
            >
              {formatKes(monthSummary.netProfitCents)}
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-muted">
          Net profit = sales − cost of goods − expenses.{" "}
          {monthSummary.salesCents > 0
            ? `That is ${pct(monthSummary.netProfitCents, monthSummary.salesCents).toFixed(1)}% of sales.`
            : "No sales recorded this month yet."}
        </p>
      </Card>

      </div>
      <div className="lg:col-span-7">
      <SectionLabel>Last 6 months</SectionLabel>
      <Card>
        <SalesChart data={months.map((m) => ({ ym: m.ym, label: m.label, salesCents: m.salesCents }))} />
      </Card>

      </div>
      </div>

      <div className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-x-4 xl:gap-x-5 2xl:gap-x-6">
      <div className="lg:col-span-7">
      <SectionLabel>Profit per product · {monthName}</SectionLabel>
      {losers.length ? (
        <div className="mb-2">
          <Alert tone="bad">
            <strong>Losing money:</strong>{" "}
            {losers.map((p) => `${p.name} (${formatKes(p.profit_cents)})`).join(", ")}. Check the
            price or the cost.
          </Alert>
        </div>
      ) : null}
      {products.length ? (
        <Card className="!py-2.5">
          {products.slice(0, 8).map((p) => (
            <ListRow
              key={`${p.item_id}-${p.name}`}
              title={p.name}
              value={`${formatKes(p.profit_cents)} profit`}
              valueTone={p.profit_cents < 0 ? "bad" : "plain"}
              meta={`${p.units} sold · ${formatKes(p.revenue_cents)} sales · ${p.margin_pct.toFixed(0)}% margin`}
            />
          ))}
          {products.length > 8 ? (
            <details className="pt-2">
              <summary className="cursor-pointer text-sm font-bold text-brand-dark">
                All {products.length} products ▾
              </summary>
              <div className="mt-1">
                {products.slice(8).map((p) => (
                  <ListRow
                    key={`${p.item_id}-${p.name}`}
                    title={p.name}
                    value={`${formatKes(p.profit_cents)} profit`}
                    valueTone={p.profit_cents < 0 ? "bad" : "plain"}
                    meta={`${p.units} sold · ${formatKes(p.revenue_cents)} sales · ${p.margin_pct.toFixed(0)}% margin`}
                  />
                ))}
              </div>
            </details>
          ) : null}
        </Card>
      ) : (
        <Card>
          <Empty>No sales this month yet.</Empty>
        </Card>
      )}
      <p className="mt-1.5 text-xs text-muted">
        Prices and costs are the ones recorded on each sale. Changing a price today never
        changes what a past month earned.
      </p>

      </div>
      <div className="lg:col-span-5">
      <SectionLabel>Which line earns · {monthName}</SectionLabel>
      {lines.length ? (
        // Two or three lines of business, each a short card: side by side once
        // there is width for it rather than a single tall stack.
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
          {lines.map((l) => (
            <Card key={l.line}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-bold">{l.line}</span>
                <Chip tone={l.margin_pct >= 25 ? "good" : l.margin_pct >= 10 ? "warn" : "bad"}>
                  {l.margin_pct.toFixed(1)}% margin
                </Chip>
              </div>
              <div className="mt-1.5 grid grid-cols-3 gap-2 text-sm">
                <Figure label="Sales" value={formatKes(l.revenue_cents)} />
                <Figure label="Cost" value={formatKes(l.cost_cents)} />
                <Figure label="Profit" value={formatKes(l.profit_cents)} strong />
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <Empty>Nothing sold this month, so there is no split to show.</Empty>
        </Card>
      )}

      </div>
      </div>

      <div className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-x-4 xl:gap-x-5 2xl:gap-x-6">
      <div className="lg:col-span-7">
      <SectionLabel>Dead stock · nothing sold in 60 days</SectionLabel>
      {dead.length ? (
        <>
          <p className="mb-1.5 text-xs text-muted">
            <span className="font-bold tnum">{formatKes(deadValue)}</span> of cash is sitting on
            these shelves, valued at what it cost.
          </p>
          {/* Row height set from the wrapper: the shared Td is tuned for a
              thumb, and this table is only ever read with a mouse. */}
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
              {dead.map((d) => (
                <tr key={d.id}>
                  <Td>{d.name}</Td>
                  <Td align="right">{formatQty(d.qty_milli, d.canonical_unit)}</Td>
                  <Td align="right">{formatKes(d.value_cents)}</Td>
                  <Td>
                    {d.last_sold_at ? (
                      formatDate(d.last_sold_at)
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
      <div className="lg:col-span-5">
      <SectionLabel>Shrinkage · what the count says the book missed</SectionLabel>
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
            A small gap is ordinary — spillage, a scale that reads a little light. One that grows
            month on month is not.
          </p>
        </>
      ) : (
        <Card>
          <Empty>No shrinkage recorded in the last six months.</Empty>
        </Card>
      )}

      </div>
      </div>

      <SectionLabel>Backup &amp; exports</SectionLabel>
      <Card className="lg:max-w-2xl">
        <Link
          href="/backup"
          prefetch={false}
          className="inline-flex min-h-11 items-center rounded-full bg-brand px-5 text-sm font-bold text-white shadow-sm hover:bg-brand-dark xl:min-h-10"
        >
          Download full backup
        </Link>
        <p className="mt-2 text-xs text-muted">
          One file holding everything. Keep a copy off this phone at least once a week.
        </p>
        <details className="mt-3 border-t border-line pt-3">
          <summary className="cursor-pointer text-sm font-bold text-brand-dark">
            Spreadsheet exports (CSV) ▾
          </summary>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {EXPORT_TABLES.map((t) => (
              <Link
                key={t}
                href={`/export?table=${t}`}
                prefetch={false}
                className="inline-flex min-h-11 items-center rounded-full px-3.5 text-sm font-semibold capitalize ring-1 ring-inset ring-line hover:bg-wash xl:min-h-9"
              >
                {t.replace("_", " ")} CSV
              </Link>
            ))}
          </div>
        </details>
      </Card>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold tnum">{value}</dd>
    </div>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className={`tnum ${strong ? "font-extrabold" : "font-semibold"}`}>{value}</div>
    </div>
  );
}
