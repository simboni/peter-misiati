import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, can } from "@/lib/auth";
import { explainDay, type DayCause } from "@/lib/day-why";
import { formatKes, formatQty, formatDate, formatDateTime } from "@/lib/units";
import { Alert, Card, Chip, Empty, PageTitle, SectionLabel, TableWrap, Th, Td } from "@/components/ui";
import { ExportButtons } from "@/components/export-buttons";

export const dynamic = "force-dynamic";

/**
 * One day, and why it came out that way.
 *
 * WHY THIS IS A SCREEN. The same answer existed as `npm run why`, which needed
 * an ssh session, a password and a terminal — and the person who wants it is
 * the owner looking at a red figure on his phone. A diagnosis behind a
 * terminal is a diagnosis nobody runs. The rules are shared with the script in
 * `lib/day-why`, so the two cannot drift into disagreeing.
 *
 * It answers a negative day in one sentence and then shows the working, in the
 * order somebody would ask for it: what was spent, what sold below its cost,
 * what is priced under cost on the shelf whatever this day did, what had to be
 * valued at today's prices, and every sale on the day with its frozen cost.
 *
 * Behind the cost permission, like the dashboard it hangs off.
 */

const HEADLINE: Record<DayCause, string> = {
  nothing: "Nothing was recorded on this day",
  positive: "This day made money",
  expenses: "Money spent, not money lost",
  "under-cost": "The goods cost more than they were sold for",
  "late-cost": "A cost price entered after the fact",
};

