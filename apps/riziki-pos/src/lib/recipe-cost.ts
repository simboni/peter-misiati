/**
 * What the chemicals in a recipe cost the shop.
 *
 * The shop sells mixed products — twenty litres of multipurpose soap, five of
 * toilet cleaner — that it never buys. Nothing arrives on a lorry called
 * "Multipurpose Soap", so the item has no delivery behind it and no cost price
 * of its own. Its cost is the sum of what went into it, at what those
 * chemicals cost, and that is the only place it can come from.
 *
 * A SALE already does this: billing a recipe bundle writes the parent line at
 * the agreed price and an ingredient line under it for each chemical, carrying
 * the cost. So the profit on a mix sold is already right. What was missing is
 * the same sum BEFORE the sale — the question "what does a drum of this cost
 * me to make, and what am I making on it" — which is how a price gets set
 * rather than guessed.
 *
 * It is also the only way to see the hole underneath: if a chemical has no cost
 * price, its ingredient line is costed at nothing and the mix silently looks
 * more profitable than it is. That is not an error anywhere — every figure adds
 * up — it is simply a cost of zero being believed. `missing` is what says so.
 */

import { get } from "./db.ts";
import { mixFor } from "./production.ts";

const MILLI = 1000;

export interface RecipeIngredientCost {
  itemId: number | null;
  /** The chemical as the recipe names it. */
  name: string;
  /** kg, L or pcs. */
  unit: string;
  /** How much this batch needs. */
  qtyMilli: number;
  /** What one kg / L / piece of it cost, weighted average. */
  unitCostCents: number;
  /** `qtyMilli` at `unitCostCents`, rounded once — what this much of it cost. */
  costCents: number;
  /** Nothing is known about what this one cost. Counted as zero, which it is not. */
  noCost: boolean;
}

export interface RecipeCost {
  versionId: number;
  formulaName: string;
  /** The batch this was costed at, in milli. */
  madeMilli: number;
  unit: string;
  ingredients: RecipeIngredientCost[];
  /** What the whole batch cost, counting only what is known. */
  totalCents: number;
  /** The chemicals with no cost price, by name. Empty means the total is whole. */
  missing: string[];
  /** True when every ingredient has a cost price, so the total can be trusted. */
  complete: boolean;
}

/**
 * Cost one batch of a recipe, from the chemicals up.
 *
 * Built on `mixFor` rather than on the formula rows directly, so the chemical
 * is resolved to the same drum a sale would weigh it out of. Costing against a
 * different row than the one that is actually billed would produce a margin
 * nobody could reproduce at the till.
 */
export function recipeCost(versionId: number, madeMilli: number): RecipeCost {
  const mix = mixFor(versionId, madeMilli);

  const ingredients = mix.ingredients.map<RecipeIngredientCost>((ing) => {
    const row =
      ing.itemId === null
        ? null
        : get<{ cost_cents: number }>(`SELECT cost_cents FROM items WHERE id = ?`, ing.itemId);
    const unitCostCents = row?.cost_cents ?? 0;
    return {
      itemId: ing.itemId,
      name: ing.chemicalName,
      unit: ing.unit,
      qtyMilli: ing.qtyMilli,
      unitCostCents,
      costCents: Math.round((unitCostCents * ing.qtyMilli) / MILLI),
      noCost: unitCostCents <= 0,
    };
  });

  const missing = ingredients.filter((i) => i.noCost).map((i) => i.name);

  return {
    versionId,
    formulaName: mix.formulaName,
    madeMilli,
    unit: mix.unit,
    ingredients,
    totalCents: ingredients.reduce((sum, i) => sum + i.costCents, 0),
    missing,
    complete: missing.length === 0,
  };
}

export interface BundleMargin {
  sizeMilli: number;
  priceCents: number;
  /** What the chemicals for one of these cost. */
  costCents: number;
  /** Price less cost. Negative means the shop pays to sell it. */
  profitCents: number;
  /**
   * Profit as a share of the price, 0–100, rounded to one place.
   *
   * Of the PRICE, not of the cost: "we make 45% on it" is how a shop talks
   * about a margin, and marking up 82% on cost is the same number said in a way
   * that cannot be compared against the takings.
   */
  marginPct: number;
  /** Chemicals with no cost price. While this has names in it, the rest is a floor. */
  missing: string[];
}

/**
 * The margin on one size of a mixed product.
 *
 * `missing` is not a footnote. A bundle costed with two of its seven chemicals
 * unpriced will show a margin far better than the real one, and the figure is
 * arithmetically correct the whole time — so the names have to travel with it
 * or the screen quietly lies.
 */
export function bundleMargin(
  versionId: number,
  bundle: { sizeMilli: number; priceCents: number },
): BundleMargin {
  const cost = recipeCost(versionId, bundle.sizeMilli);
  const profitCents = bundle.priceCents - cost.totalCents;
  return {
    sizeMilli: bundle.sizeMilli,
    priceCents: bundle.priceCents,
    costCents: cost.totalCents,
    profitCents,
    marginPct:
      bundle.priceCents > 0 ? Math.round((profitCents * 1000) / bundle.priceCents) / 10 : 0,
    missing: cost.missing,
  };
}
