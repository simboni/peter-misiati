/**
 * Formulas — the recipe book, and what a recipe comes to at the counter.
 *
 * Riziki is not a mixing house. It sells the chemicals and the customer mixes
 * them, so a formula here is a shopping list with quantities on it, not a work
 * order: "twenty litres of carwash shampoo" means so much Ungerol, so much
 * salt, so much colour, weighed out and charged by the kilogram.
 *
 * This lives outside the page files because it is the arithmetic worth
 * unit-testing — a mis-scaled recipe sells somebody the wrong drum — and
 * because who may see a recipe is a decision that has to be made on the server.
 *
 * Rules inherited from the contract and enforced here:
 *   - a recipe is never edited in place once something has been sold against
 *     it; editing inserts a new version, because those sale lines point at the
 *     old one and what the customer was charged for must stay true;
 *   - a sale records `formula_version_id`, never a bare `formula_id`.
 *
 * What used to be here and is not any more: `runBatch`, `recordYield`,
 * `planBatch`, `allocate` and the rest of the production engine. The shop
 * stopped mixing and bottling its own products, so nothing consumed a recipe
 * into stock any more. The `batches` tables are left in place — they hold what
 * was actually mixed while that was the way the shop worked, and deleting the
 * table would delete the history with it.
 */

import { all, get, run, tx, audit } from "./db.ts";
import { amountFor, priceOf } from "./sales.ts";
import { scaleMilli } from "./units.ts";

export type Unit = "kg" | "L" | "pcs";

// --------------------------------------------------------------- row shapes

export interface ChemicalRow {
  id: number;
  name: string;
  canonical_unit: Unit;
}

export interface FormulaRow {
  id: number;
  name: string;
  active: number;
}

export interface FormulaVersionRow {
  id: number;
  formula_id: number;
  version: number;
  ref_size_milli: number;
  steps: string;
  note: string;
  is_current: number;
  created_at: string;
  created_by: number | null;
}

export interface FormulaVersionWithUse extends FormulaVersionRow {
  /** Sales billed out of this version, plus any batches mixed against it. */
  use_count: number;
}

export interface FormulaItemRow {
  id: number;
  chemical_id: number;
  chemical_name: string;
  canonical_unit: Unit;
  qty_milli: number;
  sort_order: number;
}

export interface FormulaListRow {
  id: number;
  name: string;
  version_id: number;
  version: number;
  ref_size_milli: number;
  note: string;
  ingredient_count: number;
}

// ------------------------------------------------------------------- reads

export function listChemicals(): ChemicalRow[] {
  return all<ChemicalRow>(
    `SELECT id, name, canonical_unit FROM chemicals WHERE active = 1 ORDER BY name`,
  );
}

/**
 * Formulas, optionally filtered.
 *
 * The search deliberately reaches into the ingredients (and their aliases) as
 * well as the product name: the owner's real question at the counter is "what
 * do I make with magadi?", not "which formula is called magadi".
 */
export function listFormulas(q?: string): FormulaListRow[] {
  const base = `
    SELECT f.id,
           f.name,
           v.id             AS version_id,
           v.version        AS version,
           v.ref_size_milli AS ref_size_milli,
           v.note           AS note,
           (SELECT COUNT(*) FROM formula_items fi WHERE fi.formula_version_id = v.id) AS ingredient_count
      FROM formulas f
      JOIN formula_versions v ON v.formula_id = f.id AND v.is_current = 1
     WHERE f.active = 1`;

  const term = (q ?? "").trim();
  if (!term) return all<FormulaListRow>(`${base} ORDER BY f.name`);

  const like = `%${term}%`;
  return all<FormulaListRow>(
    `${base}
       AND (f.name LIKE ?
            OR EXISTS (SELECT 1
                         FROM formula_items fi
                         JOIN chemicals c ON c.id = fi.chemical_id
                        WHERE fi.formula_version_id = v.id
                          AND (c.name LIKE ? OR (c.aliases <> '' AND c.aliases LIKE ?))))
     ORDER BY f.name`,
    like,
    like,
    like,
  );
}

