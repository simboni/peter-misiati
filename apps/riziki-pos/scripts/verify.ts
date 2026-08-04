process.env.RIZIKI_DB = process.cwd() + "/data/verify.db";
import { rmSync } from "node:fs";
try { rmSync(process.env.RIZIKI_DB!, { force: true }); rmSync(process.env.RIZIKI_DB! + "-wal", { force: true }); rmSync(process.env.RIZIKI_DB! + "-shm", { force: true }); } catch {}

const { seed } = await import("../src/lib/seed.ts");
const dbm = await import("../src/lib/db.ts");
const u = await import("../src/lib/units.ts");

const res = seed();
console.log("seeded:", res);

const items = dbm.all<any>("SELECT COUNT(*) n FROM items")[0];
const moves = dbm.all<any>("SELECT COUNT(*) n FROM stock_movements")[0];
const fv = dbm.all<any>("SELECT COUNT(*) n FROM formula_items")[0];
console.log("items:", items.n, "| movements:", moves.n, "| formula lines:", fv.n);

// Ungerol stock should reflect the sheet's closing column
const ung = dbm.all<any>(`SELECT i.name, i.size_milli, i.unit_label,
   COALESCE(SUM(m.delta_milli),0) qty
   FROM items i LEFT JOIN stock_movements m ON m.item_id=i.id
   JOIN chemicals c ON c.id=i.chemical_id WHERE c.name='Ungerol' GROUP BY i.id`);
console.log("\nUngerol stock:");
for (const r of ung) console.log("  ", r.name.padEnd(34), u.formatQty(r.qty,"kg").padStart(12), "=", u.formatUnits(r.qty, r.size_milli, r.unit_label));

// append-only guarantee
try {
  dbm.run("UPDATE stock_movements SET delta_milli = 999 WHERE id = 1");
  console.log("\nFAIL: ledger was mutable");
} catch (e:any) { console.log("\nledger UPDATE blocked:", e.message.slice(0,60)); }
try {
  dbm.run("DELETE FROM stock_movements WHERE id = 1");
  console.log("FAIL: ledger row deletable");
} catch (e:any) { console.log("ledger DELETE blocked:", e.message.slice(0,60)); }

// scaling maths used by the batch calculator
console.log("\nscaleMilli 1.5kg per 20L -> 100L:", u.fromMilli(u.scaleMilli(u.toMilli(1.5), u.toMilli(100), u.toMilli(20))), "kg (expect 7.5)");
console.log("scaleMilli 0.125kg per 5L -> 20L:", u.fromMilli(u.scaleMilli(u.toMilli(0.125), u.toMilli(20), u.toMilli(5))), "kg (expect 0.5)");
