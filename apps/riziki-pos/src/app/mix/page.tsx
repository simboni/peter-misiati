import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, requireOwner } from "@/lib/auth";
import { mixableFormulas, recentBatches } from "@/lib/mixing";
import { formatQty, formatKes, formatDateTime } from "@/lib/units";
import { PageTitle, SectionLabel, Card, Alert, Empty, TableWrap, Th, Td } from "@/components/ui";
import { MixClient } from "./mix-client";

export const dynamic = "force-dynamic";

/**
 * The mixing board.
 *
 * Owner-only, and for the same reason the recipe screen is: a batch form shows
 * what goes into the mix, which is the business. The gate runs before anything
 * is queried — a staff session that reached the query would already have the
 * quantities in the response whatever the markup then decided to show.
 */
export default async function MixPage() {
  try {
    await requireOwner();
  } catch {
    if (!(await currentUser())) redirect("/login");
    return (
      <div>
        <PageTitle title="Mixing board" />
        <Alert tone="bad">
          Mixing is the owner’s. Ask the owner to sign in on this phone.
        </Alert>
        <p className="mt-3 text-sm text-muted">
          Selling what has already been mixed does not need this screen — it is on the counter
          like any other product.
        </p>
      </div>
    );
  }

  const rows = mixableFormulas();
  const batches = recentBatches(20);

  return (
    <div>
      <PageTitle
        title="Mixing board"
        subtitle="Mix a batch in advance, and it goes on the shelf to be sold"
      />

      <div className="max-w-3xl">
        <MixClient rows={rows} />
      </div>

      {batches.length ? (
        <>
          <SectionLabel>Mixed recently</SectionLabel>
          <TableWrap>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Batch</Th>
                <Th>Made</Th>
                <Th align="right">Cost of what went in</Th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className="align-top hover:bg-wash/50">
                  <Td className="whitespace-nowrap text-muted">{formatDateTime(b.at)}</Td>
                  <Td>
                    <div className="font-bold tnum">{b.batchNo}</div>
                    <div className="text-[11px] text-muted">
                      {[b.formulaName, b.userName].filter(Boolean).join(" · ")}
                    </div>
                  </Td>
                  <Td>
                    <div className="font-semibold">
                      {formatQty(b.madeMilli, b.outputUnit)} {b.outputName}
                    </div>
                    {b.inputs ? (
                      <div className="text-[11px] text-muted">from {b.inputs}</div>
                    ) : null}
                  </Td>
                  <Td align="right" className="whitespace-nowrap font-semibold tnum">
                    {formatKes(b.costCents)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </>
      ) : rows.length ? (
        <>
          <SectionLabel>Mixed recently</SectionLabel>
          <Card>
            <Empty>Nothing mixed yet.</Empty>
          </Card>
        </>
      ) : null}

      <p className="mt-4 max-w-2xl text-xs text-muted">
        A recipe appears here once it has been told what it makes — set that on the recipe itself
        under{" "}
        <Link href="/formulas" className="font-semibold text-brand">
          Recipes
        </Link>
        . A recipe mixed in advance is not billed at the counter, because its chemicals have
        already left the shelf.
      </p>
    </div>
  );
}
