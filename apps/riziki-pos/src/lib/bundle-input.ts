/**
 * Reading bundle rows back off a form.
 *
 * Shared by the two screens that set them — a product's prices and a recipe's
 * sizes — because they post the same shape and a second copy of this would
 * eventually round differently from the first.
 *
 * JSON rather than flat form fields: the rows are a list whose length nobody
 * knows in advance, and reading `bundle_size_3` back out of a FormData is a
 * parser that will one day disagree with the screen that wrote it.
 */

import type { BundleInput } from "./bundles.ts";

export function parseBundleRows(raw: FormDataEntryValue | null): BundleInput[] {
  if (typeof raw !== "string" || !raw.trim()) return [];

  let rows: unknown;
  try {
    rows = JSON.parse(raw);
  } catch {
    // A corrupted hidden field must not be able to take a price save down with
    // it. Treated as "no sizes were sent", which the caller can act on.
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
    // A half-typed row is not an error, it is a row still being typed: somebody
    // adding a third size and saving the first two should not be stopped by the
    // empty one they left open.
    .filter((b) => b.sizeMilli > 0 && b.priceCents > 0);
}

/**
 * The price a recipe screen asks for, folded in beside the sizes it already has.
 *
 * A recipe states how much it makes and, directly under that, what a batch of
 * it costs. Those two are one size at one price — so the batch quantity IS the
 * size, and asking for it twice was the second step this screen used to have.
 *
 * Merged rather than replacing, and that is the whole point of this function:
 * `saveBundles` is set-replace, so handing it the batch row alone would switch
 * off a 5 L and a 10 L somebody had set on the recipe's own Sizes form. A blank
 * price box means "not priced here", never "remove the sizes" — a size is
 * removed with the Remove button that put it there.
 */
export function batchSizes(
  existing: Array<{ sizeMilli: number; priceCents: number; floorCents: number }>,
  refLitres: number,
  raw: FormDataEntryValue | null,
): BundleInput[] {
  const kept = existing.map((b) => ({
    sizeMilli: b.sizeMilli,
    priceCents: b.priceCents,
    floorCents: b.floorCents,
  }));

  const sizeMilli = Math.round((Number(refLitres) || 0) * 1000);
  const priceCents = Math.round((Number(raw) || 0) * 100);
  if (sizeMilli <= 0 || priceCents <= 0) return kept;

  const at = kept.findIndex((b) => b.sizeMilli === sizeMilli);
  if (at >= 0) kept[at] = { ...kept[at], priceCents };
  else kept.push({ sizeMilli, priceCents, floorCents: 0 });
  return kept;
}
