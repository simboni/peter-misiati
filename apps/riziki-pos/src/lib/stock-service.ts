/**
 * Stock: reading the ledger for the screens, and the two operations that change
 * it by hand — repacking bulk into packs, and reconciling a physical count.
 *
 * Deliberately free of any `next/*` import so it runs directly under
 * `node --test`, the same way `pin.ts` and `seed.ts` do. Authentication is the
 * caller's job: every server action guards itself before calling in here.
 *
 * Nothing in this file writes to `items.qty` — there is no such column. Stock
 * only ever moves by appending to `stock_movements` through `postMovement`.
 */

import { all, get, run, tx, postMovement, stockOf, audit } from "./db.ts";

// ---------------------------------------------------------------- reading

export type StockKind = "bulk" | "pack" | "finished" | "packaging";
export type StockStatus = "in" | "low" | "reorder";

export interface StockLine {
  id: number;
  chemicalId: number | null;
  chemicalName: string | null;
  name: string;
  kind: StockKind;
  unit: "kg" | "L" | "pcs";
  sizeMilli: number;
  unitLabel: string;
  costCents: number;
  reorderMilli: number;
  qtyMilli: number;
  /** units on hand, e.g. 19 packs — the number the owner actually counts */
  units: number;
  status: StockStatus;
  valueCents: number;
  /** lowercased name + aliases, so the client can filter without a round trip */
  search: string;
}

export interface ReagentGroup {
  chemicalId: number;
  name: string;
  aliases: string;
  unit: "kg" | "L" | "pcs";
  totalMilli: number;
  valueCents: number;
  status: StockStatus;
  lines: StockLine[];
  search: string;
}

export interface StockView {
  reagents: ReagentGroup[];
  finished: StockLine[];
  packaging: StockLine[];
  /** owner-only figure; the caller decides whether to render it */
  totalValueCents: number;
  itemCount: number;
}

interface StockRowRaw {
  id: number;
  chemical_id: number | null;
  chemical_name: string | null;
  chemical_aliases: string | null;
  name: string;
  kind: StockKind;
  canonical_unit: "kg" | "L" | "pcs";
  size_milli: number;
  unit_label: string;
  cost_cents: number;
  reorder_level_milli: number;
  qty_milli: number;
}

/**
 * Three states rather than two: "Reorder" means the level the owner set has been
 * reached, "Low" is the half-step of warning before it, so a drum can be ordered
 * before the shelf is actually empty.
 */
export function stockStatus(qtyMilli: number, reorderMilli: number): StockStatus {
  if (reorderMilli <= 0) return qtyMilli > 0 ? "in" : "reorder";
  if (qtyMilli <= reorderMilli) return "reorder";
  if (qtyMilli <= Math.round(reorderMilli * 1.5)) return "low";
  return "in";
}

/** Value of a holding at weighted-average cost. Cost is per ONE unit, not per kg. */
export function valueAtCost(qtyMilli: number, sizeMilli: number, costCents: number): number {
  if (sizeMilli <= 0) return 0;
  return Math.round((qtyMilli / sizeMilli) * costCents);
}

function toLine(r: StockRowRaw): StockLine {
  const units = r.size_milli > 0 ? r.qty_milli / r.size_milli : 0;
  return {
    id: r.id,
    chemicalId: r.chemical_id,
    chemicalName: r.chemical_name,
    name: r.name,
    kind: r.kind,
    unit: r.canonical_unit,
    sizeMilli: r.size_milli,
    unitLabel: r.unit_label,
    costCents: r.cost_cents,
    reorderMilli: r.reorder_level_milli,
    qtyMilli: r.qty_milli,
    units,
    status: stockStatus(r.qty_milli, r.reorder_level_milli),
    valueCents: valueAtCost(r.qty_milli, r.size_milli, r.cost_cents),
    search: [r.name, r.chemical_name ?? "", r.chemical_aliases ?? ""].join(" ").toLowerCase(),
  };
}

