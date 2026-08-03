import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "cf-")), "t.db");

import test from "node:test";
import assert from "node:assert/strict";
const { seed } = await import("../src/lib/seed.ts");
const { all, get, stockOf } = await import("../src/lib/db.ts");
const prod = await import("../src/lib/production.ts");
const { toMilli, fromCents } = await import("../src/lib/units.ts");

seed();

test("a bottled batch puts its cost on the bottle and eats the packaging", () => {
  const f: any = get(`SELECT v.id vid FROM formulas f JOIN formula_versions v ON v.formula_id=f.id
                      WHERE f.name='Laundry Soap' AND v.is_current=1`);
  const out: any = get(`SELECT id, size_milli, cost_cents FROM items WHERE name='Laundry Soap 1 L'`);
  assert.equal(out.cost_cents, 0, "starts with no cost");

  const capBefore = stockOf(get<any>(`SELECT id FROM items WHERE name='Bottle cap'`)!.id);
  const bottleId = get<any>(`SELECT id FROM items WHERE name='1 L bottle'`)!.id;
  const bottleBefore = stockOf(bottleId);

  const b = prod.runBatch({ formulaVersionId: f.vid, targetMilli: toMilli(100), userId: 1 });
  const batch: any = get(`SELECT cost_cents FROM batches WHERE id=?`, b.batchId);
  assert.ok(batch.cost_cents > 0, "batch has a reagent cost");

  prod.recordYield({ batchId: b.batchId, actualMilli: toMilli(97), outputItemId: out.id, userId: 1 });

  const after: any = get(`SELECT cost_cents FROM items WHERE id=?`, out.id);
  assert.ok(after.cost_cents > 0, "the bottle now carries a cost");

  // 97 bottles of 1 L consumed 97 bottles, 97 caps, 97 labels
  assert.equal(stockOf(bottleId), bottleBefore - toMilli(97), "97 bottles used");
  assert.equal(stockOf(get<any>(`SELECT id FROM items WHERE name='Bottle cap'`)!.id),
               capBefore - toMilli(97), "97 caps used");

  // cost per bottle = (reagents + packaging) / 97
  const packCents = 97 * (2500 + 300 + 400); // 1 L bottle 25, cap 3, label 4
  const expected = Math.round((batch.cost_cents + packCents) / 97);
  assert.equal(after.cost_cents, expected,
    `cost per bottle should be ${fromCents(expected)} got ${fromCents(after.cost_cents)}`);
  console.log(`   reagents ${fromCents(batch.cost_cents)} + packaging ${fromCents(packCents)} over 97 bottles = ${fromCents(after.cost_cents)}/bottle`);
});
