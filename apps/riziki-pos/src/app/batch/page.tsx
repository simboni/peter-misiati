import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUser, requireOwner, isOwner } from "@/lib/auth";
import {
  listMixableProducts,
  currentVersion,
  planBatch,
  batchReadiness,
  minimumTargetMilli,
  newBatchNo,
  runBatch,
  recordYield,
  voidBatch,
  outputItemsFor,
  pendingYieldBatches,
  listBatches,
  StockShortError,
} from "@/lib/production";
import { formatQty, formatKes, fromMilli, toMilli, formatDateTime, pct } from "@/lib/units";
import {
  PageTitle,
  Card,
  Chip,
  Alert,
  SectionLabel,
  TableWrap,
  Th,
  Td,
  ListRow,
  Stat,
  Empty,
  Button,
  Field,
  inputClass,
} from "@/components/ui";
import { RunBatchForm, type RunState } from "./run-form";
import { YieldForm, type YieldState } from "./yield-form";

export const dynamic = "force-dynamic";

// ------------------------------------------------------------------ actions

async function runBatchAction(_prev: RunState, formData: FormData): Promise<RunState> {
  "use server";

  let batchNo: string;
  try {
    const user = await requireOwner();

    const versionId = Number(formData.get("versionId"));
    const targetMilli = Number(formData.get("targetMilli"));

    ({ batchNo } = runBatch({ formulaVersionId: versionId, targetMilli, userId: user.id }));
  } catch (err) {
    if (err instanceof StockShortError) {
      // Which chemical is short is itself part of the recipe. The owner is told
      // exactly what to buy; staff are only told the mix cannot run, or a
      // patient attendant could reconstruct a formula out of refusals.
      if (await isOwner()) {
        const named = err.short
          .map((s) => `${s.chemicalName} (short ${formatQty(s.shortMilli, s.unit)})`)
          .join(", ");
        return { error: `Not enough stock: ${named}. Buy these before mixing.` };
      }
      return {
        error:
          "Not enough stock for this mix. Tell the owner which product and size you tried — nothing has been taken off the shelf.",
      };
    }
    return { error: err instanceof Error ? err.message : "Could not run the batch." };
  }

  revalidatePath("/batch");
  revalidatePath("/stock");
  // Outside the catch: `redirect` works by throwing.
  redirect(`/batch?done=${encodeURIComponent(batchNo)}`);
}