export default async function DayPage(props: {
  params: Promise<{ date: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  const { date } = await props.params;
  const { back } = await props.searchParams;

  const user = await currentUser();
  if (!user) redirect("/login");
  if (!can(user, "cost")) {
    return (
      <div>
        <PageTitle title="The day" />
        <Alert tone="bad">
          What the shop made is not yours to open. The owner can grant this under Users and
          settings.
        </Alert>
      </div>
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return (
      <div>
        <PageTitle title="The day" />
        <Alert tone="bad">That is not a date. It should look like 2026-09-22.</Alert>
      </div>
    );
  }

  const d = explainDay(date);
  const s = d.summary;
  const shown = formatDate(`${date}T12:00:00Z`);

  return (
    <div>
      <Link
        href={back ? `/reports?${back}` : "/reports"}
        className="mb-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-brand hover:underline xl:min-h-9"
      >
        <span aria-hidden>←</span> Back to the dashboard
      </Link>

      <PageTitle title={shown} subtitle="What this day did, and why" />

      <div className="mb-3">
        <ExportButtons
          csv="sales"
          label={`the sales for ${shown}`}
          range={{ period: "custom", from: date, to: date }}
        />
      </div>

      {/* The four figures, in the order they make each other. */}
      <Card className="mb-3">
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Figure label="Sales" value={formatKes(s.salesCents)} note={`${s.saleCount} ${s.saleCount === 1 ? "sale" : "sales"}`} />
          <Figure label="Cost of goods" value={formatKes(s.cogsCents)} note="frozen on each sale" />
          <Figure
            label="Gross profit"
            value={formatKes(s.grossProfitCents)}
            note={s.salesCents ? `${((s.grossProfitCents / s.salesCents) * 100).toFixed(1)}% margin` : "—"}
            tone={s.grossProfitCents < 0 ? "bad" : undefined}
          />
          <Figure label="Expenses" value={formatKes(s.expensesCents)} note="paid out that day" />
          <Figure
            label="Net profit"
            value={formatKes(s.netProfitCents)}
            note="sales − cost − expenses"
            tone={s.netProfitCents < 0 ? "bad" : "good"}
          />
        </dl>
      </Card>

      {/* --------------------------------------------------------- the verdict */}

      <Card className="mb-4">
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
          {d.cause === "positive" || d.cause === "nothing" ? "The day" : "The cause"}
        </div>
        <h2 className="mt-0.5 text-lg font-extrabold">{HEADLINE[d.cause]}</h2>

        {d.cause === "nothing" ? (
          <p className="mt-1.5 text-sm text-muted">
            No sale and no expense was recorded. Check the date — the shop’s day runs on Nairobi
            time, so anything after nine at night belongs to the day it was still light on.
          </p>
        ) : null}

        {d.cause === "positive" ? (
          <p className="mt-1.5 text-sm text-muted">
            Nothing to explain. The working is below if you want it.
          </p>
        ) : null}

        {d.cause === "expenses" ? (
          <p className="mt-1.5 text-sm text-muted">
            The goods themselves sold at a profit of {formatKes(s.grossProfitCents)}. The day is
            negative because {formatKes(s.expensesCents)} went out as expenses. Nothing is wrong and
            nothing needs correcting — check the list below is right and this day is closed.
          </p>
        ) : null}

        {d.cause === "under-cost" ? (
          <p className="mt-1.5 text-sm text-muted">
            Before a single expense, the day was already {formatKes(s.grossProfitCents)}. This is a
            costing problem, not a spending one: either a price is too low or a cost on file is too
            high, and a cost that is too high is nearly always a typing slip.
          </p>
        ) : null}

        {d.cause === "late-cost" ? (
          <>
            <p className="mt-1.5 text-sm text-muted">
              {formatKes(s.estimatedCostCents)} of the {formatKes(s.cogsCents)} charged against this
              day is not this day’s cost at all — it is what those products cost today, borrowed
              because nothing was recorded when they were sold.
            </p>
            <p className="mt-1.5 text-sm text-muted">
              Nothing happened on this day to make it negative. Somebody saved a cost price
              afterwards and it reached backwards. Put the right per-unit cost on the product and
              every day it touched comes back on its own.
            </p>
          </>
        ) : null}

        {s.uncostedSalesCents > 0 ? (
          <div className="mt-3">
            <Alert tone="warn">
              {formatKes(s.uncostedSalesCents)} of these sales have no known cost at all — not on
              the line, and not on the product today. They count as pure profit, which they are not.
            </Alert>
          </div>
        ) : null}
      </Card>

      {/* ------------------------------------------------------- what was spent */}

      {d.spend.length ? (
        <>
          <SectionLabel>What was spent that day</SectionLabel>
          <TableWrap>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>What for</Th>
                <Th>Paid with</Th>
                <Th align="right">Amount</Th>
              </tr>
            </thead>
            <tbody>
              {d.spend.map((e, i) => (
                <tr key={`${e.at}-${i}`}>
                  <Td className="whitespace-nowrap text-[12px]">{formatDateTime(e.at)}</Td>
                  <Td>
                    <span className="font-semibold">{e.category}</span>
                    {e.note ? <span className="block text-[11px] text-muted">{e.note}</span> : null}
                  </Td>
                  <Td className="text-[12px] text-muted">{e.method === "cash" ? "Cash" : "M-Pesa"}</Td>
                  <Td align="right" className="tnum font-bold">
                    {formatKes(e.amountCents)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <p className="mt-2 text-xs text-muted">
            Check each one is real, is this day’s, and has the decimal point where it belongs. An
            expense is the one thing here that can still be edited —{" "}
            <Link href="/expenses" className="font-bold text-brand hover:underline">
              under Expenses
            </Link>
            .
          </p>
        </>
      ) : null}

      {/* -------------------------------------------- sold for less than it cost */}

      {d.losers.length ? (
        <>
          <SectionLabel>Sold for less than it cost</SectionLabel>
          <TableWrap>
            <thead>
              <tr>
                <Th>What</Th>
                <Th align="right">Sold for</Th>
                <Th align="right">Costed at</Th>
                <Th align="right">Difference</Th>
              </tr>
            </thead>
            <tbody>
              {d.losers.map((p) => (
                <tr key={`${p.item_id}-${p.name}`}>
                  <Td>
                    {p.item_id ? (
                      <Link href={`/stock/${p.item_id}`} className="font-bold text-brand hover:underline">
                        {p.name}
                      </Link>
                    ) : (
                      <span className="font-bold">{p.name}</span>
                    )}
                    {p.uncosted ? (
                      <span className="ml-1.5"><Chip tone="warn">no cost known</Chip></span>
                    ) : p.estimated ? (
                      <span className="ml-1.5"><Chip tone="warn">cost estimated</Chip></span>
                    ) : null}
                  </Td>
                  <Td align="right" className="tnum">{formatKes(p.revenue_cents)}</Td>
                  <Td align="right" className="tnum text-muted">{formatKes(p.cost_cents)}</Td>
                  <Td align="right" className="tnum font-bold text-bad">
                    {formatKes(p.profit_cents)}
                    <span className="block text-[11px] font-normal text-muted">
                      {p.margin_pct.toFixed(0)}%
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </>
      ) : null}

      {/* ------------------------------ valued at today's price, not the day's */}

      {d.borrowed.length ? (
        <>
          <SectionLabel>Valued at today’s price, not this day’s</SectionLabel>
          <TableWrap>
            <thead>
              <tr>
                <Th>What</Th>
                <Th align="right">Sold</Th>
                <Th align="right">Took</Th>
                <Th align="right">Valued at</Th>
                <Th align="right">Charged to the day</Th>
              </tr>
            </thead>
            <tbody>
              {d.borrowed.map((b) => (
                <tr key={b.name}>
                  <Td className="font-bold">{b.name}</Td>
                  <Td align="right" className="tnum">{formatQty(b.qtyMilli, b.unit)}</Td>
                  <Td align="right" className="tnum">{formatKes(b.soldCents)}</Td>
                  <Td align="right" className="tnum">
                    {formatKes(b.rateCents)}
                    <span className="block text-[11px] text-muted">per {b.unit}, today</span>
                  </Td>
                  <Td align="right" className="tnum font-bold">{formatKes(b.valuedCents)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <p className="mt-2 text-xs text-muted">
            If one of those rates looks like a whole drum’s price rather than one unit, that is the
            fault. Cost is always per kilo, litre or piece —{" "}
            <Link href="/landed" className="font-bold text-brand hover:underline">
              check it against what the deliveries landed at
            </Link>
            .
          </p>
        </>
      ) : null}

      {/* ------------------------------------- underwater on the shelf, today */}

      {d.underwater.length ? (
        <>
          <SectionLabel>Priced at or under what it costs — today, on the shelf</SectionLabel>
          <Card>
            <ul className="space-y-1.5 text-sm">
              {d.underwater.map((i) => (
                <li key={i.name} className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">{i.name}</span>
                  <span className="text-muted tnum">
                    sells {formatKes(i.priceCents)}/{i.unit} · costs {formatKes(i.costCents)}/{i.unit} ·{" "}
                    <span className="font-bold text-bad">
                      losing {formatKes(i.lossCents)} every {i.unit}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">
              Each of these loses money on every sale until the price or the cost moves, whatever
              this day did.
            </p>
          </Card>
        </>
      ) : null}

      {/* ----------------------------------------------------- the sales themselves */}

      <SectionLabel>Every sale on that day</SectionLabel>
      {d.sales.length ? (
        <>
          <TableWrap>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Who</Th>
                <Th align="right">Sold</Th>
                <Th align="right">Costed</Th>
                <Th align="right">Earned</Th>
              </tr>
            </thead>
            <tbody>
              {d.sales.map((x) => {
                const voided = x.status !== "completed";
                return (
                  <tr key={x.id} className={voided ? "opacity-60" : ""}>
                    <Td className="whitespace-nowrap text-[12px]">
                      <Link href={`/invoice/${x.id}`} className="font-bold text-brand hover:underline">
                        {formatDateTime(x.at).slice(-5)}
                      </Link>
                      <span className="block text-[11px] text-muted">#{x.id}</span>
                    </Td>
                    <Td className="text-[12px]">
                      {x.customer ?? <span className="text-muted">walk-in</span>}
                      <span className="block text-[11px] text-muted">{x.who ?? "—"}</span>
                      {voided ? <Chip tone="bad">Voided</Chip> : null}
                    </Td>
                    <Td align="right" className="tnum">{formatKes(x.totalCents)}</Td>
                    <Td align="right" className="tnum text-muted">
                      {x.costCents ? formatKes(x.costCents) : "not known"}
                    </Td>
                    <Td align="right" className="tnum font-bold">
                      <span className={x.totalCents - x.costCents < 0 ? "text-bad" : ""}>
                        {voided ? "—" : formatKes(x.totalCents - x.costCents)}
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
          <p className="mt-2 text-xs text-muted">
            Voided sales are shown struck back but are not counted in any figure above.
          </p>
        </>
      ) : (
        <Empty>No sale was recorded on this day.</Empty>
      )}
    </div>
  );
}

function Figure({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="rounded-xl border border-line bg-wash/40 px-3 py-2.5">
      <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd
        className={`mt-0.5 whitespace-nowrap text-base font-black tnum ${
          tone === "bad" ? "text-bad" : tone === "good" ? "text-good" : ""
        }`}
      >
        {value}
      </dd>
      <dd className="text-[11px] leading-tight text-muted">{note}</dd>
    </div>
  );
}
