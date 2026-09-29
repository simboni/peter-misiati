import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, can } from "@/lib/auth";
import {
  landedCosts,
  landedSummary,
  isLandedOrder,
  LANDED_ORDERS,
  LANDED_ORDER_LABEL,
  type LandedOrder,
} from "@/lib/landed";
import { listRange, readListPeriod } from "@/lib/list-range";
import { businessDate, formatKes, formatQty, formatDate } from "@/lib/units";
import { Alert, Card, Chip, Empty, PageTitle, TableWrap, Th, Td } from "@/components/ui";
import { DateBar } from "@/components/date-bar";
import { ListToolbar, Pager } from "@/components/section-nav";
import { ExportButtons } from "@/components/export-buttons";

export const dynamic = "force-dynamic";

const PER_PAGE = 25;

/**
 * What the shop pays for a kilo, and which way it is going.
 *
 * THE DECISION THIS SCREEN IS FOR. A drum has gone up; does the price move,
 * does the shop absorb it, or does it buy elsewhere? The only cost figure
 * anywhere in the app was the blended average, which is deliberately slow — it
 * is right for valuing stock and for costing a sale, and it hides a rise for as
 * long as the old drum lasts. This is the other number: what the last delivery
 * actually landed at, what the one before it landed at, and the gap.
 *
 * IT NEVER ARGUES WITH THE BLEND. Cost on file is still what the tills charge
 * against and what the dashboard reports; that column is here beside the landed
 * rate so the difference between the two is visible, because that difference is
 * the margin the shop is still earning and is about to stop earning.
 *
 * Owner-only, like every other screen that shows what the shop pays.
 */