async function recordYieldAction(_prev: YieldState, formData: FormData): Promise<YieldState> {
  "use server";

  try {
    const user = await requireOwner();

    const batchId = Number(formData.get("batchId"));
    const actualLitres = Number(formData.get("actualLitres"));
    if (!Number.isFinite(actualLitres) || actualLitres < 0) {
      return { error: "Enter the litres actually produced." };
    }

    const outputItemId = Number(formData.get("outputItemId")) || null;

    recordYield({
      batchId,
      actualMilli: toMilli(actualLitres),
      outputItemId,
      userId: user.id,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save the yield." };
  }

  revalidatePath("/batch");
  revalidatePath("/stock");
  redirect("/batch?yield=1");
}

async function voidBatchAction(formData: FormData): Promise<void> {
  "use server";

  const user = await requireOwner();
  try {
    voidBatch(Number(formData.get("batchId")), user.id, String(formData.get("reason") ?? ""));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not void the batch.";
    redirect(`/batch?verr=${encodeURIComponent(message)}`);
  }
  revalidatePath("/batch");
  revalidatePath("/stock");
  redirect("/batch?voided=1");
}

// --------------------------------------------------------------------- page

export default async function BatchPage(props: {
  searchParams: Promise<{ f?: string; l?: string; done?: string; yield?: string; voided?: string; verr?: string }>;
}) {
  // `searchParams` is a Promise in Next.js 16.
  const { f, l, done, yield: yieldDone, voided, verr } = await props.searchParams;

  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "owner") redirect("/");
  const owner = true;

  const products = listMixableProducts();
  const selectedId = Number(f) || products[0]?.id || 0;
  const litres = Number(l);
  const hasTarget = Number.isFinite(litres) && litres > 0;

  const version = selectedId ? currentVersion(selectedId) : undefined;
  const product = products.find((p) => p.id === selectedId);

  const targetMilli = hasTarget ? toMilli(litres) : 0;
  const minMilli = version ? minimumTargetMilli(version.id) : 1000;
  const tooSmall = hasTarget && targetMilli < minMilli;

  // The ingredient rows only ever exist inside this branch. Staff get a yes/no
  // computed on the server and nothing else — the recipe is the business.
  const plan = owner && version && hasTarget && !tooSmall ? planBatch(version.id, targetMilli) : null;
  const readiness =
    version && hasTarget && !tooSmall
      ? plan
        ? { ok: plan.ok, shortCount: plan.short.length, tooSmall: false }
        : batchReadiness(version.id, targetMilli)
      : null;

  const batchNo = readiness ? newBatchNo() : "";

  const pending = pendingYieldBatches();
  const recent = listBatches(12, owner);

  return (
    <div>
      <PageTitle
        title="Production batch"
        subtitle={
          owner
            ? "Scale a formula, check the shelf, and post the mix to the ledger."
            : "Pick a product and a size. The recipe stays with the owner."
        }
      />

      {done ? (
        <div className="mb-3">
          <Alert tone="good">
            Batch <span className="font-bold">{done}</span> recorded and the chemicals taken off the
            shelf. Enter the litres actually produced below once it is mixed.
          </Alert>
        </div>
      ) : null}
      {yieldDone ? (
        <div className="mb-3">
          <Alert tone="good">Yield recorded.</Alert>
        </div>
      ) : null}
      {voided ? (
        <div className="mb-3">
          <Alert tone="good">
            Batch voided. Every chemical it took is back on the shelf, and the correction is in
            the ledger next to the original.
          </Alert>
        </div>
      ) : null}
      {verr ? (
        <div className="mb-3">
          <Alert tone="bad">{verr}</Alert>
        </div>
      ) : null}

      {pending.length ? (
        <>
          <SectionLabel>Waiting on actual yield</SectionLabel>
          <div className="space-y-2.5">
            {pending.map((b) => (
              <Card key={b.id} className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold tnum">{b.batch_no}</div>
                    <div className="mt-0.5 text-xs text-muted">
                      {b.formula_name} · target {formatQty(b.target_milli, "L")} ·{" "}
                      {formatDateTime(b.at)}
                    </div>
                  </div>
                  <Chip tone="warn">Yield due</Chip>
                </div>
                <YieldForm
                  action={recordYieldAction}
                  batchId={b.id}
                  batchNo={b.batch_no}
                  targetLitres={String(fromMilli(b.target_milli))}
                  outputs={outputItemsFor(b.formula_name).map((o) => ({
                    id: o.id,
                    name: o.name,
                    suggested: o.suggested,
                  }))}
                />
              </Card>
            ))}
          </div>
        </>
      ) : null}


      {/* A GET form: the calculation lives in the URL, so it survives a reload
          on a phone that lost signal halfway through the morning. */}
      <form method="get" className="space-y-3">
        <Card className="space-y-3">
          <Field label="Product">
            <select className={inputClass} name="f" defaultValue={selectedId}>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="How many litres?" hint="The quantity you want to end up with.">
            <input
              className={inputClass}
              type="number"
              name="l"
              defaultValue={hasTarget ? String(litres) : ""}
              min="0.001"
              // step="any": with a 0.001 minimum, any fixed step makes the valid
              // values 0.001, 0.101, ... 99.901 — so the browser rejects round
              // numbers like 20 and 100, which are the only ones anyone types.
              // The server still enforces the real minimum batch size.
              step="any"
              inputMode="decimal"
              placeholder="20"
            />
          </Field>

          <Button type="submit" className="w-full">
            Work it out
          </Button>
        </Card>
      </form>

      {products.length === 0 ? <Empty>No formula has any ingredients recorded yet.</Empty> : null}

      {version && hasTarget ? (
        <>
          <SectionLabel>
            {product?.name} · {formatQty(targetMilli, "L")}
          </SectionLabel>

          {tooSmall ? (
            <Alert tone="warn">
              That batch is too small to scale accurately — the smallest ingredient would round away
              to nothing. Mix at least {formatQty(minMilli, "L")}.
            </Alert>
          ) : (
            <>
              <Card>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
                      Batch number
                    </div>
                    <div className="mt-0.5 text-lg font-extrabold tracking-tight tnum">
                      {batchNo}
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      Goes on every label — KEBS traceability.
                    </div>
                  </div>
                  {readiness?.ok ? (
                    <Chip tone="good">Ready to mix</Chip>
                  ) : (
                    <Chip tone="bad">Short of stock</Chip>
                  )}
                </div>
              </Card>

              {plan ? (
                <>
                  {/* The economics first — go/no-go — then the picking list. */}
                  <div className="mt-2.5 grid grid-cols-2 gap-2.5">
                    <Stat
                      label="Chemical cost"
                      value={formatKes(plan.totalCostCents)}
                      detail="chemicals only — no packaging or labour"
                    />
                    <Stat
                      label="Cost per litre"
                      value={formatKes(plan.costPerLitreCents)}
                      detail={`scaled from a ${formatQty(plan.refSizeMilli, "L")} sheet`}
                    />
                  </div>

                  <SectionLabel>Ingredients for this batch</SectionLabel>
                  <Card className="!py-2.5">
                    {plan.lines.map((line) => (
                      <ListRow
                        key={line.chemicalId}
                        title={line.chemicalName}
                        value={formatQty(line.neededMilli, line.unit)}
                        valueTone={line.ok ? "plain" : "bad"}
                        meta={
                          line.ok ? (
                            <>
                              {formatQty(line.availableMilli, line.unit)} on the shelf ·{" "}
                              {formatKes(line.costCents)}
                            </>
                          ) : (
                            <span className="font-bold text-bad">
                              Short {formatQty(line.shortMilli, line.unit)} — only{" "}
                              {formatQty(line.availableMilli, line.unit)} on the shelf
                            </span>
                          )
                        }
                      />
                    ))}
                  </Card>
                </>
              ) : (
                <p className="mt-2 text-sm text-muted">
                  The mixing sheet stays with the owner. This screen only tells you whether the
                  chemicals are on the shelf.
                </p>
              )}

              <RunBatchForm
                action={runBatchAction}
                versionId={version.id}
                targetMilli={targetMilli}
                blocked={!readiness?.ok}
                blockedReason={
                  readiness?.ok
                    ? null
                    : owner && plan
                      ? `Short of ${plan.short
                          .map((s) => `${s.chemicalName} (${formatQty(s.shortMilli, s.unit)})`)
                          .join(", ")}. Buy these before mixing.`
                      : "Not enough stock for this mix. Ask the owner to order more."
                }
                batchNo={batchNo}
              />
            </>
          )}
        </>
      ) : null}

      <SectionLabel>Recent batches</SectionLabel>
      {recent.length === 0 ? (
        <Empty>Nothing has been mixed yet.</Empty>
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <Th>Batch</Th>
              <Th align="right">Target</Th>
              <Th align="right">Actual</Th>
              <Th align="right">Difference</Th>
              {owner ? <Th align="right">Cost</Th> : null}
            </tr>
          </thead>
          <tbody>
            {recent.map((b) => {
              const variance = b.actual_milli === null ? null : b.actual_milli - b.target_milli;
              return (
                <tr key={b.id} className={b.status === "voided" ? "opacity-60" : ""}>
                  <Td>
                    <span className="block font-bold tnum">
                      {b.batch_no}
                      {b.status === "voided" ? (
                        <span className="ml-1.5 text-[11px] font-bold text-bad">voided</span>
                      ) : null}
                    </span>
                    <span className="block text-xs text-muted">
                      {b.formula_name} v{b.version} · {formatDateTime(b.at)}
                    </span>
                    {b.status === "completed" ? (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[11px] font-bold text-bad">
                          Void this batch
                        </summary>
                        <form action={voidBatchAction} className="mt-1.5 flex items-center gap-1.5">
                          <input type="hidden" name="batchId" value={b.id} />
                          <input
                            className={`${inputClass} !py-1.5 text-xs`}
                            name="reason"
                            placeholder="Why? e.g. wrong litres entered"
                            required
                          />
                          <button
                            type="submit"
                            className="shrink-0 rounded-lg bg-bad px-2.5 py-1.5 text-[11px] font-bold text-white"
                          >
                            Void
                          </button>
                        </form>
                        <p className="mt-1 text-[11px] text-muted">
                          Puts every chemical back and removes any bottled output. The batch stays
                          on the record, marked voided.
                        </p>
                      </details>
                    ) : null}
                  </Td>
                  <Td align="right">{formatQty(b.target_milli, "L")}</Td>
                  <Td align="right">
                    {b.actual_milli === null ? (
                      <span className="text-muted">pending</span>
                    ) : (
                      formatQty(b.actual_milli, "L")
                    )}
                  </Td>
                  <Td align="right">
                    {variance === null ? (
                      <span className="text-muted">—</span>
                    ) : (
                      // formatQty drops the sign when it falls back to ml, so
                      // the direction of the variance is written out here.
                      <span className={variance < 0 ? "text-bad" : "text-good"}>
                        {variance === 0 ? "" : variance < 0 ? "−" : "+"}
                        {formatQty(Math.abs(variance), "L")}
                        <span className="block text-xs text-muted">
                          {pct(variance, b.target_milli).toFixed(1)}%
                        </span>
                      </span>
                    )}
                  </Td>
                  {owner ? <Td align="right">{formatKes(b.cost_cents ?? 0)}</Td> : null}
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      )}

      {owner ? (
        <p className="mt-3 text-sm">
          <Link href="/formulas" className="font-bold text-brand-dark">
            Formulas →
          </Link>
        </p>
      ) : null}
    </div>
  );
}
