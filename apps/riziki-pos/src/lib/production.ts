/**
 * Production service — formulas, scaling, and turning a mix into ledger movements.
 *
 * This lives outside the page files for two reasons. First, the batch screen
 * renders two very different views of the same numbers: the owner sees the
 * recipe and its cost, staff never do, and the split has to be decided on the
 * server. Second, this is the arithmetic worth unit-testing — a mis-scaled
 * batch wastes a drum of Ungerol.
 *
 * Rules inherited from the contract and enforced here:
 *   - a recipe is never edited in place; editing inserts a new version, because
 *     past batches point at the old one and their cost must stay true;
 *   - stock only ever moves through `postMovement` inside `tx()`;
 *   - a batch records `formula_version_id`, never a bare `formula_id`.
 */

import { all, get, run, tx, postMovement, audit, updateAverageCost } from "./db.ts";
import { scaleMilli, businessDate, fromMilli, toMilli } from "./units.ts";

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
  batch_count: number;
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

export interface FinishedItemRow {
  id: number;
  name: string;
  canonical_unit: Unit;
  size_milli: number;
  unit_label: string;
  suggested: boolean;
}

export interface BatchRow {
  id: number;
  at: string;
  batch_no: string;
  formula_id: number;
  formula_name: string;
  version: number;
  target_milli: number;
  actual_milli: number | null;
  status: string;
  user_name: string | null;
  /** Only selected for the owner — staff must never receive a cost. */
  cost_cents?: number;
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

/** Newest first, with how many batches already depend on each version. */
export function versionsOf(formulaId: number): FormulaVersionWithUse[] {
  return all<FormulaVersionWithUse>(
    `SELECT v.*,
            (SELECT COUNT(*) FROM batches b WHERE b.formula_version_id = v.id) AS batch_count
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

// ------------------------------------------------------------- stock check

export interface Allocation {
  itemId: number;
  itemName: string;
  qtyMilli: number;
  costCents: number;
}

export interface StockItemRow {
  id: number;
  name: string;
  size_milli: number;
  cost_cents: number;
  qty_milli: number;
}

export interface StockLine extends ScaledLine {
  availableMilli: number;
  /** How much is missing; zero when the shelf can cover it. */
  shortMilli: number;
  ok: boolean;
  costCents: number;
  allocations: Allocation[];
}

export interface BatchPlan {
  versionId: number;
  formulaName: string;
  targetMilli: number;
  refSizeMilli: number;
  lines: StockLine[];
  ok: boolean;
  short: Array<{ chemicalName: string; unit: Unit; shortMilli: number }>;
  totalCostCents: number;
  costPerLitreCents: number;
}

/** Every stock-holding item of a chemical, biggest container first. */
export function chemicalItems(chemicalId: number): StockItemRow[] {
  return all<StockItemRow>(
    `SELECT i.id, i.name, i.size_milli, i.cost_cents,
            COALESCE(SUM(m.delta_milli), 0) AS qty_milli
       FROM items i
       LEFT JOIN stock_movements m ON m.item_id = i.id
      WHERE i.chemical_id = ?
      GROUP BY i.id
     HAVING qty_milli > 0
      ORDER BY i.size_milli DESC, i.id`,
    chemicalId,
  );
}

/**
 * Decide which containers a mix eats into. Pure, so it can be tested without a
 * database.
 *
 * Largest first: the shop wants the open drum finished before a fresh 250 g
 * repack — a repack is worth more on the shelf than in the mixing tank.
 */
export function allocate(
  rows: StockItemRow[],
  neededMilli: number,
): { allocations: Allocation[]; shortMilli: number } {
  const allocations: Allocation[] = [];
  let remaining = neededMilli;

  for (const row of rows) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, row.qty_milli);
    if (take <= 0) continue;
    allocations.push({
      itemId: row.id,
      itemName: row.name,
      qtyMilli: take,
      // cost_cents is per ONE unit of the item, so price the fraction taken.
      costCents: row.size_milli > 0 ? Math.round((take * row.cost_cents) / row.size_milli) : 0,
    });
    remaining -= take;
  }

  return { allocations, shortMilli: Math.max(0, remaining) };
}

/** Attach availability and cost to each scaled line. */
export function checkStock(lines: ScaledLine[]): StockLine[] {
  return lines.map((line) => {
    const rows = chemicalItems(line.chemicalId);
    const availableMilli = rows.reduce((sum, r) => sum + r.qty_milli, 0);
    const { allocations, shortMilli } = allocate(rows, line.neededMilli);
    return {
      ...line,
      availableMilli,
      shortMilli,
      ok: shortMilli === 0,
      costCents: allocations.reduce((sum, a) => sum + a.costCents, 0),
      allocations,
    };
  });
}

/** The whole picture for one proposed mix: quantities, stock, cost. */
export function planBatch(versionId: number, targetMilli: number): BatchPlan {
  const version = versionById(versionId);
  if (!version) throw new Error("That formula version no longer exists.");
  const formula = formulaById(version.formula_id);

  const lines = checkStock(scaleFormula(versionId, targetMilli));
  const totalCostCents = lines.reduce((sum, l) => sum + l.costCents, 0);

  return {
    versionId,
    formulaName: formula?.name ?? "Formula",
    targetMilli,
    refSizeMilli: version.ref_size_milli,
    lines,
    ok: lines.every((l) => l.ok) && lines.every((l) => l.neededMilli > 0),
    short: lines
      .filter((l) => !l.ok)
      .map((l) => ({ chemicalName: l.chemicalName, unit: l.unit, shortMilli: l.shortMilli })),
    totalCostCents,
    costPerLitreCents: targetMilli > 0 ? Math.round((totalCostCents * 1000) / targetMilli) : 0,
  };
}

export interface BatchReadiness {
  ok: boolean;
  shortCount: number;
  tooSmall: boolean;
}

/**
 * Can this mix be run — and nothing else.
 *
 * The batch screen is usable by staff, who must never receive the recipe. This
 * gives the page a yes/no without an ingredient array ever existing in the
 * staff code path, so there is nothing for the RSC payload to leak.
 */
export function batchReadiness(versionId: number, targetMilli: number): BatchReadiness {
  const plan = planBatch(versionId, targetMilli);
  return {
    ok: plan.ok,
    shortCount: plan.short.length,
    tooSmall: plan.lines.some((l) => l.neededMilli <= 0),
  };
}

export interface MixableProduct {
  id: number;
  name: string;
  version_id: number;
  version: number;
  ref_size_milli: number;
}

/**
 * The product picker for the batch screen.
 *
 * Deliberately narrower than `listFormulas`: no note, no ingredient count.
 * Staff see this list, and even how many chemicals go into a product is worth
 * something to a competitor.
 */
export function listMixableProducts(): MixableProduct[] {
  return all<MixableProduct>(
    `SELECT f.id, f.name, v.id AS version_id, v.version, v.ref_size_milli
       FROM formulas f
       JOIN formula_versions v ON v.formula_id = f.id AND v.is_current = 1
      WHERE f.active = 1
        AND EXISTS (SELECT 1 FROM formula_items fi WHERE fi.formula_version_id = v.id)
      ORDER BY f.name`,
  );
}

/**
 * Thrown when the shelf cannot cover a mix.
 *
 * It carries the shortfall as data rather than a sentence so the caller can
 * decide how much to say: the owner is told which chemical is short, a staff
 * member is only told the mix cannot run. Naming the chemical to staff would
 * leak the recipe one refusal at a time.
 */
export class StockShortError extends Error {
  readonly short: Array<{ chemicalName: string; unit: Unit; shortMilli: number }>;

  constructor(short: Array<{ chemicalName: string; unit: Unit; shortMilli: number }>) {
    super("Not enough stock to mix this batch.");
    this.name = "StockShortError";
    this.short = short;
  }
}

// ------------------------------------------------------------ batch numbers

/**
 * `RZK-20260803-001` — date plus a per-day counter.
 *
 * KEBS traceability means this number is printed on every bottle of the mix, so
 * it has to be unique and readable off a label by someone holding a returned
 * bottle. The day comes from the Nairobi business date, not UTC, or an evening
 * mix would carry tomorrow's date.
 */
export function newBatchNo(at: Date = new Date()): string {
  const prefix = `RZK-${businessDate(at).replace(/-/g, "")}-`;

  const last = get<{ batch_no: string }>(
    `SELECT batch_no FROM batches WHERE batch_no LIKE ? ORDER BY batch_no DESC LIMIT 1`,
    `${prefix}%`,
  );

  let n = 1;
  if (last) {
    const parsed = Number(last.batch_no.slice(prefix.length));
    if (Number.isFinite(parsed) && parsed >= 1) n = parsed + 1;
  }

  // A number could already be taken by a hand-entered batch; step past it rather
  // than letting the unique index abort the whole mix.
  const format = (i: number) => prefix + String(i).padStart(3, "0");
  while (get(`SELECT 1 AS x FROM batches WHERE batch_no = ?`, format(n))) n++;

  return format(n);
}

// -------------------------------------------------------------- finished goods

const SIZE_SUFFIX = /\s+\d+(?:[.,]\d+)?\s*(?:ml|l|kg|g|pcs)$/i;

/** "Laundry Soap 5 L" -> "laundry soap", so a mix can find what it bottles into. */
function baseName(name: string): string {
  return name.replace(SIZE_SUFFIX, "").trim().toLowerCase();
}

/**
 * Finished items this mix could be bottled into, the exact-name matches first.
 *
 * Matching is deliberately strict (the product name must be exactly the
 * formula name) so a wrong default never inflates the stock of a different
 * product. Anything less obvious — "Dettol-type Disinfectant" bottled as
 * "Dettol-type 500 ml" — is still selectable, just not pre-chosen.
 */
export function outputItemsFor(formulaName: string): FinishedItemRow[] {
  const target = baseName(formulaName);
  const rows = all<Omit<FinishedItemRow, "suggested">>(
    `SELECT id, name, canonical_unit, size_milli, unit_label
       FROM items
      WHERE kind = 'finished' AND active = 1
      ORDER BY name`,
  );
  return rows
    .map((r) => ({ ...r, suggested: baseName(r.name) === target }))
    .sort((a, b) => Number(b.suggested) - Number(a.suggested) || a.name.localeCompare(b.name));
}

// ------------------------------------------------------------------ batches

export interface RunBatchInput {
  formulaVersionId: number;
  targetMilli: number;
  userId: number;
  /** Litres actually produced, when the mix has already been made. */
  actualMilli?: number | null;
  /** Finished item the mix was bottled into, if any. */
  outputItemId?: number | null;
}

export interface RunBatchResult {
  batchId: number;
  batchNo: string;
  costCents: number;
}

/**
 * Consume the chemicals and record the production run.
 *
 * The whole thing is one transaction: a batch that took the Ungerol off the
 * shelf but never got written down would be indistinguishable from theft.
 */
export function runBatch(input: RunBatchInput): RunBatchResult {
  if (!Number.isInteger(input.targetMilli) || input.targetMilli <= 0) {
    throw new Error("Enter how many litres you want to make.");
  }

  return tx(() => {
    const plan = planBatch(input.formulaVersionId, input.targetMilli);

    if (!plan.lines.length) {
      throw new Error("This formula has no ingredients recorded yet.");
    }
    if (plan.lines.some((l) => l.neededMilli <= 0)) {
      const min = minimumTargetMilli(input.formulaVersionId);
      throw new Error(
        `That batch is too small to scale this formula accurately — mix at least ${fromMilli(min)} L.`,
      );
    }
    if (!plan.ok) throw new StockShortError(plan.short);

    const batchNo = newBatchNo();

    // The version, not the formula: editing the recipe tomorrow must not rewrite
    // what this batch was actually made of.
    const { lastInsertRowid: batchId } = run(
      `INSERT INTO batches (formula_version_id, batch_no, target_milli, actual_milli, cost_cents, user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      input.formulaVersionId,
      batchNo,
      input.targetMilli,
      input.actualMilli ?? null,
      plan.totalCostCents,
      input.userId,
    );

    for (const line of plan.lines) {
      run(
        `INSERT INTO batch_lines (batch_id, chemical_id, qty_milli, cost_cents)
         VALUES (?, ?, ?, ?)`,
        batchId,
        line.chemicalId,
        line.neededMilli,
        line.costCents,
      );
      for (const a of line.allocations) {
        postMovement({
          itemId: a.itemId,
          deltaMilli: -a.qtyMilli,
          reason: "batch_consume",
          refType: "batch",
          refId: batchId,
          userId: input.userId,
          note: batchNo,
        });
      }
    }

    // Finished stock is only created once we know what actually came out. If the
    // yield is still unknown the batch waits for `recordYield`.
    if (input.outputItemId && input.actualMilli && input.actualMilli > 0) {
      postMovement({
        itemId: input.outputItemId,
        deltaMilli: input.actualMilli,
        reason: "batch_output",
        refType: "batch",
        refId: batchId,
        userId: input.userId,
        note: batchNo,
      });
    }

    audit(
      input.userId,
      "batch_run",
      "batch",
      batchId,
      `${batchNo} · target ${fromMilli(input.targetMilli)} L`,
    );

    return { batchId, batchNo, costCents: plan.totalCostCents };
  });
}

