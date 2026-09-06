/**
 * The mixing board: making a recipe in advance instead of billing it at the till.
 *
 * A recipe can work two ways in this system, and they are mutually exclusive.
 *
 *   MIXED TO ORDER (`formulas.output_item_id` is null) — the counter sells a
 *   size and the ingredients come off the shelf at that moment. The shop holds
 *   no stock of the mix. This is what every recipe did before this file, and
 *   what most of them should go on doing.
 *
 *   MIXED IN ADVANCE (`output_item_id` set) — the owner runs a batch here: the
 *   ingredients leave the shelf now, and what they make arrives on the shelf as
 *   an ordinary counted product. Selling it afterwards is an ordinary sale of
 *   an ordinary item, so not one line of the counter changes.
 *
 * Why both exist. A phantom recipe cannot answer "how much mild have I got",
 * because the mild does not exist until somebody buys it — and that is the
 * question the shop asks when it dilutes half a drum on Monday and sells it
 * through the week. A stocked product answers it. But a stocked product also
 * costs the shop a chore: somebody must remember to run the batch, and if they
 * forget, the till says "none left" over a full jerrican. That trade is real
 * and it is the shop's to make, one recipe at a time, which is why the switch
 * is a column on the recipe and not a setting for the whole system.
 *
 * The one thing that must never happen is both at once. A recipe with an
 * output product is not offered at the counter at all (see the sell screen's
 * recipe feed), because otherwise the concentrate would leave the books twice:
 * once when the batch was mixed and again when the mix was sold.
 *
 * WHAT IS NOT MODELLED, deliberately:
 *
 *   Water. It is not stock. It has no cost, nobody counts it, and a stock line
 *   for mains water is one that would sit wrong for ever. The recipe says how
 *   much to add and the batch simply makes more than went into it — an output
 *   larger than the sum of its inputs is normal here, not an error to catch.
 *
 *   Work in progress. A batch is one instant: the inputs leave and the output
 *   arrives in a single transaction, or neither happens. That atomicity is the
 *   whole defence against double-counting, and it is why there is no half-made
 *   state to reconcile.
 *
 * Nothing here imports from `next/*`, so it can be unit-tested under Node.
 */

import { all, get, run, tx, audit, postMovement, stockOf, type Item } from "./db.ts";
import { itemBundles, type Bundle } from "./bundles.ts";
import { MILLI, formatQty } from "./units.ts";
import { currentVersion, scaleFormula, versionById, formulaById } from "./production.ts";

export class MixError extends Error {}

// ------------------------------------------------------------------ the switch

/**
 * Point a recipe at the product it makes, or unpoint it.
 *
 * Refused when the output is one of the recipe's own ingredients: a mix that
 * eats itself would consume the stock it had just created, and the arithmetic
 * would look plausible right up until the shelf went negative.
 */
export function setFormulaOutput(
  formulaId: number,
  itemId: number | null,
  userId: number,
): void {
  const formula = formulaById(formulaId);
  if (!formula) throw new MixError("That recipe no longer exists.");

  if (itemId === null) {
    run(`UPDATE formulas SET output_item_id = NULL WHERE id = ?`, formulaId);
    audit(userId, "formula_output_cleared", "formula", formulaId, formula.name);
    return;
  }

  const item = get<Item>(`SELECT * FROM items WHERE id = ? AND active = 1`, itemId);
  if (!item) throw new MixError("That product is not on the catalogue.");

  const version = currentVersion(formulaId);
  if (!version) throw new MixError("That recipe has no current version.");

  const usesItself = scaleFormula(version.id, version.ref_size_milli).some(
    (line) => line.chemicalId === item.chemical_id,
  );
  if (usesItself) {
    throw new MixError(
      `${formula.name} already uses ${item.name} as an ingredient, so it cannot also be ` +
        `what the recipe makes.`,
    );
  }

  // One recipe per product. Two recipes both claiming to make the same thing
  // would each add to its stock with different ingredients behind them, and
  // nothing on the shelf would say which batch a kilogram came from.
  const taken = get<{ id: number; name: string }>(
    `SELECT f.id, f.name FROM formulas f WHERE f.output_item_id = ? AND f.id <> ? AND f.active = 1`,
    itemId,
    formulaId,
  );
  if (taken) {
    throw new MixError(`${item.name} is already made by the recipe "${taken.name}".`);
  }

  run(`UPDATE formulas SET output_item_id = ? WHERE id = ?`, itemId, formulaId);
  audit(userId, "formula_output_set", "formula", formulaId, `${formula.name} makes ${item.name}`);
}