export function formulaById(id: number): FormulaRow | undefined {
  return get<FormulaRow>(`SELECT id, name, active FROM formulas WHERE id = ?`, id);
}

export function versionById(id: number): FormulaVersionRow | undefined {
  return get<FormulaVersionRow>(`SELECT * FROM formula_versions WHERE id = ?`, id);
}

export function currentVersion(formulaId: number): FormulaVersionRow | undefined {
  return get<FormulaVersionRow>(
    `SELECT * FROM formula_versions WHERE formula_id = ? AND is_current = 1`,
    formulaId,
  );
}

/** Newest first, with how much already depends on each version. */
export function versionsOf(formulaId: number): FormulaVersionWithUse[] {
  return all<FormulaVersionWithUse>(
    `SELECT v.*,
            (SELECT COUNT(DISTINCT l.sale_id) FROM sale_lines l WHERE l.formula_version_id = v.id)
              + (SELECT COUNT(*) FROM batches b WHERE b.formula_version_id = v.id) AS use_count
       FROM formula_versions v
      WHERE v.formula_id = ?
      ORDER BY v.version DESC`,
    formulaId,
  );
}

export function formulaItems(versionId: number): FormulaItemRow[] {
  return all<FormulaItemRow>(
    `SELECT fi.id,
            fi.chemical_id,
            c.name           AS chemical_name,
            c.canonical_unit AS canonical_unit,
            fi.qty_milli,
            fi.sort_order
       FROM formula_items fi
       JOIN chemicals c ON c.id = fi.chemical_id
      WHERE fi.formula_version_id = ?
      ORDER BY fi.sort_order, fi.id`,
    versionId,
  );
}

// ------------------------------------------------------------------ scaling

export interface ScaledLine {
  chemicalId: number;
  chemicalName: string;
  unit: Unit;
  /** Quantity as written on the formula sheet, per reference batch. */
  refQtyMilli: number;
  /** Quantity this batch needs. */
  neededMilli: number;
}

/**
 * Scale every ingredient from the reference batch to the target size.
 *
 * `scaleMilli` multiplies before it divides, so 1.5 kg per 20 L scaled to 100 L
 * is exactly 7.5 kg — no floating point drift creeping into a drum.
 */
export function scaleFormula(versionId: number, targetMilli: number): ScaledLine[] {
  const version = versionById(versionId);
  if (!version) throw new Error("That formula version no longer exists.");

  return formulaItems(versionId).map((item) => ({
    chemicalId: item.chemical_id,
    chemicalName: item.chemical_name,
    unit: item.canonical_unit,
    refQtyMilli: item.qty_milli,
    neededMilli: scaleMilli(item.qty_milli, targetMilli, version.ref_size_milli),
  }));
}

/**
 * The smallest batch this formula can still be mixed accurately at.
 *
 * Below it the tiniest ingredient (10 ml of pine oil in 20 L) rounds away to
 * nothing, and a recipe with a missing ingredient is not the recipe.
 */
export function minimumTargetMilli(versionId: number): number {
  const version = versionById(versionId);
  if (!version) return 1000;
  let min = 1;
  for (const item of formulaItems(versionId)) {
    min = Math.max(min, Math.ceil((version.ref_size_milli * 0.5) / item.qty_milli));
  }
  return min;
}

// ------------------------------------------------------------ formula edits

export interface FormulaVersionInput {
  formulaId: number;
  refSizeMilli: number;
  steps: string;
  note: string;
  items: Array<{ chemicalId: number; qtyMilli: number }>;
  userId: number;
}

