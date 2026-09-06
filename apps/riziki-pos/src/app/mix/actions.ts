"use server";

/**
 * The mixing board's two server calls: price a batch up, and record it.
 *
 * Owner-only, checked here rather than in the markup. A Server Action can be
 * POSTed to directly, so hiding a button proves nothing — and this one moves
 * stock and rewrites a cost price.
 */

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { planMix, recordMix, MixError, type MixPlan } from "@/lib/mixing";
import { formatQty, formatKes } from "@/lib/units";

export interface PlanState {
  plan?: MixPlan;
  error?: string;
}

/** What a batch of this size would take. Read-only; moves nothing. */
export async function planMixAction(versionId: number, targetMilli: number): Promise<PlanState> {
  await requireOwner();
  try {
    return { plan: planMix(versionId, Math.max(1, Math.round(targetMilli))) };
  } catch (e) {
    return { error: e instanceof MixError ? e.message : "That could not be priced up." };
  }
}

export interface MixState {
  ok?: string;
  error?: string;
}

/**
 * Record a batch.
 *
 * Both quantities come off the form, not out of the recipe: what the jug gave
 * is what the shelf gets. The library re-checks stock inside its transaction,
 * so a sale between drawing this form and pressing the button cannot let the
 * batch overdraw the drum.
 */
export async function recordMixAction(
  _prev: MixState,
  formData: FormData,
): Promise<MixState> {
  const owner = await requireOwner();

  const versionId = Number(formData.get("versionId"));
  const target = Number(formData.get("targetMilli"));
  const madeQty = Number(String(formData.get("made") ?? "").trim());

  if (!Number.isFinite(versionId) || versionId <= 0) {
    return { error: "That recipe could not be found." };
  }
  if (!Number.isFinite(madeQty) || madeQty <= 0) {
    return { error: "Say how much the batch actually made." };
  }

  /*
    What actually went in.

    The form carries one box per ingredient, named `used:<itemId>`, seeded from
    the plan. A box left exactly as it was still comes back here — the owner
    confirming the number is worth as much as the owner changing it.
  */
  const used: Array<{ itemId: number; qtyMilli: number }> = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("used:")) continue;
    const itemId = Number(key.slice(5));
    const qty = Number(String(value).trim());
    if (!Number.isFinite(itemId) || itemId <= 0) continue;
    if (!Number.isFinite(qty) || qty <= 0) {
      return { error: "Every ingredient needs a quantity bigger than nothing." };
    }
    used.push({ itemId, qtyMilli: Math.round(qty * 1000) });
  }

  try {
    const res = recordMix({
      versionId,
      targetMilli: Number.isFinite(target) && target > 0 ? Math.round(target) : Math.round(madeQty * 1000),
      actualMilli: Math.round(madeQty * 1000),
      used,
      userId: owner.id,
      note: String(formData.get("note") ?? "").trim() || undefined,
    });

    revalidatePath("/mix");
    revalidatePath("/stock");
    revalidatePath("/sell");
    revalidatePath("/items");

    return {
      ok:
        `${res.batchNo}: made ${formatQty(res.madeMilli, res.outputUnit)} of ${res.outputName} from ` +
        `${res.consumed.map((c) => `${formatQty(c.qtyMilli, c.unit)} ${c.name}`).join(", ")}. ` +
        `It goes on the shelf at ${formatKes(res.outputCostCents)} a unit in cost.`,
    };
  } catch (e) {
    return { error: e instanceof MixError ? e.message : "That batch was not recorded." };
  }
}