export interface RecordYieldInput {
  batchId: number;
  actualMilli: number;
  outputItemId?: number | null;
  userId: number;
}

/**
 * Record what actually came out of the tank.
 *
 * The theoretical target always flatters the shop: spillage, what stays in the
 * tank and over-filled bottles are all real. Booking finished stock at the
 * target rather than the measured yield quietly invents inventory, so the
 * `batch_output` movement is posted here, from the measured figure.
 */
export function recordYield(input: RecordYieldInput): { batchNo: string; varianceMilli: number } {
  if (!Number.isInteger(input.actualMilli) || input.actualMilli < 0) {
    throw new Error("Enter the litres actually produced.");
  }

  return tx(() => {
    const batch = get<{
      id: number;
      batch_no: string;
      target_milli: number;
      actual_milli: number | null;
      status: string;
      cost_cents: number;
    }>(
      `SELECT id, batch_no, target_milli, actual_milli, status, cost_cents
         FROM batches WHERE id = ?`,
      input.batchId,
    );

    if (!batch) throw new Error("That batch no longer exists.");
    if (batch.status !== "completed") throw new Error("That batch was voided.");
    if (batch.actual_milli !== null) {
      throw new Error("The yield for this batch has already been recorded.");
    }

    run(`UPDATE batches SET actual_milli = ? WHERE id = ?`, input.actualMilli, input.batchId);

    if (input.outputItemId && input.actualMilli > 0) {
      const out = get<{ size_milli: number; name: string }>(
        `SELECT size_milli, name FROM items WHERE id = ?`,
        input.outputItemId,
      );
      const units = out && out.size_milli > 0 ? input.actualMilli / out.size_milli : 0;

      // Bottling consumes packaging. Only whole containers are filled, so the
      // remainder of a part-filled bottle stays as bulk rather than eating a
      // jerrican that was never used.
      const wholeUnits = Math.floor(units);
      let packagingCents = 0;
      if (wholeUnits > 0) {
        const bom = all<{ packaging_item_id: number; qty_per_unit: number; cost_cents: number; name: string }>(
          `SELECT ip.packaging_item_id, ip.qty_per_unit, i.cost_cents, i.name
             FROM item_packaging ip
             JOIN items i ON i.id = ip.packaging_item_id
            WHERE ip.item_id = ?`,
          input.outputItemId,
        );
        for (const p of bom) {
          const pieces = p.qty_per_unit * wholeUnits;
          packagingCents += pieces * p.cost_cents;
          postMovement({
            itemId: p.packaging_item_id,
            deltaMilli: -toMilli(pieces),
            reason: "batch_consume",
            refType: "batch",
            refId: input.batchId,
            userId: input.userId,
            note: `${batch.batch_no} · ${pieces} × ${p.name}`,
          });
        }
      }

      // The whole point of costing a batch is that the bottle carries the cost.
      // Reagents plus packaging, spread over what was ACTUALLY produced — using
      // the target would understate cost per litre by whatever the batch lost.
      // This runs before the stock movement because the weighted average is
      // computed against stock on hand; posting first counts the new units twice.
      if (units > 0) {
        updateAverageCost(input.outputItemId, units, batch.cost_cents + packagingCents);
      }

      postMovement({
        itemId: input.outputItemId,
        deltaMilli: input.actualMilli,
        reason: "batch_output",
        refType: "batch",
        refId: input.batchId,
        userId: input.userId,
        note: batch.batch_no,
      });
    }

    const varianceMilli = input.actualMilli - batch.target_milli;
    audit(
      input.userId,
      "batch_yield",
      "batch",
      input.batchId,
      `${batch.batch_no} · actual ${fromMilli(input.actualMilli)} L (target ${fromMilli(batch.target_milli)} L)`,
    );

    return { batchNo: batch.batch_no, varianceMilli };
  });
}

