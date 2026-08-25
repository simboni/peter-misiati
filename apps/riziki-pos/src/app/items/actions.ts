"use server";

/**
 * Saving one product's prices.
 *
 * This is separate from the page's other actions because it is the only one
 * that gets refused in ordinary use — a price outside its own band, a floor
 * above its ceiling — and a refusal has to come back to the row it came from.
 *
 * The others redirect on failure, which is right for them: adding a product or
 * hiding one either works or is a mistake worth stopping the whole page for. A
 * price is different. The owner is halfway down a list of fifty-six rows with a
 * row open and four numbers typed into it, and sending them to the top of the
 * page with the row shut and the numbers gone is indistinguishable from the
 * Save button doing nothing at all. So this one returns its answer instead.
 */

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { redirect } from "next/navigation";
import { updatePricing, deleteProduct, CatalogError } from "@/lib/catalog";

export interface PricingState {
  error?: string;
  /** Set on a save that changed something, so the row can say so. */
  savedAt?: number;
}

export async function savePricingAction(
  _prev: PricingState,
  formData: FormData,
): Promise<PricingState> {
  const owner = await requireOwner();

  try {
    updatePricing({
      itemId: Number(formData.get("itemId")),
      price: Number(formData.get("price") ?? 0),
      floor: Number(formData.get("floor") ?? 0),
      ceiling: Number(formData.get("ceiling") ?? 0),
      reorderUnits: Number(formData.get("reorder") ?? 0),
      byUserId: owner.id,
    });
  } catch (e) {
    return {
      error: e instanceof CatalogError ? e.message : "That did not save. Please try again.",
    };
  }

  revalidatePath("/items");
  revalidatePath("/sell");
  return { savedAt: Date.now() };
}

/**
 * Remove a product typed by mistake.
 *
 * Lives here rather than inline on the page because the button that calls it is
 * a client component — it holds the "tap again" state — and a client component
 * can only be handed an action from a module marked "use server".
 *
 * The rule itself is `deleteProduct`'s: anything with history is refused there,
 * and the message says to hide it instead.
 */
export async function deleteProductAction(formData: FormData): Promise<void> {
  const owner = await requireOwner();
  try {
    deleteProduct(Number(formData.get("itemId")), owner.id);
  } catch (e) {
    const message = e instanceof CatalogError ? e.message : "That could not be deleted.";
    redirect(`/items?err=${encodeURIComponent(message)}`);
  }
  revalidatePath("/items");
  revalidatePath("/sell");
}
