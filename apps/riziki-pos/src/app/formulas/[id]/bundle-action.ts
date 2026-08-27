"use server";

/**
 * Saving the sizes a recipe is sold in.
 *
 * Its own module because the form that calls it is a client component, and a
 * client component may only be handed an action from a file marked
 * "use server".
 *
 * Refusals come back to the form rather than redirecting: the owner is looking
 * at a list of sizes they have just typed, and a redirect would take all of
 * them away to say one was wrong.
 */

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { saveBundles, BundleError } from "@/lib/bundles";
import { parseBundleRows } from "@/lib/bundle-input";

export interface BundleFormState {
  error?: string;
  savedAt?: number;
}

export async function saveFormulaBundles(
  _prev: BundleFormState,
  formData: FormData,
): Promise<BundleFormState> {
  await requireOwner();

  const formulaId = Number(formData.get("formulaId"));
  if (!Number.isFinite(formulaId) || formulaId <= 0) {
    return { error: "That recipe could not be found." };
  }

  try {
    saveBundles({ formulaId }, parseBundleRows(formData.get("bundles")));
  } catch (e) {
    return {
      error: e instanceof BundleError ? e.message : "Those sizes did not save. Please try again.",
    };
  }

  revalidatePath(`/formulas/${formulaId}`);
  revalidatePath("/sell");
  return { savedAt: Date.now() };
}
