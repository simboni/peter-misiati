import { redirect } from "next/navigation";
import { currentUser, requireOwner } from "@/lib/auth";
import { mixableFormulas, recentBatches, voidBatch, MixError } from "@/lib/mixing";
import { revalidatePath } from "next/cache";
import { formatQty, formatKes, formatDateTime } from "@/lib/units";
import {
  PageTitle,
  SectionLabel,
  Card,
  Alert,
  Button,
  Empty,
  inputClassBase,
  TableWrap,
  Th,
  Td,
} from "@/components/ui";
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
/**
 * Undo a batch.
 *
 * Owner-only and reason-required. The reason is what somebody reads in the
 * audit six weeks later, and "undone" on its own answers nothing.
 */
async function undoBatch(formData: FormData): Promise<void> {
  "use server";
  const owner = await requireOwner();
  const batchId = Number(formData.get("batchId"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!Number.isFinite(batchId) || batchId <= 0) redirect("/mix?undo=missing");
  if (!reason) redirect("/mix?undo=reason");

  let problem = "";
  try {
    voidBatch(batchId, owner.id, reason);
  } catch (e) {
    problem = e instanceof MixError ? e.message : "That batch could not be undone.";
  }

  revalidatePath("/mix");
  revalidatePath("/stock");
  revalidatePath("/sell");
  revalidatePath("/items");

  // Outside the catch: redirect reports itself by throwing. See AGENTS.md.
  redirect(problem ? `/mix?undo=${encodeURIComponent(problem)}` : "/mix?undone=1");
}

export default async function MixPage(props: {
  searchParams: Promise<{ open?: string; undone?: string; undo?: string }>;
}) {
  // `searchParams` is a Promise in Next.js 16 — synchronous access was removed.
  const { open, undone, undo } = await props.searchParams;
  try {
    await requireOwner();
  } catch {
    if (!(await currentUser())) redirect("/login");
    return (
      <div>
        <PageTitle title="Mixing board" />

      {undone ? (
        <div className="mb-3 max-w-2xl">
          <Alert tone="good">
            Batch undone. The mix is off the shelf and the chemicals are back where they were.
          </Alert>
        </div>
      ) : null}
      {undo ? (
        <div className="mb-3 max-w-2xl">
          <Alert tone="bad">
            {undo === "reason"
              ? "Say why the batch is being undone."
              : undo === "missing"
                ? "That batch could not be found."
                : undo}
          </Alert>
        </div>
      ) : null}
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
      <PageTitle title="Mixing board" />

      <div className="max-w-2xl">
        <MixClient rows={rows} openFormulaId={open ? Number(open) : null} />
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
                    <div className="font-bold tnum">
                      {b.batchNo}
                      {b.voidedAt ? (
                        <span className="ml-1.5 text-[11px] font-semibold text-bad">undone</span>
                      ) : null}
                    </div>
                    <div className="text-[11px] text-muted">
                      {[b.formulaName, b.userName].filter(Boolean).join(" · ")}
                    </div>

                    {/*
                      Folded, because most batches are right and a form on every
                      row would bury the list. A reason is required: "undone" on
                      its own answers nothing six weeks later.
                    */}
                    {b.voidedAt ? null : (
                      <details className="mt-0.5">
                        <summary className="inline-flex min-h-8 cursor-pointer list-none items-center text-[11px] font-bold text-brand">
                          Undo this batch
                        </summary>
                        <form action={undoBatch} className="mt-1 space-y-1.5">
                          <input type="hidden" name="batchId" value={b.id} />
                          <input
                            name="reason"
                            type="text"
                            required
                            placeholder="Why? e.g. recorded twice"
                            aria-label="Why this batch is being undone"
                            className={`${inputClassBase} w-full !py-1.5 text-xs`}
                          />
                          <Button type="submit" variant="danger" className="!min-h-9 !px-3 text-xs">
                            Put the chemicals back
                          </Button>
                        </form>
                      </details>
                    )}
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

    </div>
  );
}