// -------------------------------------------------------------------- planning

export interface MixPlanLine {
  chemicalId: number;
  chemicalName: string;
  /** The row the quantity actually comes off. Null when nothing stocks it. */
  itemId: number | null;
  itemName: string;
  unit: string;
  /** How much this batch needs. */
  neededMilli: number;
  /** How much is on the shelf. */
  availableMilli: number;
  short: boolean;
  /** What that quantity is worth at the item's weighted average cost. */
  costCents: number;
}

export interface MixPlan {
  formulaId: number;
  versionId: number;
  formulaName: string;
  /** What the batch is measured in — the recipe's own unit. */
  unit: string;
  outputItemId: number;
  outputName: string;
  outputUnit: string;
  /** What is already on the shelf of the thing being made. */
  outputOnHandMilli: number;
  /** The batch being planned. */
  targetMilli: number;
  lines: MixPlanLine[];
  totalCostCents: number;
  /** The biggest batch the store could carry right now. */
  possibleMilli: number;
  /** Every ingredient is stocked, priced and present in enough quantity. */
  canMake: boolean;
  /** Whatever stands in the way, said plainly. */
  problems: string[];
}

/**
 * The row a chemical is actually weighed out of.
 *
 * Mirrors `production.sellableSource` on purpose — the mixing board must take
 * stock off exactly the row the counter would have — but drops `sellable`:
 * something the shop mixes with need not be sold over the counter.
 */
function stockSource(chemicalId: number) {
  return get<{ id: number; name: string; cost_cents: number; qty_milli: number; canonical_unit: string }>(
    `SELECT i.id, i.name, i.cost_cents, i.canonical_unit,
            COALESCE(SUM(m.delta_milli), 0) AS qty_milli
       FROM items i
       LEFT JOIN stock_movements m ON m.item_id = i.id
      WHERE i.chemical_id = ? AND i.price_basis = 'unit' AND i.active = 1
      GROUP BY i.id
      ORDER BY qty_milli DESC, i.id
      LIMIT 1`,
    chemicalId,
  );
}

/**
 * What one batch of this size would take, and whether the store can carry it.
 *
 * Read-only. The numbers it returns seed the form; what the owner types over
 * them is what gets recorded.
 */
