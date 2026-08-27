"use server";

/**
 * Posting a stock take.
 *
 * In its own module because the client component that calls it is now inside
 * the Stock window, and a client component can only be handed an action from a
 * module marked "use server".
 */

import { revalidatePath } from "next/cache";
import { requireOwner, currentUser } from "@/lib/auth";
import { performStocktake } from "@/lib/stock-service";
import { recordMake, MakeError } from "@/lib/making";
import { formatKes, formatQty } from "@/lib/units";
import type { StocktakeState } from "@/app/stocktake/stocktake-client";

export async function submitStocktake(
  _prev: StocktakeState,
  formData: FormData,
): Promise<StocktakeState> {
  const user = await requireOwner();

  const counts: Array<{ itemId: number; countedUnits: number }> = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("count_")) continue;
    const text = String(value).trim();
    if (text === "") continue;
    const countedUnits = Number(text);
    if (!Number.isFinite(countedUnits)) continue;
    counts.push({ itemId: Number(key.slice("count_".length)), countedUnits });
  }

  try {
    const result = performStocktake({
      counts,
      reason: String(formData.get("reason") ?? ""),
      userId: user.id,
    });

    revalidatePath("/stock");
    revalidatePath("/");

    // Only the owner is told what the shrinkage was worth.
    const value = user.role === "owner" ? ` (${formatKes(result.varianceCents)} at cost)` : "";
    return {
      ok: `Posted ${result.posted} adjustment${result.posted === 1 ? "" : "s"} from ${result.countedItems} counted items${value}.`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "The stock take could not be posted." };
  }
}

/**
 * Making a batch: the concentrate off the shelf, the dilution on.
 *
 * Owner-only, like the stock take beside it. What is made changes what the shop
 * is worth and what its margins are, and both of those are the owner's.
 */
export interface MakeState {
  error?: string;
  ok?: string;
}

export async function makeBatchAction(
  _prev: MakeState,
  formData: FormData,
): Promise<MakeState> {
  const user = await currentUser();
  if (!user) return { error: "Sign in first." };
  if (user.role !== "owner") return { error: "Only the owner can make up a batch." };

  try {
    const res = recordMake({
      toItemId: Number(formData.get("toItemId") ?? 0),
      inQty: Number(formData.get("inQty") ?? 0),
      outQty: Number(formData.get("outQty") ?? 0),
      byUserId: user.id,
    });

    revalidatePath("/stock");
    revalidatePath("/sell");
    revalidatePath("/items");
    return {
      ok:
        `Made ${formatQty(res.outMilli, res.toUnit)} of ${res.toName} out of ` +
        `${formatQty(res.inMilli, res.fromUnit)} of ${res.fromName}. ` +
        `It costs ${formatKes(res.newCostCents)} a ${res.toUnit} now.`,
    };
  } catch (e) {
    return { error: e instanceof MakeError ? e.message : "That batch could not be made." };
  }
}
