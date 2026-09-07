"use server";

/**
 * Saying how the shelf is poured, and whether a product is poured at all.
 *
 * Owner-only, checked here rather than in the markup: a Server Action can be
 * POSTed to directly, so hiding a control proves nothing.
 */

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { fill, setPacked, packState, PackError } from "@/lib/packing";

export interface FillState {
  ok?: string;
  error?: string;
}

/**
 * Record how many of each size are standing filled.
 *
 * The form carries the COUNT the owner can see on the shelf, not the change —
 * "there are four 5 kg jerricans" is a thing you can check by looking, and
 * "add three" is a thing you have to work out. The difference against what the
 * tally already held is computed here.
 */
export async function saveFillAction(_prev: FillState, formData: FormData): Promise<FillState> {
  const owner = await requireOwner();
  const itemId = Number(formData.get("itemId"));
  if (!Number.isFinite(itemId) || itemId <= 0) return { error: "That product could not be found." };

  try {
    const before = packState(itemId);
    const lines = [];
    for (const size of before.sizes) {
      const raw = formData.get(`filled:${size.bundleId}`);
      if (raw === null) continue;
      const want = Math.floor(Number(String(raw).trim()));
      if (!Number.isFinite(want) || want < 0) {
        return { error: "A count of containers cannot be less than nothing." };
      }
      if (want !== size.filled) lines.push({ bundleId: size.bundleId, delta: want - size.filled });
    }
    if (!lines.length) return { ok: "Nothing changed — the shelf is already recorded that way." };

    const res = fill(itemId, lines, owner.id, String(formData.get("note") ?? "").trim() || undefined);

    revalidatePath("/items");
    revalidatePath("/stock");
    revalidatePath("/sell");
    revalidatePath("/mix");

    const said = res.moved
      .map(
        (m) =>
          `${m.delta > 0 ? "filled" : "opened"} ${Math.abs(m.delta)} × ` +
          `${m.sizeMilli / 1000} ${res.unit}`,
      )
      .join(", ");
    return { ok: `${res.itemName}: ${said}. ${res.looseMilli / 1000} ${res.unit} left loose.` };
  } catch (e) {
    return { error: e instanceof PackError ? e.message : "That could not be recorded." };
  }
}

/** Turn container-counting on or off for one product. */
export async function setPackedAction(formData: FormData): Promise<void> {
  const owner = await requireOwner();
  const itemId = Number(formData.get("itemId"));
  const on = String(formData.get("packed")) === "1";
  if (!Number.isFinite(itemId) || itemId <= 0) return;
  try {
    setPacked(itemId, on, owner.id);
  } catch {
    // The screen offers this only where it is possible; a refusal here means
    // the sizes went away between the page rendering and the button being
    // pressed, and the next render will say so.
  }
  revalidatePath("/items");
  revalidatePath("/stock");
  revalidatePath("/sell");
  revalidatePath("/mix");
}
