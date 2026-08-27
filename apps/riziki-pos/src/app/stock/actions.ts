"use server";

/**
 * Posting a stock take.
 *
 * In its own module because the client component that calls it is now inside
 * the Stock window, and a client component can only be handed an action from a
 * module marked "use server".
 */

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { performStocktake } from "@/lib/stock-service";
import { formatKes } from "@/lib/units";
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
