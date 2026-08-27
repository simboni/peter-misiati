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
