"use server";

/**
 * Server actions for suppliers and deliveries.
 *
 * Recording a purchase means handling cost prices, which the contract keeps
 * away from staff — so the gate is `isOwner()` on the server, not a hidden
 * form. A Server Action can be POSTed to directly; hiding the UI proves nothing.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, requirePermission, currentCan } from "@/lib/auth";
import {
  createSupplier,
  updateSupplier,
  deleteSupplier,
  setSupplierHidden,
  recordPurchase,
  voidPurchase,
  type PurchaseLineInput,
} from "@/lib/purchasing";
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

/**
 * Take a supplier off the list.
 *
 * Owner-only, and a plain action rather than a `useActionState` one because the
 * button that calls it holds "tap again to confirm" — a client component can
 * only be handed an action from a module marked "use server".
 *
 * The rule is `deleteSupplier`'s: anyone with a delivery against them is
 * refused there, and the message says to hide them instead. The refusal comes
 * back on the URL because the row it belonged to is about to re-render.
 *
 * `redirect` is outside the try on purpose — it reports by throwing, so a catch
 * around it would swallow the redirect and report it as a failure instead.
 */
export async function deleteSupplierAction(formData: FormData): Promise<void> {
  const owner = await requirePermission("purchases");
  let failed: string | null = null;
  try {
    deleteSupplier(Number(formData.get("supplierId")), owner.id);
  } catch (err) {
    failed = message(err);
  }
  if (failed) redirect(`/purchases?err=${encodeURIComponent(failed)}#suppliers`);
  revalidatePath("/purchases");
  redirect("/purchases#suppliers");
}

/** Hide a supplier the shop has stopped using, or bring one back. */
export async function setSupplierHiddenAction(formData: FormData): Promise<void> {
  const owner = await requirePermission("purchases");
  let failed: string | null = null;
  try {
    setSupplierHidden(
      Number(formData.get("supplierId")),
      String(formData.get("hidden")) === "1",
      owner.id,
    );
  } catch (err) {
    failed = message(err);
  }
  if (failed) redirect(`/purchases?err=${encodeURIComponent(failed)}#suppliers`);
  revalidatePath("/purchases");
  redirect("/purchases#suppliers");
}

export async function recordPurchaseAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireUser();
  if (!(await currentCan("purchases"))) {
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

/**
 * Undo a delivery that should never have been entered.
 *
 * Owner-only, and never a delete: the delivery stays on the list struck
 * through with the reason beside it, the stock it brought in goes back out as
 * its own ledger entry, and every cost price it touched is worked out again
 * from scratch.
 *
 * A plain action rather than a `useActionState` one, because the row it is
 * pressed on is re-rendered the moment it succeeds — there is nothing left
 * holding a message, so the message travels on the URL the way a refused
 * supplier delete already does.
 *
 * `redirect` is outside the try on purpose: it reports by throwing, so a catch
 * around it would swallow the redirect and report it as a failure instead.
 */
export async function voidPurchaseAction(formData: FormData): Promise<void> {
  const owner = await requirePermission("purchases");
  const back = String(formData.get("back") ?? "");
  let failed: string | null = null;
  let said: string | null = null;

  try {
    const res = voidPurchase(
      Number(formData.get("purchaseId")),
      owner.id,
      String(formData.get("reason") ?? ""),
    );
    // What the owner needs to hear is not "done" — it is where the cost prices
    // landed and whether anything is now counted below zero, which happens
    // honestly when goods out of a cancelled delivery were already sold.
    const priced = res.recosted
      .map((r) => `${r.name} now costs ${formatKes(r.costCents)}`)
      .join(", ");
    const short = res.nowBelowZero
      .map((b) => `${b.name} is ${Math.round(b.shortMilli) / 1000} ${b.unit} below zero`)
      .join(", ");
    said =
      `${res.ref || "That delivery"} undone, ${formatKes(res.totalCents)} off the books.` +
      (priced ? ` ${priced}.` : "") +
      (short ? ` Count these again: ${short}.` : "");
  } catch (err) {
    failed = message(err);
  }

  revalidatePath("/purchases");
  revalidatePath("/stock");
  revalidatePath("/reports");
  revalidatePath("/items");

  const sep = back.includes("?") ? "&" : "?";
  if (failed) redirect(`/purchases${back}${sep}err=${encodeURIComponent(failed)}#deliveries`);
  redirect(`/purchases${back}${sep}ok=${encodeURIComponent(said ?? "")}#deliveries`);
}
