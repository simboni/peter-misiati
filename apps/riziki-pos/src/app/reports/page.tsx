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

      <SectionLabel>Today</SectionLabel>
      <div className="grid grid-cols-2 gap-2.5">
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
              className={`text-2xl font-extrabold tracking-tight tnum ${
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

      <SectionLabel>Last 6 months</SectionLabel>
      <Card>
        <SalesChart data={months.map((m) => ({ ym: m.ym, label: m.label, salesCents: m.salesCents }))} />
      </Card>

      <SectionLabel>Profit per product · {monthName}</SectionLabel>
      {products.length ? (
        <TableWrap>
          <thead>
            <tr>
              <Th>Product</Th>
              <Th align="right">Sold</Th>
              <Th align="right">Sales</Th>
              <Th align="right">Profit</Th>
              <Th align="right">Margin</Th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={`${p.item_id}-${p.name}`}>
                <Td>
                  <div className="font-semibold">{p.name}</div>
                  <div className="text-xs text-muted tnum">
                    at {formatKes(p.unit_price_cents)} each
                  </div>
                </Td>
                <Td align="right">{p.units}</Td>
                <Td align="right">{formatKes(p.revenue_cents)}</Td>
                <Td
                  align="right"
                  className={p.profit_cents < 0 ? "font-bold text-bad" : "font-semibold"}
                >
                  {formatKes(p.profit_cents)}
                </Td>
                <Td align="right">{p.margin_pct.toFixed(1)}%</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : (
        <Card>
          <Empty>No sales this month yet.</Empty>
        </Card>
      )}
      <p className="mt-1.5 text-xs text-muted">
        Prices and costs are the ones recorded on each sale. Changing a price today never
        changes what a past month earned.
      </p>

      <SectionLabel>Which line earns · {monthName}</SectionLabel>
      {lines.length ? (
        <div className="space-y-2.5">
          {lines.map((l) => (
            <Card key={l.line}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-bold">{l.line}</span>
                <Chip tone={l.margin_pct >= 25 ? "good" : l.margin_pct >= 10 ? "warn" : "bad"}>
                  {l.margin_pct.toFixed(1)}% margin
                </Chip>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
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

      <SectionLabel>Dead stock · nothing sold in 60 days</SectionLabel>
      {dead.length ? (
        <>
          <p className="mb-2 text-xs text-muted">
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

      <SectionLabel>Shrinkage · stock take and repack loss</SectionLabel>
      <TableWrap>
        <thead>
          <tr>
            <Th>Month</Th>
            <Th align="right">Quantity</Th>
            <Th align="right">At cost</Th>
          </tr>
        </thead>
        <tbody>
          {shrink.map((s) => (
            <tr key={s.ym}>
              <Td>
                {s.label} {s.ym.slice(0, 4)}
              </Td>
              <Td align="right">{s.milli === 0 ? "—" : (s.milli / 1000).toFixed(3)}</Td>
              <Td align="right" className={s.value_cents < 0 ? "font-semibold text-bad" : ""}>
                {s.value_cents === 0 ? "—" : formatKes(s.value_cents)}
              </Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      <p className="mt-1.5 text-xs text-muted">
        Repack loss of roughly 1.5% is expected. A stock-take gap that grows month on month is
        not.
      </p>

      <SectionLabel>Take your data out</SectionLabel>
      <Card>
        <p className="mb-2.5 text-sm text-muted">
          Download any of these as a spreadsheet file. Your data is yours, always.
        </p>
        <div className="flex flex-wrap gap-2">
          {EXPORT_TABLES.map((t) => (
            <Link
              key={t}
              href={`/export?table=${t}`}
              prefetch={false}
              className="rounded-xl border border-line px-3 py-2.5 text-sm font-semibold capitalize hover:bg-wash"
            >
              {t.replace("_", " ")} CSV
            </Link>
          ))}
        </div>
        <div className="mt-3 border-t border-line pt-3">
          <Link
            href="/backup"
            prefetch={false}
            className="inline-block rounded-xl bg-brand px-4 py-3 text-sm font-bold text-white hover:bg-brand-dark"
          >
            Download full backup
          </Link>
          <p className="mt-1.5 text-xs text-muted">
            One file holding everything — sales, stock, formulas, users. Keep a copy off this
            phone (email it to yourself, or save it to a memory stick) at least once a week.
            Restoring is putting the file back in place.
          </p>
        </div>
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
