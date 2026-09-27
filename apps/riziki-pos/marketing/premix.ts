/** Two recipes set to mix in advance, and a few batches already run. */
const ROOT = "../src/lib";
const { run, get, all } = await import(`${ROOT}/db.ts`);
const { setFormulaOutput, recordMix, mixableFormulas } = await import(`${ROOT}/mixing.ts`);
const { currentVersion } = await import(`${ROOT}/production.ts`);

// The products the batches land on the shelf as. Priced per litre, like
// everything else is priced per its own unit.
const MADE: Array<[string, string, string, number, number]> = [
  // formula name, product name, unit, price per unit (cents), litres per batch
  ["Multipurpose", "Multipurpose Cleaner", "L", 22000, 200000],
  ["Carwash Shampoo", "Carwash Shampoo", "L", 30000, 150000],
  ["Fabric Softener", "Fabric Softener", "L", 26000, 120000],
];

for (const [formulaName, product, unit, price, made] of MADE) {
  const f = get<{ id: number }>(`SELECT id FROM formulas WHERE name = ?`, formulaName);
  if (!f) { console.log("no recipe", formulaName); continue; }

  const { lastInsertRowid: itemId } = run(
    `INSERT INTO items (name, kind, canonical_unit, size_milli, unit_label, sellable,
                        price_basis, price_cents, floor_cents, ceiling_cents, cost_cents,
                        reorder_level_milli)
     VALUES (?, 'bulk', ?, 20000, 'jerrican', 1, 'unit', ?, ?, ?, 0, 40000)`,
    product, unit, price, Math.round(price * 0.8), Math.round(price * 1.2),
  );
  setFormulaOutput(f.id, Number(itemId), 1);

  const v = currentVersion(f.id)!;
  /*
    One run each, recorded now.

    They are not back-dated: `stock_movements` is append-only and the trigger
    refuses an UPDATE, which is the guarantee the ledger is sold on. A demo
    that had to be smuggled past it would be a demo of something else.
  */
  const r = recordMix({ versionId: v.id, targetMilli: made, actualMilli: Math.round(made * 0.98), userId: 1 });
  console.log(`${product}: batch ${r.batchNo} made ${(r.madeMilli / 1000).toFixed(0)} ${r.outputUnit} at ${(r.outputCostCents / 100).toFixed(2)}/${r.outputUnit}`);
}
console.log("mixable recipes on the board:", mixableFormulas().length);