export function planMix(versionId: number, targetMilli: number): MixPlan {
  const version = versionById(versionId);
  if (!version) throw new MixError("That recipe version no longer exists.");
  const formula = formulaById(version.formula_id);
  if (!formula) throw new MixError("That recipe no longer exists.");
  if (!formula.output_item_id) {
    throw new MixError(
      `${formula.name} is mixed to order — it is billed as its ingredients at the counter. ` +
        `Give it a product to make before mixing a batch of it.`,
    );
  }

  const output = get<Item>(`SELECT * FROM items WHERE id = ?`, formula.output_item_id);
  if (!output) throw new MixError("The product this recipe makes is no longer on the catalogue.");

  const target = Math.max(1, Math.round(targetMilli));
  const problems: string[] = [];
  let possibleMilli = Number.POSITIVE_INFINITY;
  let totalCostCents = 0;

  const lines: MixPlanLine[] = scaleFormula(versionId, target).map((line) => {
    const source = stockSource(line.chemicalId);
    if (!source) {
      possibleMilli = 0;
      problems.push(`${line.chemicalName} is not stocked — nothing to mix it out of.`);
      return {
        chemicalId: line.chemicalId,
        chemicalName: line.chemicalName,
        itemId: null,
        itemName: line.chemicalName,
        unit: line.unit,
        neededMilli: line.neededMilli,
        availableMilli: 0,
        short: true,
        costCents: 0,
      };
    }

    const costCents = Math.round((source.cost_cents * line.neededMilli) / MILLI);
    totalCostCents += costCents;

    const short = line.neededMilli > source.qty_milli;
    if (short) {
      problems.push(
        `${source.name}: ${formatQty(line.neededMilli, source.canonical_unit)} needed, ` +
          `${formatQty(Math.max(0, source.qty_milli), source.canonical_unit)} in the store.`,
      );
    }

    // How big a batch this one ingredient could carry alone. The batch's limit
    // is the tightest of them — which is also the number worth showing.
    if (line.refQtyMilli > 0) {
      possibleMilli = Math.min(
        possibleMilli,
        Math.floor((Math.max(0, source.qty_milli) * version.ref_size_milli) / line.refQtyMilli),
      );
    }

    return {
      chemicalId: line.chemicalId,
      chemicalName: line.chemicalName,
      itemId: source.id,
      itemName: source.name,
      unit: source.canonical_unit,
      neededMilli: line.neededMilli,
      availableMilli: Math.max(0, source.qty_milli),
      short,
      costCents,
    };
  });

  if (!lines.length) problems.push("This recipe has no ingredients written down.");

  return {
    formulaId: formula.id,
    versionId,
    formulaName: formula.name,
    unit: version.ref_unit,
    outputItemId: output.id,
    outputName: output.name,
    outputUnit: output.canonical_unit,
    outputOnHandMilli: Math.max(0, stockOf(output.id)),
    targetMilli: target,
    lines,
    totalCostCents,
    possibleMilli: Number.isFinite(possibleMilli) ? Math.max(0, possibleMilli) : 0,
    canMake: lines.length > 0 && problems.length === 0,
    problems,
  };
}

/** Every recipe that has been told what it makes, with its shelf figures. */
export interface MixableRow {
  formulaId: number;
  versionId: number;
  name: string;
  unit: string;
  refSizeMilli: number;
  outputItemId: number;
  outputName: string;
  outputUnit: string;
  outputOnHandMilli: number;
  possibleMilli: number;
  ingredientCount: number;
  /**
   * The sizes the made product is SOLD in, with their prices.
   *
   * The shop does not think "I am making 66 kg"; it thinks "two 23s and four
   * 5s". These are the same sizes the counter sells, read off the output
   * product itself, so the board asks the batch in the units the person at the
   * drum is actually filling — and can say what the batch will be worth.
   */
  outputBundles: Array<{ id: number; sizeMilli: number; priceCents: number }>;
  /** What one kg / L of it sells for, for a batch that is not a round size. */
  outputPriceCents: number;
  /**
   * How the mix is made, in the owner's own words.
   *
   * This is where the water lives. It is not an ingredient — it has no cost and
   * no shelf — but it is most of what the person at the drum needs to be told,
   * so the batch form prints it rather than making them remember it or open the
   * recipe in another tab.
   */
  steps: string;
}

