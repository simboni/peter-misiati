import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { get } from "@/lib/db";
import { movementHistory, dailyStock } from "@/lib/stock-service";
import { formatQty, formatDateTime } from "@/lib/units";
import { Alert, Card, Chip, Empty, PageTitle, SectionLabel, TableWrap, Th, Td } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Where one item's count came from.
 *
 * Every figure in this app is a sum of `stock_movements`, and until now nothing
 * showed those rows. So "the Ungerol goes up twenty kilos a day and nobody
 * delivered any" was a question the system could not answer about itself: the
 * shelf said what it said, and the reason sat in a table only a developer could
 * read. This screen is that table, in the shop's words.
 *
 * OWNER ONLY, like the reagent quantities on the shelf screen it hangs off. An
 * attendant who could read what a batch took, line by line, could recover the
 * recipe by subtraction.
 */
export default async function StockHistoryPage(props: {
  // `params` is a Promise in Next.js 16 — synchronous access was removed.
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const itemId = Number(id);

  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "owner") {
    return (
      <div>
        <PageTitle title="Stock history" />
        <Alert tone="bad">
          The stock ledger is the owner’s. Ask the owner to sign in on this phone.
        </Alert>
      </div>
    );
  }

  const item = get<{ id: number; name: string; canonical_unit: "kg" | "L" | "pcs" }>(
    `SELECT id, name, canonical_unit FROM items WHERE id = ?`,
    itemId,
  );
  if (!item) {
    return (
      <div>
        <PageTitle title="Stock history" />
        <Alert tone="bad">That product is not on the catalogue.</Alert>
      </div>
    );
  }

  const moves = movementHistory(item.id);
  const days = dailyStock(item.id, 14);
  const onHandMilli = moves.length ? moves[0].balanceMilli : 0;

  /*
    The days that went UP without a delivery on them.

    This is the whole reason the screen exists, so it is the thing it says
    first rather than something the owner has to spot by reading a column. A
    day whose only reason for rising is a sale being voided, a batch being
    undone, or somebody adjusting by hand is a day worth asking about.
  */
  const unexplained = days.filter((d) => d.netMilli > 0).length;

  return (
    <div className="max-w-4xl">
      <Link
        href="/stock"
        className="mb-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-brand hover:underline xl:min-h-9"
      >
        <span aria-hidden>←</span> Back to stock
      </Link>

      <PageTitle
        title={item.name}
        subtitle={`Every entry behind the count — ${formatQty(onHandMilli, item.canonical_unit)} on the shelf now`}
      />

      <SectionLabel>Day by day</SectionLabel>
      <Card>
        {days.length === 0 ? (
          <Empty>Nothing has ever moved on this item.</Empty>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Day</Th>
                <Th align="right">In</Th>
                <Th align="right">Out</Th>
                <Th align="right">Net</Th>
                <Th align="right">Shelf at close</Th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date}>
                  <Td className="whitespace-nowrap font-semibold">{d.date}</Td>
                  <Td align="right" className="tnum text-good">
                    {d.inMilli ? `+${formatQty(d.inMilli, item.canonical_unit)}` : "—"}
                  </Td>
                  <Td align="right" className="tnum text-muted">
                    {d.outMilli ? `−${formatQty(d.outMilli, item.canonical_unit)}` : "—"}
                  </Td>
                  <Td align="right" className="tnum font-bold">
                    <span className={d.netMilli > 0 ? "text-good" : d.netMilli < 0 ? "text-bad" : ""}>
                      {d.netMilli > 0 ? "+" : d.netMilli < 0 ? "−" : ""}
                      {formatQty(Math.abs(d.netMilli), item.canonical_unit)}
                    </span>
                  </Td>
                  <Td align="right" className="tnum">
                    {formatQty(d.closingMilli, item.canonical_unit)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        {unexplained > 0 ? (
          <p className="mt-2.5 text-xs text-muted">
            {unexplained} of the last {days.length} days went up. Every rise has a row in the list
            below saying what put it there and who was signed in at the time.
          </p>
        ) : null}
      </Card>

      <SectionLabel>Every entry, newest first</SectionLabel>
      {moves.length === 0 ? (
        <Empty>No movements recorded.</Empty>
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>What happened</Th>
              <Th align="right">Amount</Th>
              <Th align="right">Shelf after</Th>
              <Th>Who</Th>
            </tr>
          </thead>
          <tbody>
            {moves.map((m) => (
              <tr key={m.id} className="hover:bg-wash/50">
                <Td className="whitespace-nowrap text-[12px]">{formatDateTime(m.at)}</Td>
                <Td>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Chip tone={m.deltaMilli > 0 ? "good" : "neutral"}>{m.said}</Chip>
                    {m.href ? (
                      <Link href={m.href} className="text-[11px] font-bold text-brand hover:underline">
                        {m.refType === "sale" ? `sale #${m.refId}` : m.refType}
                      </Link>
                    ) : null}
                  </div>
                  {m.note ? <div className="mt-0.5 text-[11px] text-muted">{m.note}</div> : null}
                </Td>
                <Td align="right" className="tnum font-bold">
                  <span className={m.deltaMilli > 0 ? "text-good" : "text-bad"}>
                    {m.deltaMilli > 0 ? "+" : "−"}
                    {formatQty(Math.abs(m.deltaMilli), item.canonical_unit)}
                  </span>
                </Td>
                <Td align="right" className="tnum text-muted">
                  {formatQty(m.balanceMilli, item.canonical_unit)}
                </Td>
                <Td className="text-[12px] text-muted">{m.who ?? "—"}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      <p className="mt-3 text-xs text-muted">
        Nothing on this page can be edited. The stock ledger is append-only: a mistake is put right
        by a stock take or a correction, and both of those appear here as entries of their own.
      </p>
    </div>
  );
}