/** Recent production. `withCost` is owner-only — staff must not receive it. */
export function listBatches(limit = 15, withCost = false): BatchRow[] {
  return all<BatchRow>(
    `SELECT b.id, b.at, b.batch_no, b.target_milli, b.actual_milli, b.status,
            ${withCost ? "b.cost_cents," : ""}
            f.id   AS formula_id,
            f.name AS formula_name,
            v.version AS version,
            u.name AS user_name
       FROM batches b
       JOIN formula_versions v ON v.id = b.formula_version_id
       JOIN formulas f ON f.id = v.formula_id
       LEFT JOIN users u ON u.id = b.user_id
      ORDER BY b.at DESC, b.id DESC
      LIMIT ?`,
    limit,
  );
}

/**
 * Void a batch: put every kilo it moved back where it came from.
 *
 * The ledger is append-only, so a void is not an erasure — it is a fresh set of
 * equal-and-opposite movements, each pointing back at the batch, plus the
 * status flag. The original mistake stays visible, which is the point: "we
 * mixed 100 L when we meant 10 L, and here is the correction" is a story the
 * stock take can verify. Deleting rows would just be a smaller lie.
 *
 * What this deliberately does NOT do is rewind the finished item's weighted
 * average cost. Sales may have happened since the yield was booked, and
 * un-averaging a number that later sales already consumed would fabricate
 * precision. The next real batch or purchase re-averages it; the audit line
 * says so.
 */
