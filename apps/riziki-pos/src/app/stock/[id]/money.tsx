import Link from "next/link";
import { Alert, Card, Chip, Empty, SectionLabel, TableWrap, Th, Td } from "@/components/ui";
import { Fold } from "@/components/fold";
import { deliveriesOf, earningsOf, itemHead, soldLinesOf } from "@/lib/item-money";
import { priceHistoryPage } from "@/lib/pricing";
import { formatKes, formatQty, formatDateTime, formatDate } from "@/lib/units";

/**
 * Where a chemical's cost came from, what it has been asked for, and what it earned.
 *
 * THE QUESTION THIS ANSWERS. A drum is bought at one price; half of it is sold;
 * the next drum costs something else. What is the shelf worth now, what will the
 * next sale be costed at, and what happened to the sales already made? And from
 * the other side: the asking price moves while the same stock is still on the
 * floor. Every one of those facts was in the database and none of them was on a
 * screen — the shop could see quantities and the dashboard could see totals, and
 * nothing joined the two for one product.
 *
 * WHY IT IS THREE TABLES AND NOT A CHART. Each one is a ledger the shop can be
 * argued with over: a supplier's invoice, a price a customer remembers, a sale
 * somebody disputes. A line they can point at is worth more than a curve.
 *
 * The cost trail is the replay `recomputeCost` uses, so what is drawn here is
 * what the tills are charging against. Nothing on this page is recalculated for
 * display.
 */
