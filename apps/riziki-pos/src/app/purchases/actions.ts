"use server";

/**
 * Server actions for suppliers and deliveries.
 *
 * Recording a purchase means handling cost prices, which the contract keeps
 * away from staff — so the gate is `isOwner()` on the server, not a hidden
 * form. A Server Action can be POSTed to directly; hiding the UI proves nothing.
 */

import { revalidatePath } from "next/cache";
import { requireUser, isOwner } from "@/lib/auth";
import { createSupplier, updateSupplier, recordPurchase, type PurchaseLineInput } from "@/lib/purchasing";
import { formatKes, toCents } from "@/lib/units";

export interface FormState {
  error?: string;
  ok?: string;
}

function centsFromField(raw: FormDataEntryValue | null, label: string): number {
  const text = String(raw ?? "").trim().replace(/,/g, "");
  if (!text) return 0;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a number, zero or more.`);
  return toCents(value);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. Please try again.";
}

export async function saveSupplierAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();

  try {
    const idRaw = String(formData.get("id") ?? "").trim();
    const input = {
      name: String(formData.get("name") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      note: String(formData.get("note") ?? ""),
    };

    if (idRaw) {
      updateSupplier(Number(idRaw), input, user.id);
      revalidatePath("/purchases");
      return { ok: "Saved." };
    }

    createSupplier(input, user.id);
    revalidatePath("/purchases");
    return { ok: `${input.name.trim()} added.` };
  } catch (err) {
    return { error: message(err) };
  }
}

export async function recordPurchaseAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireUser();
  if (!(await isOwner())) {
    return { error: "Only the owner can record purchase prices." };
  }

  try {
    // The line inputs repeat the same three names, so getAll keeps them in
    // document order and the three arrays line up row for row.
    const itemIds = formData.getAll("item_id");
    const unitList = formData.getAll("units");
    const sizeList = formData.getAll("size");
    const costList = formData.getAll("cost");

    const lines: PurchaseLineInput[] = [];
    for (let i = 0; i < itemIds.length; i++) {
      const itemId = Number(String(itemIds[i] ?? "").trim());
      const unitsText = String(unitList[i] ?? "").trim();
      if (!itemId || !unitsText) continue; // an untouched blank row

      const units = Number(unitsText);
      if (!Number.isInteger(units) || units <= 0) {
        throw new Error("Units must be a whole number of containers, greater than zero.");
      }
      /*
        What one container on THIS delivery held.

        Ufacid comes in 250 kg drums and in 200 kg drums. The item carries a
        usual size and that is what pre-fills the box, but the weight that
        actually arrived is a fact about the lorry, not about the substance —
        booking three of the smaller drums against the larger size put the shop
        50 kg out with nothing on any screen to say why. Blank falls back to the
        item's usual size, which is what an unchanged row means.
      */
      const sizeText = String(sizeList[i] ?? "").trim();
      const size = sizeText ? Number(sizeText) : 0;
      if (sizeText && !(size > 0)) {
        throw new Error("What one container holds has to be more than nothing.");
      }

      lines.push({
        itemId,
        units,
        sizeMilli: size > 0 ? Math.round(size * 1000) : undefined,
        costCents: centsFromField(costList[i] ?? null, "The line cost"),
      });
    }

    if (!lines.length) return { error: "Add at least one line before saving the delivery." };

    const supplierRaw = String(formData.get("supplier_id") ?? "").trim();
    const user = await requireUser();

    const res = recordPurchase({
      supplierId: supplierRaw ? Number(supplierRaw) : null,
      ref: String(formData.get("ref") ?? ""),
      transportCents: centsFromField(formData.get("transport"), "Transport"),
      lines,
      userId: user.id,
    });

    revalidatePath("/purchases");
    revalidatePath("/stock");

    return {
      ok:
        `Delivery recorded: ${res.lines.length} ${res.lines.length === 1 ? "line" : "lines"}, ` +
        `${formatKes(res.totalCents)} landed` +
        (res.transportCents ? ` (${formatKes(res.transportCents)} transport spread across the lines).` : "."),
    };
  } catch (err) {
    return { error: message(err) };
  }
}
