/**
 * The one-off move from pack prices to a price per kilogram.
 *
 *   node --experimental-strip-types scripts/adopt-unit-prices.ts
 *
 * Deliberately a script the owner runs, not something that happens when the app
 * opens the database. It rewrites prices and moves stock between rows, and a
 * migration that does that on its own — silently, on whichever machine happened
 * to start first — is one nobody can point at afterwards.
 *
 * Safe to run twice. Back the database up first anyway: `npm run backup`.
 */

import { adoptUnitPricing } from "../src/lib/catalog.ts";
import { formatKes, formatQty } from "../src/lib/units.ts";

const report = adoptUnitPricing(null);

for (const p of report.priced) {
  console.log(`  ${p.name.padEnd(28)} ${formatKes(p.rateCents).padStart(12)} per unit  (from its ${p.from})`);
}

console.log("");
console.log(`Priced per unit:   ${report.priced.length} chemicals`);
console.log(`Pack rows retired: ${report.packsRetired}`);
console.log(`Stock moved back:  ${formatQty(report.movedMilli, "kg")}`);

if (report.unpriced.length) {
  console.log("");
  console.log("No priced pack to work from — set these by hand under Prices for today:");
  for (const name of report.unpriced) console.log(`  - ${name}`);
}
