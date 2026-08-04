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

// --------------------------------------------------------------------- page

export default async function BatchPage(props: {
  searchParams: Promise<{ f?: string; l?: string; done?: string; yield?: string }>;
}) {
  // `searchParams` is a Promise in Next.js 16.
  const { f, l, done, yield: yieldDone } = await props.searchParams;

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
                  <SectionLabel>Ingredients for this batch</SectionLabel>
                  <TableWrap>
                    <thead>
                      <tr>
                        <Th>Chemical</Th>
                        <Th align="right">Needed</Th>
                        <Th align="right">On hand</Th>
                        <Th align="right">Cost</Th>
                        <Th align="right">&nbsp;</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.lines.map((line) => (
                        <tr key={line.chemicalId}>
                          <Td>{line.chemicalName}</Td>
                          <Td align="right">{formatQty(line.neededMilli, line.unit)}</Td>
                          <Td align="right" className="text-muted">
                            {formatQty(line.availableMilli, line.unit)}
                          </Td>
                          <Td align="right">{formatKes(line.costCents)}</Td>
                          <Td align="right">
                            {line.ok ? (
                              <Chip tone="good">OK</Chip>
                            ) : (
                              <Chip tone="bad">
                                Short {formatQty(line.shortMilli, line.unit)}
                              </Chip>
                            )}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </TableWrap>

                  <div className="mt-2.5 grid grid-cols-2 gap-2.5">
                    <Stat
                      label="Reagent cost"
                      value={formatKes(plan.totalCostCents)}
                      detail="chemicals only — no packaging or labour"
                    />
                    <Stat
                      label="Cost per litre"
                      value={formatKes(plan.costPerLitreCents)}
                      detail={`scaled from a ${formatQty(plan.refSizeMilli, "L")} sheet`}
                    />
                  </div>

                  <p className="mt-2 text-xs text-muted">
                    Owner only. Staff see the same batch number and the same ready/short answer,
                    never the recipe or the cost.
                  </p>
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
              <Th align="right">Variance</Th>
              {owner ? <Th align="right">Cost</Th> : null}
            </tr>
          </thead>
          <tbody>
            {recent.map((b) => {
              const variance = b.actual_milli === null ? null : b.actual_milli - b.target_milli;
              return (
                <tr key={b.id}>
                  <Td>
                    <span className="block font-bold tnum">{b.batch_no}</span>
                    <span className="block text-xs text-muted">
                      {b.formula_name} v{b.version} · {formatDateTime(b.at)}
                    </span>
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
        <p className="mt-3 text-sm text-muted">
          Variance is measured against the target.{" "}
          <Link href="/formulas" className="font-bold text-brand">
            Formulas
          </Link>
        </p>
      ) : null}
    </div>
  );
}