export function voidBatch(batchId: number, userId: number, reason: string): void {
  const why = reason.trim();
  if (!why) throw new Error("Say why the batch is being voided — the record keeps the reason.");

  tx(() => {
    const batch = get<{ id: number; batch_no: string; status: string }>(
      `SELECT id, batch_no, status FROM batches WHERE id = ?`,
      batchId,
    );
    if (!batch) throw new Error("That batch no longer exists.");
    if (batch.status !== "completed") throw new Error("That batch is already voided.");

    const moves = all<{ item_id: number; delta_milli: number }>(
      `SELECT item_id, delta_milli FROM stock_movements
        WHERE ref_type = 'batch' AND ref_id = ?`,
      batchId,
    );
    for (const m of moves) {
      postMovement({
        itemId: m.item_id,
        deltaMilli: -m.delta_milli,
        reason: "adjustment",
        refType: "batch_void",
        refId: batchId,
        userId,
        note: `void ${batch.batch_no}: ${why}`,
      });
    }

    run(`UPDATE batches SET status = 'voided' WHERE id = ?`, batchId);
    audit(
      userId,
      "batch_void",
      "batch",
      batchId,
      `${batch.batch_no} · ${moves.length} movements reversed · ${why} · costs not re-averaged`,
    );
  });
}

