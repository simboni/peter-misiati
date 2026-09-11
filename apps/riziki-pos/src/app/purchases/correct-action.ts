"use server";

/**
 * Correcting a delivery's prices.
 *
 * Owner-only, checked here rather than in the markup: a Server Action can be
 * POSTed to directly, and this one rewrites a cost price that decides the
 * profit on every sale of that chemical.
 */

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { correctPurchasePrices } from "@/lib/purchasing";
import { formatKes } from "@/lib/units";

export interface CorrectState {
  ok?: string;
  error?: string;
}

export async function correctPricesAction(
  _prev: CorrectState,
  formData: FormData,
): Promise<CorrectState> {
  const owner = await requireOwner();
  const purchaseId = Number(formData.get("purchaseId"));
  if (!Number.isFinite(purchaseId) || purchaseId <= 0) {
    return { error: "That delivery could not be found." };
  }

  const lines: Array<{ lineId: number; costCents: number }> = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("line:")) continue;
    const lineId = Number(key.slice(5));
    const shillings = Number(String(value).trim());
    if (!Number.isFinite(lineId) || lineId <= 0) continue;
    if (!Number.isFinite(shillings) || shillings < 0) {
      return { error: "Every price has to be a number, zero or more." };
    }
    lines.push({ lineId, costCents: Math.round(shillings * 100) });
  }
  if (!lines.length) return { error: "There was nothing to correct." };

  const transportRaw = Number(String(formData.get("transport") ?? "").trim());
  if (!Number.isFinite(transportRaw) || transportRaw < 0) {
    return { error: "Transport has to be a number, zero or more." };
  }

  try {
    const res = correctPurchasePrices(
      purchaseId,
      { transportCents: Math.round(transportRaw * 100), lines },
      owner.id,
    );

    revalidatePath("/purchases");
    revalidatePath("/stock");
    revalidatePath("/reports");
    revalidatePath("/items");

    return {
      ok:
        `Now ${formatKes(res.totalCents)} landed. ` +
        res.repriced
          .map((r) => `${r.name} costs ${formatKes(r.costCents)} a unit`)
          .join(", ") +
        ".",
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "That could not be corrected." };
  }
}
