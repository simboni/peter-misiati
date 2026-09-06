"use server";

/**
 * Choosing whether a recipe is mixed to order or mixed in advance.
 *
 * Its own module because the form that calls it is a client component, and a
 * client component may only be handed an action from a file marked
 * "use server".
 *
 * The counter is revalidated as well as the recipe, because this is the switch
 * that decides whether the recipe appears on the counter's Products board at
 * all — leaving a stale board would show a recipe that can no longer be sold
 * that way, or hide one that can.
 */

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { setFormulaOutput, MixError } from "@/lib/mixing";

export interface OutputFormState {
  error?: string;
  ok?: string;
}

export async function saveFormulaOutput(
  _prev: OutputFormState,
  formData: FormData,
): Promise<OutputFormState> {
  const owner = await requireOwner();

  const formulaId = Number(formData.get("formulaId"));
  if (!Number.isFinite(formulaId) || formulaId <= 0) {
    return { error: "That recipe could not be found." };
  }

  const raw = String(formData.get("outputItemId") ?? "").trim();
  const itemId = raw ? Number(raw) : null;
  if (raw && (!Number.isFinite(itemId) || (itemId ?? 0) <= 0)) {
    return { error: "Pick the product this recipe makes, or choose mixed to order." };
  }

  try {
    setFormulaOutput(formulaId, itemId, owner.id);
  } catch (e) {
    return {
      error: e instanceof MixError ? e.message : "That did not save. Please try again.",
    };
  }

  revalidatePath(`/formulas/${formulaId}`);
  revalidatePath("/formulas");
  revalidatePath("/sell");
  revalidatePath("/mix");
  return {
    ok: itemId
      ? "Saved. This recipe is now mixed in advance — use the Mixing board."
      : "Saved. This recipe is billed at the counter again.",
  };
}