export function stockLines(): StockLine[] {
  // Bulk before packs, then biggest pack first — the order the shelf is stacked.
  const rows = all<StockRowRaw>(
    `SELECT i.id, i.chemical_id, i.name, i.kind, i.canonical_unit, i.size_milli,
            i.unit_label, i.cost_cents, i.reorder_level_milli,
            c.name AS chemical_name, c.aliases AS chemical_aliases,
            COALESCE(SUM(m.delta_milli), 0) AS qty_milli
       FROM items i
       LEFT JOIN chemicals c ON c.id = i.chemical_id
       LEFT JOIN stock_movements m ON m.item_id = i.id
      WHERE i.active = 1
      GROUP BY i.id
      ORDER BY COALESCE(c.name, i.name),
               CASE i.kind WHEN 'bulk' THEN 0 ELSE 1 END,
               i.size_milli DESC,
               i.name`,
  );
  return rows.map(toLine);
}

/**
 * "Ungerol drum / 20 kg / 5 kg / 1 kg" has to read as one block: the owner thinks
 * about the substance, and only then about which size it happens to be in.
 */
export function groupReagents(lines: StockLine[]): ReagentGroup[] {
  const aliasOf = new Map<number, string>();
  for (const c of all<{ id: number; aliases: string }>(`SELECT id, aliases FROM chemicals`)) {
    aliasOf.set(c.id, c.aliases ?? "");
  }

  const groups = new Map<number, ReagentGroup>();
  for (const line of lines) {
    if (line.kind !== "bulk" && line.kind !== "pack") continue;
    if (line.chemicalId == null) continue;

    let g = groups.get(line.chemicalId);
    if (!g) {
      const aliases = aliasOf.get(line.chemicalId) ?? "";
      g = {
        chemicalId: line.chemicalId,
        name: line.chemicalName ?? line.name,
        aliases,
        unit: line.unit,
        totalMilli: 0,
        valueCents: 0,
        status: "in",
        lines: [],
        search: `${line.chemicalName ?? line.name} ${aliases}`.toLowerCase(),
      };
      groups.set(line.chemicalId, g);
    }
    g.lines.push(line);
    g.totalMilli += line.qtyMilli;
    g.valueCents += line.valueCents;
  }

  for (const g of groups.values()) {
    // The block's chip shows the worst state inside it, so a group can never look
    // healthy while its drum shelf is empty.
    g.status = g.lines.some((l) => l.status === "reorder")
      ? "reorder"
      : g.lines.some((l) => l.status === "low")
        ? "low"
        : "in";
    g.search += " " + g.lines.map((l) => l.name).join(" ").toLowerCase();
  }

  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function stockView(): StockView {
  const lines = stockLines();
  const reagents = groupReagents(lines);
  return {
    reagents,
    finished: lines.filter((l) => l.kind === "finished"),
    packaging: lines.filter((l) => l.kind === "packaging"),
    totalValueCents: lines.reduce((sum, l) => sum + l.valueCents, 0),
    itemCount: lines.length,
  };
}

// ---------------------------------------------------------------- repack

export interface RepackLineInput {
  itemId: number;
  units: number;
}

export interface RepackInput {
  fromItemId: number;
  /** may be fractional — half a drum is a real thing at the counter */
  bulkUnits: number;
  lines: RepackLineInput[];
  userId?: number | null;
  note?: string | null;
}

export interface RepackTotals {
  inMilli: number;
  outMilli: number;
  lossMilli: number;
  /** loss as a percentage of what went in — the number that was invisible before */
  lossPct: number;
}

export interface RepackPlan extends RepackTotals {
  fromItemId: number;
  fromName: string;
  unit: "kg" | "L" | "pcs";
  availableMilli: number;
  lines: Array<{ itemId: number; name: string; units: number; qtyMilli: number }>;
}

export interface PackOption {
  itemId: number;
  name: string;
  sizeMilli: number;
  unitLabel: string;
  stockMilli: number;
}

export interface BulkOption {
  itemId: number;
  name: string;
  chemicalId: number;
  chemicalName: string;
  unit: "kg" | "L" | "pcs";
  sizeMilli: number;
  unitLabel: string;
  stockMilli: number;
  /** per ONE bulk unit; owner-only, so callers strip it for staff */
  costCents: number;
  packs: PackOption[];
}

/** Every bulk container that has at least one pack size to break down into. */
export function repackOptions(): BulkOption[] {
  const bulks = all<{
    id: number;
    name: string;
    chemical_id: number;
    chemical_name: string;
    canonical_unit: "kg" | "L" | "pcs";
    size_milli: number;
    unit_label: string;
    cost_cents: number;
    qty_milli: number;
  }>(
    `SELECT i.id, i.name, i.chemical_id, c.name AS chemical_name, i.canonical_unit,
            i.size_milli, i.unit_label, i.cost_cents,
            COALESCE(SUM(m.delta_milli), 0) AS qty_milli
       FROM items i
       JOIN chemicals c ON c.id = i.chemical_id
       LEFT JOIN stock_movements m ON m.item_id = i.id
      WHERE i.active = 1 AND i.kind = 'bulk'
      GROUP BY i.id
      ORDER BY c.name`,
  );

  const packs = all<{
    id: number;
    name: string;
    chemical_id: number;
    size_milli: number;
    unit_label: string;
    qty_milli: number;
  }>(
    `SELECT i.id, i.name, i.chemical_id, i.size_milli, i.unit_label,
            COALESCE(SUM(m.delta_milli), 0) AS qty_milli
       FROM items i
       LEFT JOIN stock_movements m ON m.item_id = i.id
      WHERE i.active = 1 AND i.kind = 'pack'
      GROUP BY i.id
      ORDER BY i.size_milli DESC`,
  );

  return bulks
    .map((b) => ({
      itemId: b.id,
      name: b.name,
      chemicalId: b.chemical_id,
      chemicalName: b.chemical_name,
      unit: b.canonical_unit,
      sizeMilli: b.size_milli,
      unitLabel: b.unit_label,
      stockMilli: b.qty_milli,
      costCents: b.cost_cents,
      packs: packs
        .filter((p) => p.chemical_id === b.chemical_id)
        .map((p) => ({
          itemId: p.id,
          name: p.name,
          sizeMilli: p.size_milli,
          unitLabel: p.unit_label,
          stockMilli: p.qty_milli,
        })),
    }))
    .filter((b) => b.packs.length > 0);
}

/** Pure arithmetic, so the screen can show kg in / kg out / loss before submitting. */
export function repackTotals(inMilli: number, outMilli: number): RepackTotals {
  const lossMilli = inMilli - outMilli;
  return {
    inMilli,
    outMilli,
    lossMilli,
    lossPct: inMilli > 0 ? (lossMilli / inMilli) * 100 : 0,
  };
}

/**
 * Validate a repack against the ledger without writing anything. `performRepack`
 * runs this again inside the transaction, so a stale screen can never sneak past.
 */
export function planRepack(input: RepackInput): RepackPlan {
  const from = get<{
    id: number;
    name: string;
    kind: string;
    chemical_id: number | null;
    canonical_unit: "kg" | "L" | "pcs";
    size_milli: number;
  }>(`SELECT id, name, kind, chemical_id, canonical_unit, size_milli FROM items WHERE id = ? AND active = 1`, input.fromItemId);

  if (!from) throw new Error("Pick the bulk container you are breaking down.");
  if (from.kind !== "bulk") throw new Error(`${from.name} is not a bulk container.`);

  if (!Number.isFinite(input.bulkUnits) || input.bulkUnits <= 0) {
    throw new Error("Enter how many containers you are breaking down.");
  }

  const inMilli = Math.round(input.bulkUnits * from.size_milli);
  if (inMilli <= 0) throw new Error("Enter how many containers you are breaking down.");

  const available = stockOf(from.id);
  if (inMilli > available) {
    throw new Error(
      `Not enough stock: ${from.name} holds ${available / 1000} ${from.canonical_unit}, ` +
        `you are trying to break down ${inMilli / 1000} ${from.canonical_unit}.`,
    );
  }

  const resolved: RepackPlan["lines"] = [];
  let outMilli = 0;

  for (const l of input.lines) {
    if (!Number.isFinite(l.units) || l.units <= 0) continue;
    if (!Number.isInteger(l.units)) throw new Error("Packs are counted in whole numbers.");

    const item = get<{ id: number; name: string; kind: string; chemical_id: number | null; size_milli: number }>(
      `SELECT id, name, kind, chemical_id, size_milli FROM items WHERE id = ? AND active = 1`,
      l.itemId,
    );
    if (!item) throw new Error("One of the pack sizes no longer exists.");
    if (item.kind !== "pack") throw new Error(`${item.name} is not a repack size.`);
    if (item.chemical_id !== from.chemical_id) {
      throw new Error(`${item.name} is a different chemical from ${from.name}.`);
    }

    const qtyMilli = l.units * item.size_milli;
    outMilli += qtyMilli;
    resolved.push({ itemId: item.id, name: item.name, units: l.units, qtyMilli });
  }

  if (!resolved.length) throw new Error("Enter how many packs of each size you produced.");

  if (outMilli > inMilli) {
    throw new Error(
      `Impossible: ${outMilli / 1000} ${from.canonical_unit} of packs cannot come out of ` +
        `${inMilli / 1000} ${from.canonical_unit} of bulk.`,
    );
  }

  return {
    fromItemId: from.id,
    fromName: from.name,
    unit: from.canonical_unit,
    availableMilli: available,
    lines: resolved,
    ...repackTotals(inMilli, outMilli),
  };
}

export interface RepackResult extends RepackPlan {
  repackId: number;
}

/**
 * Break bulk into packs. The whole thing is one transaction: a drum that left the
 * shelf without packs appearing would be indistinguishable from theft.
 *
 * `repack_out` is what physically reached the packs and `repack_loss` is the
 * spillage, so the two movements together remove exactly what was broken down and
 * the owner can still ask the ledger "what did repacking cost me this month?".
 */
export function performRepack(input: RepackInput): RepackResult {
  return tx(() => {
    const plan = planRepack(input);

    const { lastInsertRowid: repackId } = run(
      `INSERT INTO repacks (from_item_id, in_milli, out_milli, loss_milli, user_id)
       VALUES (?, ?, ?, ?, ?)`,
      plan.fromItemId,
      plan.inMilli,
      plan.outMilli,
      plan.lossMilli,
      input.userId ?? null,
    );

    postMovement({
      itemId: plan.fromItemId,
      deltaMilli: -plan.outMilli,
      reason: "repack_out",
      refType: "repack",
      refId: repackId,
      userId: input.userId ?? null,
      note: input.note ?? null,
    });

    for (const line of plan.lines) {
      run(
        `INSERT INTO repack_lines (repack_id, item_id, units, qty_milli) VALUES (?, ?, ?, ?)`,
        repackId,
        line.itemId,
        line.units,
        line.qtyMilli,
      );
      postMovement({
        itemId: line.itemId,
        deltaMilli: line.qtyMilli,
        reason: "repack_in",
        refType: "repack",
        refId: repackId,
        userId: input.userId ?? null,
      });
    }

    if (plan.lossMilli !== 0) {
      postMovement({
        itemId: plan.fromItemId,
        deltaMilli: -plan.lossMilli,
        reason: "repack_loss",
        refType: "repack",
        refId: repackId,
        userId: input.userId ?? null,
        note: `${plan.lossPct.toFixed(2)}% of ${plan.inMilli / 1000} ${plan.unit}`,
      });
    }

    audit(
      input.userId ?? null,
      "repack",
      "repack",
      repackId,
      `${plan.fromName}: in ${plan.inMilli / 1000}, out ${plan.outMilli / 1000}, ` +
        `loss ${plan.lossMilli / 1000} (${plan.lossPct.toFixed(2)}%)`,
    );

    return { ...plan, repackId };
  });
}

// ------------------------------------------------------------- stock take

export interface CountInput {
  itemId: number;
  countedUnits: number;
}

export interface StocktakeLine {
  itemId: number;
  name: string;
  unit: "kg" | "L" | "pcs";
  sizeMilli: number;
  unitLabel: string;
  systemMilli: number;
  countedMilli: number;
  deltaMilli: number;
  deltaUnits: number;
  /** owner-only: what the variance is worth at cost */
  deltaCents: number;
}

export interface StocktakePlan {
  lines: StocktakeLine[];
  varianceMilli: number;
  varianceCents: number;
  countedItems: number;
}

/** Compare a set of physical counts with the ledger. Reads only. */
export function planStocktake(counts: CountInput[]): StocktakePlan {
  const lines: StocktakeLine[] = [];

  for (const c of counts) {
    if (!Number.isFinite(c.countedUnits)) continue;
    if (c.countedUnits < 0) throw new Error("A counted quantity cannot be negative.");

    const item = get<{
      id: number;
      name: string;
      canonical_unit: "kg" | "L" | "pcs";
      size_milli: number;
      unit_label: string;
      cost_cents: number;
    }>(
      `SELECT id, name, canonical_unit, size_milli, unit_label, cost_cents
         FROM items WHERE id = ? AND active = 1`,
      c.itemId,
    );
    if (!item) throw new Error("One of the counted items no longer exists.");

    const systemMilli = stockOf(item.id);
    const countedMilli = Math.round(c.countedUnits * item.size_milli);
    const deltaMilli = countedMilli - systemMilli;

    lines.push({
      itemId: item.id,
      name: item.name,
      unit: item.canonical_unit,
      sizeMilli: item.size_milli,
      unitLabel: item.unit_label,
      systemMilli,
      countedMilli,
      deltaMilli,
      deltaUnits: item.size_milli > 0 ? deltaMilli / item.size_milli : 0,
      deltaCents: valueAtCost(deltaMilli, item.size_milli, item.cost_cents),
    });
  }

  const variances = lines.filter((l) => l.deltaMilli !== 0);
  return {
    lines,
    varianceMilli: variances.reduce((s, l) => s + l.deltaMilli, 0),
    varianceCents: variances.reduce((s, l) => s + l.deltaCents, 0),
    countedItems: lines.length,
  };
}

export interface StocktakeInput {
  counts: CountInput[];
  reason: string;
  userId?: number | null;
}

export interface StocktakeResult extends StocktakePlan {
  posted: number;
}

/**
 * Post the difference between the shelf and the ledger.
 *
 * The reason note is mandatory on purpose: this is the shop's main anti-theft
 * control, and an unexplained adjustment is exactly the thing it exists to catch.
 * A count itself can never drive stock negative — the counted figure becomes the
 * new truth — but a negative count is refused outright.
 */
export function performStocktake(input: StocktakeInput): StocktakeResult {
  const reason = (input.reason ?? "").trim();
  if (!reason) throw new Error("Say why the count differs — a reason is required.");

  return tx(() => {
    const plan = planStocktake(input.counts);
    let posted = 0;

    for (const line of plan.lines) {
      if (line.deltaMilli === 0) continue;
      postMovement({
        itemId: line.itemId,
        deltaMilli: line.deltaMilli,
        reason: "stocktake",
        refType: "stocktake",
        userId: input.userId ?? null,
        note: reason,
      });
      posted++;
    }

    if (posted === 0) throw new Error("Every count matches the system — nothing to post.");

    audit(
      input.userId ?? null,
      "stocktake",
      "item",
      null,
      `${posted} of ${plan.countedItems} counted items adjusted; reason: ${reason}`,
    );

    return { ...plan, posted };
  });
}

// ------------------------------------------------------------- recent work

export interface RecentRepack {
  id: number;
  at: string;
  from_name: string;
  unit: string;
  in_milli: number;
  out_milli: number;
  loss_milli: number;
  user_name: string | null;
}

export function recentRepacks(limit = 5): RecentRepack[] {
  return all<RecentRepack>(
    `SELECT r.id, r.at, i.name AS from_name, i.canonical_unit AS unit,
            r.in_milli, r.out_milli, r.loss_milli, u.name AS user_name
       FROM repacks r
       JOIN items i ON i.id = r.from_item_id
       LEFT JOIN users u ON u.id = r.user_id
      ORDER BY r.id DESC
      LIMIT ?`,
    limit,
  );
}