export function ItemMoney({ itemId, days = 30 }: { itemId: number; days?: number }) {
  const head = itemHead(itemId);
  if (!head) return null;

  const deliveries = deliveriesOf(itemId);
  const earnings = earningsOf(itemId, days);
  const sold = soldLinesOf(itemId, 12);
  const prices = priceHistoryPage(1, 8, itemId);

  const per = `a ${head.unit === "pcs" ? "piece" : head.unit}`;

  return (
    <div className="mb-5">
      <SectionLabel>The money behind it</SectionLabel>

      {/*
        Four numbers, in the order the question is asked: what is here, what it
        cost us, what we ask for it, what that leaves. The fourth is the one the
        owner is really after and it is the one nothing used to show.
      */}
      <Card>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile
            label="On the shelf"
            value={formatQty(head.heldMilli, head.unit)}
            note={`worth ${formatKes(head.stockValueCents)} at cost`}
          />
          <Tile
            label="Costing"
            value={head.costCents ? formatKes(head.costCents) : "not known"}
            note={head.costCents ? `${per}, blended` : "no priced delivery yet"}
          />
          <Tile
            label="Asking"
            value={head.priceCents ? formatKes(head.priceCents) : "not priced"}
            note={head.priceCents ? per : "set a price before selling it"}
          />
          <Tile
            label="Earns"
            value={head.priceCents && head.costCents ? formatKes(head.unitProfitCents) : "—"}
            note={
              head.priceCents && head.costCents
                ? `${head.marginPct.toFixed(1)}% margin, ${per}`
                : "needs both numbers"
            }
            tone={head.underwater ? "bad" : "good"}
          />
        </div>

        {head.underwater ? (
          <div className="mt-3">
            <Alert tone="bad">
              This is priced at or under what it costs. Every sale of it loses{" "}
              {formatKes(Math.abs(head.unitProfitCents))} {per}. Either the asking price has to go up
              or the cost on file is wrong — check the deliveries below.
            </Alert>
          </div>
        ) : null}
      </Card>

      {/* ------------------------------------------------ where the cost came from */}

      <Fold
        id="item-cost-trail"
        title="Where the cost came from"
        hint={
          deliveries.length
            ? `${deliveries.length} priced arrival${deliveries.length === 1 ? "" : "s"} · now ${formatKes(head.costCents)} ${per}`
            : "nothing priced has arrived yet"
        }
        defaultOpen
      >
        {deliveries.length === 0 ? (
          <Empty>
            No delivery with a price on it has ever been recorded against this item, so there is
            nothing for the cost to be built from.
          </Empty>
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Where from</Th>
                  <Th align="right">Came in</Th>
                  <Th align="right">Landed at</Th>
                  <Th align="right">Cost before</Th>
                  <Th align="right">Cost after</Th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d, i) => {
                  // Only a blend can rise or fall. An arrival onto an empty
                  // shelf sets the cost rather than moving it, and colouring it
                  // red said "this got dearer" about the first drum ever bought.
                  const blended = d.heldMilli > 0;
                  const up = blended && d.costAfterCents > d.costBeforeCents;
                  const down = blended && d.costAfterCents < d.costBeforeCents;
                  return (
                    <tr key={`${d.reason}-${d.refId}-${i}`}>
                      <Td className="whitespace-nowrap text-[12px]">{formatDate(d.at)}</Td>
                      <Td>
                        {d.reason === "batch_output" ? (
                          <Chip tone="neutral">mixed here</Chip>
                        ) : (
                          <>
                            <span className="block font-semibold leading-tight">
                              {d.supplier ?? "supplier not named"}
                            </span>
                            <span className="text-[11px] text-muted">
                              {d.ref ? `${d.ref} · ` : ""}
                              {formatKes(d.deliveryTotalCents)} delivery
                              {d.deliveryTransportCents
                                ? `, ${formatKes(d.deliveryTransportCents)} transport`
                                : ""}
                            </span>
                          </>
                        )}
                      </Td>
                      <Td align="right" className="tnum">
                        {formatQty(d.inMilli, head.unit)}
                        {d.units ? (
                          <span className="block text-[11px] text-muted">
                            {d.units} × {formatQty(d.sizeMilli, head.unit)}
                          </span>
                        ) : null}
                      </Td>
                      <Td align="right" className="tnum font-bold">
                        {formatKes(d.inRateCents)}
                        <span className="block text-[11px] font-normal text-muted">
                          {formatKes(d.inCents)} in all
                        </span>
                      </Td>
                      <Td align="right" className="tnum text-muted">
                        {d.heldMilli > 0 ? formatKes(d.costBeforeCents) : "—"}
                        <span className="block text-[11px]">
                          {d.heldMilli > 0 ? `on ${formatQty(d.heldMilli, head.unit)} held` : "shelf empty"}
                        </span>
                      </Td>
                      <Td align="right" className="tnum font-bold">
                        <span className={up ? "text-bad" : down ? "text-good" : ""}>
                          {formatKes(d.costAfterCents)}
                        </span>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
            <p className="mt-2.5 text-xs text-muted">
              Each delivery blends into what was already on the shelf: the value held plus the value
              arriving, over the quantity held plus the quantity arriving. Transport is part of what
              a delivery landed at, because a drum that costs KES 95,000 at the supplier and KES
              3,000 to bring across town cost the shop KES 98,000. The rate is always{" "}
              {per} — never per drum, since a 200 kg drum and a 250 kg drum have no shared price.
            </p>
          </>
        )}
      </Fold>

      {/* ------------------------------------------------------ what it has earned */}

      <Fold
        id="item-earnings"
        title={`What it earned, last ${days} days`}
        hint={
          earnings.saleCount
            ? `${formatKes(earnings.profitCents)} on ${formatKes(earnings.revenueCents)} · ${earnings.marginPct.toFixed(1)}%`
            : "nothing sold in this window"
        }
      >
        {earnings.saleCount === 0 ? (
          <Empty>Nothing has been sold from this item in the last {days} days.</Empty>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile
                label="Sold"
                value={formatQty(earnings.qtyMilli, head.unit)}
                note={`over ${earnings.saleCount} sale${earnings.saleCount === 1 ? "" : "s"}`}
              />
              <Tile label="Took" value={formatKes(earnings.revenueCents)} note="charged to customers" />
              <Tile label="Cost" value={formatKes(earnings.costCents)} note="frozen on each sale" />
              <Tile
                label="Profit"
                value={formatKes(earnings.profitCents)}
                note={`${earnings.marginPct.toFixed(1)}% margin`}
                tone={earnings.profitCents < 0 ? "bad" : "good"}
              />
            </div>

            {earnings.lowRateCents !== earnings.highRateCents ? (
              <p className="mt-2.5 text-xs text-muted">
                It went out at between {formatKes(earnings.lowRateCents)} and{" "}
                {formatKes(earnings.highRateCents)} {per} in this window — the price moved, or it was
                haggled. Every sale below shows what it was actually charged at.
              </p>
            ) : null}

            {earnings.estimatedCents > 0 ? (
              <div className="mt-2.5">
                <Alert tone="warn">
                  {formatKes(earnings.estimatedCents)} of that cost is what the item costs today, not
                  what it cost on the day — those sales were made before a price was recorded. Put
                  the right cost on the delivery and the figure settles.
                </Alert>
              </div>
            ) : null}

            <div className="mt-3">
              <TableWrap>
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th align="right">Quantity</Th>
                    <Th align="right">Charged</Th>
                    <Th align="right">Costed</Th>
                    <Th align="right">Profit</Th>
                    <Th>Who</Th>
                  </tr>
                </thead>
                <tbody>
                  {sold.map((l) => (
                    <tr key={`${l.saleId}-${l.at}`}>
                      <Td className="whitespace-nowrap text-[12px]">
                        <Link href={`/invoice/${l.saleId}`} className="font-bold text-brand hover:underline">
                          {formatDate(l.at)}
                        </Link>
                        <span className="block text-[11px] text-muted">#{l.saleId}</span>
                      </Td>
                      <Td align="right" className="tnum">
                        {formatQty(l.qtyMilli, head.unit)}
                      </Td>
                      <Td align="right" className="tnum font-semibold">
                        {formatKes(l.rateCents)}
                        <span className="block text-[11px] font-normal text-muted">
                          {formatKes(l.revenueCents)}
                        </span>
                      </Td>
                      <Td align="right" className="tnum text-muted">
                        {l.costRateCents ? formatKes(l.costRateCents) : "not known"}
                        <span className="block text-[11px]">{formatKes(l.costCents)}</span>
                      </Td>
                      <Td align="right" className="tnum font-bold">
                        <span className={l.profitCents < 0 ? "text-bad" : ""}>
                          {formatKes(l.profitCents)}
                        </span>
                        <span className="block text-[11px] font-normal text-muted">
                          {l.marginPct.toFixed(0)}%
                        </span>
                      </Td>
                      <Td className="text-[12px] text-muted">
                        {l.customer ?? l.who ?? "—"}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
              <p className="mt-2.5 text-xs text-muted">
                Both numbers on every row were frozen when the goods left the counter. A dearer drum
                tomorrow cannot spoil a margin already earned, and a price put up tomorrow cannot
                improve one.
              </p>
            </div>
          </>
        )}
      </Fold>

      {/* ---------------------------------------------------------- the asking price */}

      <Fold
        id="item-price-changes"
        title="What it has been asked for"
        hint={
          prices.total
            ? `${prices.total} change${prices.total === 1 ? "" : "s"} · now ${formatKes(head.priceCents)}`
            : "the price has never been changed"
        }
      >
        {prices.rows.length === 0 ? (
          <Empty>
            The asking price has not been changed since this item was set up. It is{" "}
            {formatKes(head.priceCents)} {per}.
          </Empty>
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th align="right">From</Th>
                  <Th align="right">To</Th>
                  <Th>By</Th>
                  <Th>Where</Th>
                </tr>
              </thead>
              <tbody>
                {prices.rows.map((r, i) => {
                  const up = r.new_price > r.old_price;
                  return (
                    <tr key={`${r.at}-${i}`}>
                      <Td className="whitespace-nowrap text-[12px]">{formatDateTime(r.at)}</Td>
                      <Td align="right" className="tnum text-muted">
                        {formatKes(r.old_price)}
                      </Td>
                      <Td align="right" className="tnum font-bold">
                        <span className={up ? "text-good" : "text-bad"}>
                          {formatKes(r.new_price)}
                        </span>
                      </Td>
                      <Td className="text-[12px] text-muted">{r.user_name ?? "—"}</Td>
                      <Td>
                        <Chip tone="neutral">
                          {r.source === "counter"
                            ? "at the till"
                            : r.source === "admin"
                              ? "catalogue"
                              : "price check"}
                        </Chip>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
            {prices.total > prices.rows.length ? (
              <p className="mt-2.5 text-xs">
                <Link href="/prices/history" className="font-bold text-brand hover:underline">
                  All {prices.total} changes, across every item
                </Link>
              </p>
            ) : null}
            <p className="mt-2.5 text-xs text-muted">
              Changing a price moves no stock and rewrites no sale. This history cannot be edited or
              deleted — a correction is another row.
            </p>
          </>
        )}
      </Fold>
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