/**
 * How many sales were billed out of one formula version.
 *
 * Zero means the version is still only a piece of writing: nothing downstream
 * depends on the numbers in it, so correcting it destroys no record. The edit
 * screen asks this to tell the owner, before they type anything, whether the
 * save ahead of them corrects this recipe or forks a new version from it.
 *
 * This used to count batches. It counts sale lines now for the same reason it
 * ever counted anything: a recipe becomes history the moment somebody was
 * charged for it, and since the counter bills a mix as its ingredients, the
 * charge is the record. Old batches still count — they are the same question
 * asked of the shop's earlier way of working.
 */
export function salesUsingVersion(versionId: number): number {
  // DISTINCT: a mix is billed as several lines on one sale, and "sold on three
  // times" must mean three customers, not three chemicals.
  const lines =
    get<{ n: number }>(
      `SELECT COUNT(DISTINCT sale_id) AS n FROM sale_lines WHERE formula_version_id = ?`,
      versionId,
    )?.n ?? 0;
  const batches =
    get<{ n: number }>(`SELECT COUNT(*) AS n FROM batches WHERE formula_version_id = ?`, versionId)
      ?.n ?? 0;
  return lines + batches;
}

export function createFormulaVersion(input: FormulaVersionInput): {
  versionId: number;
  version: number;
  /** True when the existing version was corrected rather than a new one forked. */
  corrected: boolean;
} {
  if (!Number.isInteger(input.refSizeMilli) || input.refSizeMilli <= 0) {
    throw new Error("The reference batch size must be more than zero.");
  }

  const items = input.items.filter((i) => i.chemicalId > 0 && i.qtyMilli > 0);
  if (!items.length) throw new Error("A formula needs at least one ingredient.");

  const seen = new Set<number>();
  for (const item of items) {
    if (seen.has(item.chemicalId)) {
      throw new Error("The same chemical is listed twice — combine those rows into one.");
    }
    seen.add(item.chemicalId);
  }

  return tx(() => {
    const formula = formulaById(input.formulaId);
    if (!formula) throw new Error("That formula no longer exists.");

    // A version exists to protect the batches that were mixed against it. Until
    // a batch points at one, there is no history to protect — so correcting a
    // recipe that has never been used rewrites it where it stands instead of
    // forking. Without this, a shop fixing the placeholder recipes it was
    // delivered with walks its way to "version 6" of a product it has not made
    // once, and the version number stops meaning anything.
    const current = get<{ id: number; version: number }>(
      `SELECT id, version FROM formula_versions WHERE formula_id = ? AND is_current = 1`,
      input.formulaId,
    );
    const soldAgainstCurrent = current ? salesUsingVersion(current.id) : 0;
    const correctInPlace = Boolean(current) && soldAgainstCurrent === 0;

    let versionId: number | bigint;
    let version: number;

    if (correctInPlace && current) {
      versionId = current.id;
      version = current.version;
      run(
        `UPDATE formula_versions
            SET ref_size_milli = ?, steps = ?, note = ?, created_by = ?, created_at = datetime('now')
          WHERE id = ?`,
        input.refSizeMilli,
        input.steps,
        input.note,
        input.userId,
        current.id,
      );
      // The ingredient rows are replaced wholesale rather than diffed: a recipe
      // is the whole list, and a partial update is how a stray chemical from the
      // old version survives into the corrected one.
      run(`DELETE FROM formula_items WHERE formula_version_id = ?`, current.id);
    } else {
      const max =
        get<{ v: number }>(
          `SELECT COALESCE(MAX(version), 0) AS v FROM formula_versions WHERE formula_id = ?`,
          input.formulaId,
        )?.v ?? 0;
      version = max + 1;

      run(`UPDATE formula_versions SET is_current = 0 WHERE formula_id = ?`, input.formulaId);

      versionId = run(
        `INSERT INTO formula_versions (formula_id, version, ref_size_milli, steps, note, is_current, created_by)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
        input.formulaId,
        version,
        input.refSizeMilli,
        input.steps,
        input.note,
        input.userId,
      ).lastInsertRowid;
    }

    let order = 0;
    for (const item of items) {
      run(
        `INSERT INTO formula_items (formula_version_id, chemical_id, qty_milli, sort_order)
         VALUES (?, ?, ?, ?)`,
        versionId,
        item.chemicalId,
        item.qtyMilli,
        order++,
      );
    }

    audit(
      input.userId,
      "formula_version",
      "formula",
      input.formulaId,
      correctInPlace
        ? `${formula.name} · version ${version} corrected before anything was sold on it (${items.length} ingredients)`
        : `${formula.name} · version ${version} (${items.length} ingredients)`,
    );

    return { versionId, version, corrected: correctInPlace };
  });
}


// -------------------------------------------------- billing a mix at the till

export interface MixIngredient {
  chemicalId: number;
  chemicalName: string;
  unit: Unit;
  /** The row the quantity is weighed out of — the drum or bag on the floor. */
  itemId: number | null;
  itemName: string;
  /** What the recipe asks for at this batch size. */
  qtyMilli: number;
  /** The price per kg / L at the tier being sold on. */
  rateCents: number;
  /** `qtyMilli` at `rateCents`, rounded once. */
  amountCents: number;
  /** What is in the store right now, in milli. */
  availableMilli: number;
  /** No sellable row for this chemical at all — the catalogue is incomplete. */
  unlisted: boolean;
  /**
   * The shop stocks and sells this chemical, but still by the pack rather than
   * by the kilogram — so there is no rate to bill a recipe's 125 g against.
   *
   * A different thing from `unlisted`, and worth its own flag because the fix is
   * different and specific: one press of "move to per-kilogram pricing" on the
   * catalogue screen. Told it was "not on the price list", an attendant looking
   * at a shelf full of the stuff would reasonably conclude the till was broken.
   */
  legacyPackPriced: boolean;
  /** Listed but priced at zero: billing it would give it away. */
  unpriced: boolean;
  /** Listed and priced, but there is not enough of it in the store. */
  short: boolean;
}

export interface Mix {
  formulaId: number;
  versionId: number;
  formulaName: string;
  /** Batch size, in milli of the unit the formula's reference size is stated in. */
  targetMilli: number;
  ingredients: MixIngredient[];
  totalCents: number;
  /** True when every ingredient can be billed and handed over as it stands. */
  sellable: boolean;
  /**
   * The largest batch the store could supply today, in milli. Zero when
   * something on the recipe is unlisted, unpriced or simply finished — no batch
   * size fixes those, and saying "try 40 litres" when the pine oil ran out
   * would be a lie the counter would act on.
   */
  possibleMilli: number;
}

/**
 * A recipe, billed as the chemicals it is made of.
 *
 * This is the whole of what used to be the kit builder, and it is a much smaller
 * idea. The shop does not mix for anybody — the customer buys the ingredients
 * and mixes them at home — so the only question a recipe has to answer at the
 * counter is "how much of each, and what does that come to". Weigh it out of the
 * drum, charge by the kilogram, done.
 *
 * What that removed is worth stating, because it was the source of every
 * complaint about this feature. Ingredients used to be filled from pre-packed
 * sizes, so a recipe wanting 25 g of C.D.E could only be sold as the smallest
 * tub of C.D.E on the shelf — 5 kg, two hundred times too much — and the screen
 * had to refuse batches under about 500 litres for want of a small enough pack.
 * Weighing has no smallest size. Twenty litres of carwash shampoo is now an
 * ordinary sale, and so is one.
 *
 * The recipe itself is never shown to staff: this returns quantities, and the
 * screens that call it decide who may see them.
 *
 * There is no tier here any more. One price per chemical, argued inside its
 * band at the till like anything else — a recipe priced two ways was two
 * answers to "what will twenty litres cost me".
 */
export function mixFor(versionId: number, targetMilli: number): Mix {
  const version = versionById(versionId);
  if (!version) throw new Error("That formula version no longer exists.");
  const formula = formulaById(version.formula_id);

  let possibleMilli = Number.POSITIVE_INFINITY;

  const ingredients = scaleFormula(versionId, targetMilli).map<MixIngredient>((line) => {
    const source = sellableSource(line.chemicalId);

    if (!source) {
      possibleMilli = 0;
      // Sold by the pack, or not sold at all? The counter cannot act on the
      // first without being told which it is.
      const legacy = Boolean(
        get(
          `SELECT 1 FROM items
            WHERE chemical_id = ? AND sellable = 1 AND active = 1 AND price_basis <> 'unit'
            LIMIT 1`,
          line.chemicalId,
        ),
      );
      return {
        chemicalId: line.chemicalId,
        chemicalName: line.chemicalName,
        unit: line.unit,
        itemId: null,
        itemName: line.chemicalName,
        qtyMilli: line.neededMilli,
        rateCents: 0,
        amountCents: 0,
        availableMilli: 0,
        unlisted: !legacy,
        legacyPackPriced: legacy,
        unpriced: false,
        short: false,
      };
    }

    const rateCents = priceOf(source);
    const short = line.neededMilli > source.qty_milli;
    if (rateCents <= 0) possibleMilli = 0;

    // How big a batch this one ingredient could carry on its own. The recipe's
    // limit is the tightest of them, which is also the number worth telling the
    // counter: "there is enough here for 60 litres" beats "not enough Ungerol".
    if (line.refQtyMilli > 0) {
      const canMake = Math.floor((source.qty_milli * version.ref_size_milli) / line.refQtyMilli);
      possibleMilli = Math.min(possibleMilli, Math.max(0, canMake));
    }

    return {
      chemicalId: line.chemicalId,
      chemicalName: line.chemicalName,
      unit: line.unit,
      itemId: source.id,
      itemName: source.name,
      qtyMilli: line.neededMilli,
      rateCents,
      amountCents: rateCents > 0 ? amountFor(rateCents, line.neededMilli) : 0,
      availableMilli: source.qty_milli,
      unlisted: false,
      legacyPackPriced: false,
      unpriced: rateCents <= 0,
      short,
    };
  });

  return {
    formulaId: version.formula_id,
    versionId,
    formulaName: formula?.name ?? "Mix",
    targetMilli,
    ingredients,
    totalCents: ingredients.reduce((s, i) => s + i.amountCents, 0),
    sellable:
      ingredients.length > 0 &&
      ingredients.every((i) => !i.unlisted && !i.legacyPackPriced && !i.unpriced && !i.short),
    possibleMilli: Number.isFinite(possibleMilli) ? possibleMilli : 0,
  };
}

interface MixSource {
  id: number;
  name: string;
  price_cents: number;
  floor_cents: number;
  ceiling_cents: number;
  qty_milli: number;
}

/**
 * Where a chemical is weighed out of.
 *
 * One row per chemical is the intent — the drum or bag it is delivered in,
 * priced per kilogram. Ordered by stock anyway, so that a shop which has two
 * rows for the same substance (an old bag and a new one) mixes out of the one
 * with something in it rather than the one that happens to have the lower id.
 */
function sellableSource(chemicalId: number): MixSource | undefined {
  return get<MixSource>(
    `SELECT i.id, i.name, i.price_cents, i.floor_cents, i.ceiling_cents,
            COALESCE(SUM(m.delta_milli), 0) AS qty_milli
       FROM items i
       LEFT JOIN stock_movements m ON m.item_id = i.id
      WHERE i.chemical_id = ? AND i.price_basis = 'unit'
        AND i.sellable = 1 AND i.active = 1
      GROUP BY i.id
      ORDER BY qty_milli DESC, i.id
      LIMIT 1`,
    chemicalId,
  );
}