export default async function LandedPage(props: {
  searchParams: Promise<{
    q?: string;
    order?: string;
    period?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  const sp = await props.searchParams;

  const user = await currentUser();
  if (!user) redirect("/login");
  if (!can(user, "cost")) {
    return (
      <div>
        <PageTitle title="Landed cost" />
        <Alert tone="bad">
          What the shop pays for its chemicals is not yours to open. The owner can grant this under
          Users and settings.
        </Alert>
      </div>
    );
  }

  const q = (sp.q ?? "").trim();
  const order: LandedOrder = isLandedOrder(sp.order) ? sp.order : "move";
  const period = readListPeriod(sp);
  const range = listRange(period, businessDate(), sp.from, sp.to);

  const rows = landedCosts({ q, order, range });
  const summary = landedSummary(rows);

  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const current = Math.min(Math.max(1, Number(sp.page) || 1), pages);
  const shown = rows.slice((current - 1) * PER_PAGE, current * PER_PAGE);

  const keep: Record<string, string> = {};
  if (q) keep.q = q;
  if (order !== "move") keep.order = order;

  const dates: Record<string, string> = {};
  if (period !== "all") dates.period = period;
  if (sp.from) dates.from = sp.from;
  if (sp.to) dates.to = sp.to;

  /* The pressure the shop has not felt yet: cheap stock still earning
     yesterday's margin, and what it will cost to put back. */
  const gap = summary.replaceValueCents - summary.stockValueCents;

  return (
    <div>
      <Link
        href="/more"
        className="mb-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-brand hover:underline xl:min-h-9"
      >
        <span aria-hidden>←</span> More
      </Link>

      <PageTitle
        title="Landed cost"
        subtitle="What the last delivery of each thing actually cost, per kilo, litre or piece — transport included"
      />

      <div className="mb-3">
        <ExportButtons csv="landed" label="the landed costs" range={dates} />
      </div>

      <Card className="mb-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile
            label="Watched"
            value={String(summary.watched)}
            note={summary.watched === 1 ? "thing ever delivered" : "things ever delivered"}
          />
          <Tile
            label="Landed dearer"
            value={String(summary.dearer)}
            note="than the delivery before"
            tone={summary.dearer > 0 ? "bad" : undefined}
          />
          <Tile
            label="Landed cheaper"
            value={String(summary.cheaper)}
            note="room to come down"
            tone={summary.cheaper > 0 ? "good" : undefined}
          />
          <Tile
            label="On the shelf"
            value={formatKes(summary.stockValueCents)}
            note={`${formatKes(summary.replaceValueCents)} to replace it`}
          />
        </div>

        {gap > 0 ? (
          <p className="mt-3 text-xs text-muted">
            Replacing what is on the shelf would cost {formatKes(gap)} more than it did. That is
            margin the shop is still earning off stock bought cheaply, and will stop earning when it
            runs out — the case for moving a price before the old drum does.
          </p>
        ) : null}

        {summary.underwater > 0 ? (
          <div className="mt-3">
            <Alert tone="bad">
              {summary.underwater === 1
                ? "One thing now lands at or above what the shop asks for it."
                : `${summary.underwater} things now land at or above what the shop asks for them.`}{" "}
              Every one sold from the next delivery loses money. They are marked below.
            </Alert>
          </div>
        ) : null}
      </Card>

      <DateBar
        action="/landed"
        current={period}
        range={range}
        from={sp.from ?? ""}
        to={sp.to ?? ""}
        keep={keep}
        label="Delivered"
      />

      <ListToolbar
        action="/landed"
        q={q}
        placeholder="A chemical, a product, a supplier…"
        filters={LANDED_ORDERS.map((o) => ({ key: o, label: LANDED_ORDER_LABEL[o] }))}
        current={order}
        extra={dates}
        // These chips are a sort order, not a standing. Left as `state` they
        // wrote a parameter this page does not read, and clicking one did
        // nothing whatsoever.
        param="order"
        defaultKey="move"
      />

      {rows.length === 0 ? (
        <Empty>
          {q || period !== "all"
            ? "Nothing was delivered that matches. Widen the dates, or clear the search."
            : "No delivery has been recorded yet. Book one under Suppliers and purchases and the landed cost appears here."}
        </Empty>
      ) : (
        <>
          <TableWrap>
            <thead>
              <tr>
                <Th>What</Th>
                <Th align="right">Landed at</Th>
                <Th align="right">Before that</Th>
                <Th align="right">Change</Th>
                <Th align="right">Cost on file</Th>
                <Th align="right">Asking</Th>
                <Th align="right">Margin</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const per = `/${r.unit}`;
                return (
                  <tr key={r.itemId} className="hover:bg-wash/50">
                    <Td>
                      <Link
                        href={`/stock/${r.itemId}`}
                        className="block truncate font-bold text-brand hover:underline"
                      >
                        {r.name}
                      </Link>
                      <span className="block text-[11px] text-muted">
                        {r.latest ? (
                          <>
                            {formatDate(r.latest.at)}
                            {r.latest.supplier ? ` · ${r.latest.supplier}` : ""}
                            {r.latest.ref ? ` · ${r.latest.ref}` : ""}
                          </>
                        ) : (
                          "never delivered"
                        )}
                      </span>
                      <span className="block text-[11px] text-muted">
                        {formatQty(r.heldMilli, r.unit)} on the shelf
                        {r.stockValueCents ? ` · ${formatKes(r.stockValueCents)}` : ""}
                      </span>
                    </Td>

                    <Td align="right" className="tnum font-bold">
                      {r.latest ? formatKes(r.latest.rateCents) : "—"}
                      <span className="block text-[11px] font-normal text-muted">
                        {r.latest
                          ? `${r.latest.units} × ${formatQty(Math.round(r.latest.qtyMilli / Math.max(1, r.latest.units)), r.unit)}`
                          : ""}
                      </span>
                    </Td>

                    <Td align="right" className="tnum text-muted">
                      {r.previous ? formatKes(r.previous.rateCents) : "first one"}
                      <span className="block text-[11px]">
                        {r.previous ? formatDate(r.previous.at) : `${r.deliveries} delivery`}
                      </span>
                    </Td>

                    <Td align="right" className="tnum font-bold">
                      {r.previous ? (
                        <>
                          <span
                            className={
                              r.moveCents > 0 ? "text-bad" : r.moveCents < 0 ? "text-good" : "text-muted"
                            }
                          >
                            {r.moveCents > 0 ? "+" : r.moveCents < 0 ? "−" : ""}
                            {formatKes(Math.abs(r.moveCents))}
                          </span>
                          <span className="block text-[11px] font-normal text-muted">
                            {r.movePct > 0 ? "+" : r.movePct < 0 ? "−" : ""}
                            {Math.abs(r.movePct).toFixed(1)}%
                          </span>
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </Td>

                    {/*
                      The blend, beside the landed rate on purpose. The distance
                      between them is the margin the shop is still earning off
                      older stock — and the size of the drop coming when it runs
                      out.
                    */}
                    <Td align="right" className="tnum text-muted">
                      {formatKes(r.costCents)}
                      <span className="block text-[11px]">blended{per}</span>
                    </Td>

                    <Td align="right" className="tnum">
                      {r.priceCents ? formatKes(r.priceCents) : <span className="text-muted">not priced</span>}
                    </Td>

                    <Td align="right" className="tnum font-bold">
                      {r.priceCents ? (
                        <>
                          <span className={r.underwater ? "text-bad" : ""}>
                            {r.freshMarginPct.toFixed(0)}%
                          </span>
                          {r.underwater ? (
                            <span className="mt-0.5 block">
                              <Chip tone="bad">under cost</Chip>
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>

          <Pager
            action="/landed"
            page={current}
            pages={pages}
            total={rows.length}
            noun="thing"
            params={{ ...keep, ...dates }}
          />
        </>
      )}

      <p className="mt-4 text-xs text-muted">
        Landed cost is what the supplier charged plus that line’s share of the transport, over what
        actually arrived — always per kilo, litre or piece, never per drum. The margin column is
        worked out against the newest landed rate, not the blend: it is the margin the next sale off
        the next delivery will earn, which is the one worth deciding a price on.
      </p>
    </div>
  );
}

/** One figure, with what it is and what it means under it. */
function Tile({
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
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">{label}</div>
      <div
        className={`mt-0.5 whitespace-nowrap text-base font-black tnum ${
          tone === "bad" ? "text-bad" : tone === "good" ? "text-good" : ""
        }`}
      >
        {value}
      </div>
      <div className="text-[11px] leading-tight text-muted">{note}</div>
    </div>
  );
}