export function mixableFormulas(): MixableRow[] {
  const rows = all<{
    formula_id: number;
    name: string;
    version_id: number;
    ref_size_milli: number;
    ref_unit: string;
    steps: string;
    output_item_id: number;
    output_name: string;
    output_unit: string;
    output_price_cents: number;
    ingredient_count: number;
  }>(
    `SELECT f.id AS formula_id, f.name, v.id AS version_id,
            v.ref_size_milli, v.ref_unit, v.steps,
            i.id AS output_item_id, i.name AS output_name, i.canonical_unit AS output_unit,
            i.price_cents AS output_price_cents,
            (SELECT COUNT(*) FROM formula_items fi WHERE fi.formula_version_id = v.id)
              AS ingredient_count
       FROM formulas f
       JOIN formula_versions v ON v.formula_id = f.id AND v.is_current = 1
       JOIN items i ON i.id = f.output_item_id AND i.active = 1
      WHERE f.active = 1 AND f.output_item_id IS NOT NULL
      ORDER BY f.name`,
  );

  return rows.map((r) => {
    // One planning pass per recipe, at its own reference size, purely to learn
    // how much the store could carry. Cheap: these are a handful of rows.
    let possibleMilli = 0;
    try {
      possibleMilli = planMix(r.version_id, r.ref_size_milli).possibleMilli;
    } catch {
      possibleMilli = 0;
    }
    return {
      formulaId: r.formula_id,
      versionId: r.version_id,
      name: r.name,
      unit: r.ref_unit,
      refSizeMilli: r.ref_size_milli,
      outputItemId: r.output_item_id,
      outputName: r.output_name,
      outputUnit: r.output_unit,
      outputBundles: itemBundles(r.output_item_id).map((b: Bundle) => ({
        id: b.id,
        sizeMilli: b.sizeMilli,
        priceCents: b.priceCents,
      })),
      outputPriceCents: r.output_price_cents,
      outputOnHandMilli: Math.max(0, stockOf(r.output_item_id)),
      possibleMilli,
      ingredientCount: r.ingredient_count,
      steps: r.steps ?? "",
    };
  });
}

// ------------------------------------------------------------------- recording

export interface MixUsed {
  itemId: number;
  qtyMilli: number;
}

export interface RecordMixInput {
  versionId: number;
  /** What the recipe was aimed at — kept so a run can be compared to its plan. */
  targetMilli: number;
  /** What actually came out, in the output product's own unit. */
  actualMilli: number;
  /**
   * What actually went in. Omitted means "exactly what the plan said", which is
   * the ordinary case; supplied when the jug disagreed with the arithmetic.
   */
  used?: MixUsed[];
  userId: number;
  note?: string;
}

export interface MixResult {
  batchId: number;
  batchNo: string;
  outputItemId: number;
  outputName: string;
  /** The made product's own unit — a diluted hypo is kg, a shampoo is L. */
  outputUnit: string;
  madeMilli: number;
  /** What left the shelf, for the message afterwards. */
  consumed: Array<{ itemId: number; name: string; qtyMilli: number; unit: string }>;
  /** The new weighted average cost of the product that was made, per unit. */
  outputCostCents: number;
  totalCostCents: number;
}

/**
 * Run a batch: the ingredients leave the shelf and what they make arrives on it.
 *
 * Both quantities are the owner's, not the recipe's. The recipe seeds the form;
 * what is typed over it is what the ledger believes, because the shop dilutes
 * by eye with a hosepipe and a system that insists on 23.000 kg is a system
 * that gets lied to. The difference is the stock take's to find.
 *
 * THE COST. All of the money that went in lands on what came out, and what came
 * out is heavier — so the made product costs LESS per kilogram than what it was
 * made from. 12 kg of concentrate at KES 300 makes 23 kg of mild at about
 * KES 156/kg, because the water carried mass but no money. Carrying the
 * concentrate's own per-kilogram cost across instead would overstate the value
 * of the shelf by nearly double and make the shop's best margin look like its
 * worst — silently, in both directions.
 *
 * Everything happens inside one transaction. Inputs and output post together or
 * neither does; a batch that consumed without producing is exactly the
 * double-count this whole design exists to prevent.
 */