/** Batches that have been mixed but whose yield has not been measured yet. */
export function pendingYieldBatches(): BatchRow[] {
  return all<BatchRow>(
    `SELECT b.id, b.at, b.batch_no, b.target_milli, b.actual_milli, b.status,
            f.id   AS formula_id,
            f.name AS formula_name,
            v.version AS version,
            u.name AS user_name
       FROM batches b
       JOIN formula_versions v ON v.id = b.formula_version_id
       JOIN formulas f ON f.id = v.formula_id
       LEFT JOIN users u ON u.id = b.user_id
      WHERE b.actual_milli IS NULL AND b.status = 'completed'
      ORDER BY b.at DESC, b.id DESC`,
  );
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
 * Save an edited recipe as a NEW version.
 *
 * The old rows are left exactly as they were — every batch ever mixed points at
 * one of them, and rewriting a version would silently restate what those
 * batches were made of and what they cost. Only the `is_current` flag moves.
 */
/**
 * How many batches were mixed against one formula version.
 *
 * Zero means the version is still only a piece of writing: nothing downstream
 * depends on the numbers in it, so correcting it destroys no record. The edit
 * screen asks this to tell the owner, before they type anything, whether the
 * save ahead of them corrects this recipe or forks a new version from it.
 */
export function batchesUsingVersion(versionId: number): number {
  return get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM batches WHERE formula_version_id = ?`,
    versionId,
  )?.n ?? 0;
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
    const mixedAgainstCurrent = current
      ? (get<{ n: number }>(`SELECT COUNT(*) AS n FROM batches WHERE formula_version_id = ?`, current.id)?.n ?? 0)
      : 0;
    const correctInPlace = Boolean(current) && mixedAgainstCurrent === 0;

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
        ? `${formula.name} · version ${version} corrected before any batch used it (${items.length} ingredients)`
        : `${formula.name} · version ${version} (${items.length} ingredients)`,
    );

    return { versionId, version, corrected: correctInPlace };
  });
}

// ------------------------------------------------------------- selling a kit

export interface KitPick {
  itemId: number;
  name: string;
  /** How much one of these holds, in milli of the canonical unit. */
  sizeMilli: number;
  units: number;
}

export interface KitIngredient {
  chemicalId: number;
  chemicalName: string;
  unit: Unit;
  /** What the recipe asks for at this batch size. */
  neededMilli: number;
  /** The packs that cover it — empty when nothing suitable is on the shelf. */
  picks: KitPick[];
  /** What those packs actually come to; never less than needed. */
  suppliedMilli: number;
  /** True when this chemical has no sellable pack at all. */
  missing: boolean;
  /**
   * True when the smallest pack dwarfs what the recipe asks for — 5 kg of
   * C.D.E for a recipe needing 25 g. Not an error, but not something to put in
   * a customer's cart without being asked.
   */
  oversized: boolean;
}

export interface Kit {
  formulaId: number;
  versionId: number;
  formulaName: string;
  /** Batch size, in litres — the unit every formula's reference size is in. */
  targetMilli: number;
  ingredients: KitIngredient[];
}

/**
 * How much more than the recipe asks for a pack may be before it is called out.
 *
 * Rounding 1.5 kg up to two 1 kg packs is ordinary shopkeeping. Handing over
 * 5 kg of C.D.E because the recipe wants 25 g is not — it is a bill nobody
 * would pay, and quietly adding it to the cart would make the kit feature worse
 * than useless. Twice the requirement is the line; past it the counter is told,
 * and told what would fix it.
 */
const OVERSHOOT_LIMIT = 2;

/**
 * Turn a recipe into a basket of packs the shop can actually hand over.
 *
 * A formula asks for weights — 1.5 kg of unga, 80 g of optical brightener — and
 * the shop sells packs. Nothing here invents a way to sell a fraction of a pack:
 * the sale stays whole units of real items, so stock, costing and the receipt
 * behave exactly as they do for any other sale. The kit is a way of *filling the
 * cart*, not a new kind of line.
 *
 * Because packs are lumpy, the customer is always given at least what the recipe
 * needs, never less — a short ingredient is a failed batch, and they would be
 * back. What they are given over is shown, so nobody is surprised at the till.
 */
export function buildKit(versionId: number, targetMilli: number): Kit {
  const version = versionById(versionId);
  if (!version) throw new Error("That formula version no longer exists.");
  const formula = formulaById(version.formula_id);

  const ingredients = scaleFormula(versionId, targetMilli).map<KitIngredient>((line) => {
    // Only what is actually on the price list: a pack of this chemical that the
    // shop sells. Bulk drums and packaging are not part of a kit.
    const packs = all<{ id: number; name: string; size_milli: number }>(
      `SELECT id, name, size_milli
         FROM items
        WHERE chemical_id = ? AND kind = 'pack' AND sellable = 1 AND active = 1
          AND retail_cents > 0
        ORDER BY size_milli DESC`,
      line.chemicalId,
    );

    if (!packs.length) {
      return { ...toIngredient(line), picks: [], suppliedMilli: 0, missing: true, oversized: false };
    }

    const filled = fillWithPacks(packs, line.neededMilli);
    return {
      ...toIngredient(line),
      ...filled,
      missing: false,
      oversized: filled.suppliedMilli > line.neededMilli * OVERSHOOT_LIMIT,
    };
  });

  return {
    formulaId: version.formula_id,
    versionId,
    formulaName: formula?.name ?? "Kit",
    targetMilli,
    ingredients,
  };
}

/**
 * The smallest batch at which a kit stops being absurd.
 *
 * A kit is whole packs off the shelf, so an ingredient the recipe wants a
 * pinch of has to be bought in whatever the smallest pack of it is. Carwash
 * Shampoo needs 1 g of C.D.E per litre and the smallest C.D.E on the price
 * list is 5 kg — so a one-litre kit means selling somebody a 5 kg tub, four
 * thousand times what they asked for. The screen refuses, which is right, but
 * refusing without saying what WOULD work is the confusing part.
 *
 * For each ingredient the pack is acceptable once it is within `OVERSHOOT_LIMIT`
 * of what the recipe needs:
 *
 *     smallestPack <= LIMIT * qty * target / referenceBatch
 *
 * Rearranged, that is the smallest target this ingredient allows; the answer is
 * the largest of those across the recipe. Ingredients with no pack on the price
 * list at all can never be supplied, so they are named separately rather than
 * pushing the number to infinity.
 */
export interface KitFloor {
  /** Smallest batch, in milli, where every packable ingredient is in range. */
  targetMilli: number;
  /** Chemicals with no sellable pack at any size — no batch fixes these. */
  unpackable: string[];
  /** The ingredient that sets the floor, for explaining the number. */
  binding: { name: string; neededMilli: number; packMilli: number; unit: string } | null;
}

export function smallestKitBatch(versionId: number): KitFloor {
  const version = versionById(versionId);
  if (!version) return { targetMilli: 0, unpackable: [], binding: null };

  let targetMilli = 0;
  const unpackable: string[] = [];
  let binding: KitFloor["binding"] = null;

  for (const line of formulaItems(versionId)) {
    const smallest = get<{ size_milli: number }>(
      `SELECT size_milli FROM items
        WHERE chemical_id = ? AND kind = 'pack' AND sellable = 1 AND active = 1
          AND retail_cents > 0
        ORDER BY size_milli ASC LIMIT 1`,
      line.chemical_id,
    );
    if (!smallest) {
      unpackable.push(line.chemical_name);
      continue;
    }
    if (line.qty_milli <= 0) continue;

    const needs = Math.ceil(
      (smallest.size_milli * version.ref_size_milli) / (OVERSHOOT_LIMIT * line.qty_milli),
    );
    if (needs > targetMilli) {
      targetMilli = needs;
      binding = {
        name: line.chemical_name,
        neededMilli: (line.qty_milli * needs) / version.ref_size_milli,
        packMilli: smallest.size_milli,
        unit: line.canonical_unit,
      };
    }
  }

  return { targetMilli, unpackable, binding };
}

function toIngredient(line: ScaledLine) {
  return {
    chemicalId: line.chemicalId,
    chemicalName: line.chemicalName,
    unit: line.unit,
    neededMilli: line.neededMilli,
  };
}

/**
 * Fewest packs that cover a weight, without going far over.
 *
 * Largest-first is the obvious rule and mostly right, but it has one silly
 * failure: 800 g from packs of 1 kg / 500 g / 250 g comes out as 500 + 250 +
 * 250 — three packs to hand over exactly the same kilogram that one 1 kg pack
 * would have been. So the greedy answer is compared against the smallest single
 * pack that covers the whole amount, and the better of the two wins: less
 * overshoot first, then fewer packs to weigh and carry.
 */
function fillWithPacks(
  packs: Array<{ id: number; name: string; size_milli: number }>,
  neededMilli: number,
): { picks: KitPick[]; suppliedMilli: number } {
  const byId = new Map<number, KitPick>();
  let remaining = neededMilli;

  const take = (p: { id: number; name: string; size_milli: number }, n: number) => {
    const at = byId.get(p.id);
    if (at) at.units += n;
    else byId.set(p.id, { itemId: p.id, name: p.name, sizeMilli: p.size_milli, units: n });
  };

  // packs arrive largest first
  for (const p of packs) {
    if (remaining < p.size_milli) continue;
    const n = Math.floor(remaining / p.size_milli);
    take(p, n);
    remaining -= n * p.size_milli;
  }

  // Whatever is left is smaller than the smallest pack: round up by one of the
  // smallest pack that still covers it.
  if (remaining > 0) {
    const covering = [...packs].reverse().find((p) => p.size_milli >= remaining) ?? packs[packs.length - 1];
    take(covering, 1);
    remaining = 0;
  }

  const greedy = [...byId.values()];
  const greedySupplied = greedy.reduce((s, p) => s + p.sizeMilli * p.units, 0);
  const greedyCount = greedy.reduce((s, p) => s + p.units, 0);

  const single = [...packs].reverse().find((p) => p.size_milli >= neededMilli);
  if (single) {
    const better =
      single.size_milli < greedySupplied ||
      (single.size_milli === greedySupplied && greedyCount > 1);
    if (better) {
      return {
        picks: [{ itemId: single.id, name: single.name, sizeMilli: single.size_milli, units: 1 }],
        suppliedMilli: single.size_milli,
      };
    }
  }

  return { picks: greedy, suppliedMilli: greedySupplied };
}
