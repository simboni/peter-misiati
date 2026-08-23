"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { applyPrices, PriceError, type PriceEdit } from "@/lib/pricing";
import { authoriseOwnerPin } from "@/lib/sales";

export interface PriceFormState {
  error?: string;
  ok?: string;
  lines?: string[];
  /** Set when the batch was refused only because something sat below the floor. */
  needsPin?: boolean;
}

/**
 * Save the morning's prices.
 *
 * The form posts every row it drew, including the ones nobody touched, because
 * that is what a plain HTML form does. Working out which actually moved is done
 * against the database rather than trusted from the browser — a stale tab must
 * not be able to re-apply yesterday's numbers over this morning's.
 */
export async function savePricesAction(
  _prev: PriceFormState,
  formData: FormData,
): Promise<PriceFormState> {
  const user = await requireUser();

  const edits: PriceEdit[] = [];
  for (const [key, value] of formData.entries()) {
    const m = /^retail_(\d+)$/.exec(key);
    if (!m) continue;
    const itemId = Number(m[1]);
    const retail = Number(String(value).trim().replace(/,/g, ""));
    const wholesale = Number(
      String(formData.get(`wholesale_${itemId}`) ?? "").trim().replace(/,/g, ""),
    );
    if (!Number.isFinite(retail) || !Number.isFinite(wholesale)) {
      return { error: "One of those prices is not a number. Check the row and try again." };
    }
    edits.push({ itemId, retail, wholesale });
  }

  if (!edits.length) return { error: "Nothing to save." };

  // Below-floor prices need an owner. The PIN box only appears once a save has
  // been refused for that reason, so the ordinary morning never sees it.
  const pin = String(formData.get("owner_pin") ?? "").trim();
  let allowBelowFloor = false;
  if (pin) {
    const ownerId = authoriseOwnerPin(pin);
    if (!ownerId) return { error: "That PIN was not recognised.", needsPin: true };
    allowBelowFloor = true;
  }

  try {
    const res = applyPrices(edits, user.id, { allowBelowFloor, source: "check" });

    revalidatePath("/prices");
    revalidatePath("/sell");
    revalidatePath("/items");

    if (!res.changed) {
      return { ok: "Nothing had changed — prices left as they were." };
    }
    return {
      ok: `${res.changed} price${res.changed === 1 ? "" : "s"} updated. Today's selling prices are set.`,
      lines: res.lines,
    };
  } catch (e) {
    const message =
      e instanceof PriceError ? e.message : "That did not save. Please try again.";
    return { error: message, needsPin: /floor/.test(message) };
  }
}