export function recordMix(input: RecordMixInput): MixResult {
  const plan = planMix(input.versionId, input.targetMilli);

  const madeMilli = Math.round(input.actualMilli);
  if (!(madeMilli > 0)) {
    throw new MixError("Say how much the batch actually made.");
  }

  /*
    What actually went in.

    The plan is the default. A supplied list overrides it line for line, keyed
    by item, so an owner who poured 12.4 kg rather than 12 records 12.4 — but
    an ingredient the plan names cannot be dropped, or the batch would claim to
    have been made out of less than it was.
  */
  const typed = new Map((input.used ?? []).map((u) => [u.itemId, Math.round(u.qtyMilli)]));
  const consuming = plan.lines.map((line) => {
    if (line.itemId === null) {
      throw new MixError(
        `${line.chemicalName} is not stocked, so a batch cannot be taken out of it. ` +
          `Add it as a product first.`,
      );
    }
    const qtyMilli = typed.has(line.itemId) ? typed.get(line.itemId)! : line.neededMilli;
    if (!(qtyMilli > 0)) {
      throw new MixError(`How much ${line.itemName} went in?`);
    }
    return { line, itemId: line.itemId, qtyMilli };
  });

  if (!consuming.length) throw new MixError("This recipe has no ingredients written down.");

  return tx(() => {
    const output = get<Item>(`SELECT * FROM items WHERE id = ?`, plan.outputItemId);
    if (!output) throw new MixError("The product this recipe makes is no longer on the catalogue.");

    /*
      Stock is checked inside the transaction, against the shelf as it is now.

      The plan was drawn some seconds ago on somebody's phone; a sale in between
      is entirely possible, and it is this read — not the one the form was drawn
      from — that decides whether the batch can be made.
    */
    let totalCostCents = 0;
    const consumed: MixResult["consumed"] = [];

    for (const c of consuming) {
      const item = get<Item>(`SELECT * FROM items WHERE id = ? AND active = 1`, c.itemId);
      if (!item) throw new MixError(`${c.line.itemName} is no longer on the catalogue.`);

      const onHand = stockOf(item.id);
      if (c.qtyMilli > onHand) {
        throw new MixError(
          `Not enough ${item.name}: ${formatQty(c.qtyMilli, item.canonical_unit)} needed, ` +
            `${formatQty(Math.max(0, onHand), item.canonical_unit)} in the store. ` +
            `If there is more than the book says, do a stock take first.`,
        );
      }

      totalCostCents += Math.round((item.cost_cents * c.qtyMilli) / MILLI);
      consumed.push({
        itemId: item.id,
        name: item.name,
        qtyMilli: c.qtyMilli,
        unit: item.canonical_unit,
      });
    }

    /*
      The made product's new average cost.

      Same weighted average a delivery uses, for the same reason: what is
      already on the shelf keeps the value it was made at, and this batch brings
      its own money in at its own rate.
    */
    const alreadyMilli = Math.max(0, stockOf(output.id));
    const alreadyCents = Math.round((alreadyMilli * output.cost_cents) / MILLI);
    const totalMilli = alreadyMilli + madeMilli;
    const outputCostCents =
      totalMilli > 0
        ? Math.round(((alreadyCents + totalCostCents) * MILLI) / totalMilli)
        : output.cost_cents;

    const batchNo = nextBatchNo();
    const { lastInsertRowid: batchId } = run(
      `INSERT INTO batches (formula_version_id, batch_no, output_item_id,
                            target_milli, actual_milli, cost_cents, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      input.versionId,
      batchNo,
      output.id,
      plan.targetMilli,
      madeMilli,
      totalCostCents,
      input.userId,
    );

    for (const c of consuming) {
      const item = consumed.find((x) => x.itemId === c.itemId)!;
      run(
        `INSERT INTO batch_lines (batch_id, chemical_id, item_id, qty_milli, cost_cents)
         VALUES (?, ?, ?, ?, ?)`,
        batchId,
        c.line.chemicalId,
        c.itemId,
        c.qtyMilli,
        Math.round(
          (get<Item>(`SELECT * FROM items WHERE id = ?`, c.itemId)!.cost_cents * c.qtyMilli) / MILLI,
        ),
      );
      postMovement({
        itemId: c.itemId,
        deltaMilli: -c.qtyMilli,
        reason: "batch_consume",
        refType: "batch",
        refId: batchId,
        userId: input.userId,
        note: `${batchNo} · ${plan.formulaName}`,
      });
      void item;
    }

    postMovement({
      itemId: output.id,
      deltaMilli: madeMilli,
      reason: "batch_output",
      refType: "batch",
      refId: batchId,
      userId: input.userId,
      note: `${batchNo} · ${plan.formulaName}`,
    });

    run(`UPDATE items SET cost_cents = ? WHERE id = ?`, outputCostCents, output.id);

    audit(
      input.userId,
      "batch_mixed",
      "item",
      output.id,
      `${batchNo}: ${formatQty(madeMilli, output.canonical_unit)} ${output.name} ` +
        `from ${consumed
          .map((c) => `${formatQty(c.qtyMilli, c.unit)} ${c.name}`)
          .join(", ")}${input.note ? ` · ${input.note}` : ""}`,
    );

    return {
      batchId,
      batchNo,
      outputItemId: output.id,
      outputName: output.name,
      outputUnit: output.canonical_unit,
      madeMilli,
      consumed,
      outputCostCents,
      totalCostCents,
    };
  });
}

/**
 * A readable, unique batch number: B-260906-3.
 *
 * The date first so a label found on a shelf says roughly when it was mixed
 * without anybody having to look it up, and a per-day counter after it so two
 * batches on one afternoon cannot collide.
 */
function nextBatchNo(): string {
  // SQLite's strftime has no two-digit year, so the century is trimmed off a
  // four-digit one. Nairobi is UTC+3 and the file is UTC, so a batch mixed at
  // nine in the evening is dated the day it was actually mixed.
  const today = get<{ d: string }>(
    `SELECT substr(strftime('%Y%m%d', 'now', '+3 hours'), 3) AS d`,
  )!.d;
  const n =
    (get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM batches WHERE batch_no LIKE ?`,
      `B-${today}-%`,
    )?.n ?? 0) + 1;
  return `B-${today}-${n}`;
}

// --------------------------------------------------------------------- history

export interface BatchRow {
  id: number;
  at: string;
  batchNo: string;
  formulaName: string;
  outputName: string;
  outputUnit: string;
  madeMilli: number;
  targetMilli: number;
  costCents: number;
  userName: string | null;
  inputs: string;
}

/** What has been mixed lately, newest first. */
export function recentBatches(limit = 30): BatchRow[] {
  return all<BatchRow>(
    `SELECT b.id, b.at, b.batch_no AS batchNo,
            f.name AS formulaName,
            i.name AS outputName, i.canonical_unit AS outputUnit,
            COALESCE(b.actual_milli, 0) AS madeMilli,
            b.target_milli AS targetMilli,
            b.cost_cents AS costCents,
            u.name AS userName,
            -- "12 kg Hypochlorite 10%", not "Hypochlorite 10% 12.0": the
            -- quantity leads and carries its unit, the way every other line in
            -- this system reads. RTRIM twice drops a trailing ".0" without
            -- touching 12.5.
            COALESCE((SELECT GROUP_CONCAT(
                        RTRIM(RTRIM(printf('%.3f', bl.qty_milli / 1000.0), '0'), '.')
                          || ' ' || li.canonical_unit || ' ' || li.name, ', ')
                        FROM batch_lines bl
                        LEFT JOIN items li ON li.id = bl.item_id
                       WHERE bl.batch_id = b.id), '') AS inputs
       FROM batches b
       JOIN formula_versions v ON v.id = b.formula_version_id
       JOIN formulas f ON f.id = v.formula_id
       LEFT JOIN items i ON i.id = b.output_item_id
       LEFT JOIN users u ON u.id = b.user_id
      WHERE b.status = 'completed' AND b.output_item_id IS NOT NULL
      ORDER BY b.id DESC
      LIMIT ?`,
    limit,
  );
}
