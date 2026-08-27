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
import { saveBundles, BundleError, type BundleInput } from "@/lib/bundles";

export interface PricingState {
  error?: string;
  /** Set on a save that changed something, so the row can say so. */
  savedAt?: number;
}

/**
 * The bundle rows, as the editor posted them.
 *
 * JSON rather than flat form fields: the rows are a list whose length nobody
 * knows in advance, and reading `bundle_size_3` back out of a FormData is a
 * parser that will eventually disagree with the screen that wrote it.
 *
 * Anything unparseable is treated as "no bundles were sent" rather than throwing
 * — a corrupted hidden field must not be able to take a price save down with it.
 */
function parseBundles(raw: FormDataEntryValue | null): BundleInput[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  let rows: unknown;
  try {
    rows = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];

  return rows
    .map((r) => {
      const row = r as { size?: unknown; price?: unknown; floor?: unknown };
      return {
        sizeMilli: Math.round((Number(row.size) || 0) * 1000),
        priceCents: Math.round((Number(row.price) || 0) * 100),
        floorCents: Math.round((Number(row.floor) || 0) * 100),
      };
    })
    // A half-typed row is not an error, it is a row still being typed.
    .filter((b) => b.sizeMilli > 0 && b.priceCents > 0);
}

export async function savePricingAction(
  _prev: PricingState,
  formData: FormData,
): Promise<PricingState> {
  const owner = await requireOwner();

  const itemId = Number(formData.get("itemId"));

  try {
    updatePricing({
      itemId,
      price: Number(formData.get("price") ?? 0),
      floor: Number(formData.get("floor") ?? 0),
      ceiling: Number(formData.get("ceiling") ?? 0),
      reorderUnits: Number(formData.get("reorder") ?? 0),
      byUserId: owner.id,
    });

    /*
      The sizes, saved with the price they belong to.

      One button for both because they are one thought: "Ungerol is 511.94 a
      kilogram, and a 20 kg is 8,800". Two save buttons on one row would let an
      owner change the price, walk away, and leave the bundles quoting against
      a rate that no longer exists.

      Rows still being typed — a size with no price yet — are dropped rather
      than refused. Somebody adding a third bundle and then saving the first two
      should not be stopped by the empty row they left open.
    */
    saveBundles({ itemId }, parseBundles(formData.get("bundles")));
  } catch (e) {
    return {
      error:
        e instanceof CatalogError || e instanceof BundleError
          ? e.message
          : "That did not save. Please try again.",
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
