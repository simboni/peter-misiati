/**
 * Populate the demo database with a few months of trading so every screen has
 * something real to show: sales at both tiers, credit taken and part-paid,
 * expenses, a delivery, and stock on the shelf.
 *
 * This is demo data only — it never runs against the shop's live database.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { all, get, run, postMovement, tx, db } from "../src/lib/db.ts";

// Backdating demo sales means editing `at`, which the immutability trigger
// rightly forbids in real life. Demo data is the one legitimate exception:
// drop the trigger, and re-run the schema at the end to restore every guard.
run(`DROP TRIGGER IF EXISTS sales_no_money_update`);
process.on("exit", () => {
  db().exec(readFileSync(join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
});
import { recordSale } from "../src/lib/sales.ts";
import { recordPayment } from "../src/lib/credit.ts";
import { recordPurchase } from "../src/lib/purchasing.ts";
import { toCents, toMilli } from "../src/lib/units.ts";

const OWNER = 1, STAFF = 2;
const uuid = () => crypto.randomUUID();
const pick = <T,>(a: T[], i: number) => a[i % a.length];

// --- put finished goods on the shelf --------------------------------------
const finished = all<{ id: number; size_milli: number; name: string }>(
  `SELECT id, size_milli, name FROM items WHERE kind = 'finished'`,
);
for (const [i, f] of finished.entries()) {
  const units = 24 + ((i * 13) % 40);
  postMovement({
    itemId: f.id, deltaMilli: units * f.size_milli, reason: "opening",
    userId: OWNER, note: "bottled stock on hand at go-live",
  });
}

// --- six months of sales ---------------------------------------------------
const sellable = all<{ id: number; retail_cents: number; wholesale_cents: number; kind: string }>(
  `SELECT id, retail_cents, wholesale_cents, kind FROM items
    WHERE sellable = 1 AND retail_cents > 0 ORDER BY kind, id`,
);
const customers = all<{ id: number; name: string }>(`SELECT id, name FROM customers WHERE kind='wholesale'`);

let made = 0;
const VOLUME = [14, 17, 15, 19, 22, 26]; // sales per month, growing
for (let m = 5; m >= 0; m--) {
  const n = VOLUME[5 - m];
  for (let s = 0; s < n; s++) {
    const wholesale = s % 3 === 0;
    const tier = wholesale ? "wholesale" : "retail";
    const lineCount = 1 + (s % 3);
    const lines = Array.from({ length: lineCount }, (_, k) => {
      const it = pick(sellable, s * 5 + k * 7 + m);
      const price = wholesale && it.wholesale_cents > 0 ? it.wholesale_cents : it.retail_cents;
      return { itemId: it.id, units: 1 + ((s + k) % 4), unitPriceCents: price };
    });
    const total = lines.reduce((t, l) => t + l.unitPriceCents * l.units, 0);

    // Every fifth wholesale sale goes out on credit and is only part paid.
    const onCredit = wholesale && s % 5 === 0 && customers.length > 0;
    const paid = onCredit ? Math.round(total * 0.4) : total;
    const tenders: Array<{ method: "cash" | "mpesa" | "credit"; amountCents: number; mpesaCode?: string }> = [];
    if (paid > 0) {
      if (s % 2 === 0) {
        tenders.push({ method: "cash", amountCents: paid });
      } else {
        // a split tender, the ordinary Kenyan counter case
        const cash = Math.round(paid * 0.4);
        if (cash > 0) tenders.push({ method: "cash", amountCents: cash });
        tenders.push({ method: "mpesa", amountCents: paid - cash, mpesaCode: `S${m}${s}${made}XKQ` });
      }
    }
    if (onCredit) tenders.push({ method: "credit", amountCents: total - paid });

    const res = recordSale({
      clientUuid: uuid(),
      userId: s % 4 === 0 ? OWNER : STAFF,
      tier,
      lines,
      tenders,
      customerId: onCredit ? pick(customers, s).id : null,
    });

    // Backdate so the six-month chart and the debtor ageing have real shape.
    const day = 2 + (s % 26);
    const d = new Date();
    d.setMonth(d.getMonth() - m);
    d.setDate(day);
    const iso = d.toISOString().slice(0, 19).replace("T", " ");
    run(`UPDATE sales SET at = ? WHERE id = ?`, iso, res.saleId);
    run(`UPDATE payments SET at = ? WHERE sale_id = ?`, iso, res.saleId);
    made++;
  }
}

// --- a debtor pays something off ------------------------------------------
if (customers.length) {
  const owing = get<{ id: number; due: number }>(
    `SELECT customer_id AS id, SUM(total_cents - paid_cents) AS due
       FROM sales WHERE status='completed' AND total_cents > paid_cents AND customer_id IS NOT NULL
      GROUP BY customer_id ORDER BY due DESC LIMIT 1`,
  );
  if (owing && owing.due > 0) {
    recordPayment({ customerId: owing.id, amountCents: Math.round(owing.due * 0.35), method: "mpesa", mpesaCode: "TGH7YU2PLQ", userId: OWNER });
  }
}

// --- expenses --------------------------------------------------------------
const EXP: Array<[string, number, "cash" | "mpesa", string]> = [
  ["Rent", 18000, "mpesa", "Shop rent"],
  ["Transport", 1500, "cash", "Boda delivery to Kariobangi"],
  ["Airtime", 500, "mpesa", ""],
  ["Casual labour", 2000, "cash", "Bottling help"],
  ["Packaging", 6500, "mpesa", "500 bottles and caps"],
  ["Utilities", 1200, "cash", "Water"],
];
for (const [cat, amt, method, note] of EXP) {
  run(`INSERT INTO expenses (category, amount_cents, method, note, user_id) VALUES (?,?,?,?,?)`,
    cat, toCents(amt), method, note, OWNER);
}

// --- a delivery from a supplier -------------------------------------------
const sup = get<{ id: number }>(`SELECT id FROM suppliers ORDER BY id LIMIT 1`);
const ung = get<{ id: number }>(`SELECT i.id FROM items i JOIN chemicals c ON c.id=i.chemical_id
  WHERE c.name='Ungerol' AND i.kind='bulk'`);
const cau = get<{ id: number }>(`SELECT i.id FROM items i JOIN chemicals c ON c.id=i.chemical_id
  WHERE c.name='Caustic Soda' AND i.kind='bulk'`);
if (sup && ung && cau) {
  recordPurchase({
    supplierId: sup.id,
    lines: [
      { itemId: ung.id, units: 2, costCents: toCents(133000) },
      { itemId: cau.id, units: 4, costCents: toCents(15600) },
    ],
    transportCents: toCents(2500),
    ref: "DN-4471",
    userId: OWNER,
  });
}

const totals = get<{ n: number; v: number }>(
  `SELECT COUNT(*) n, SUM(total_cents) v FROM sales WHERE status='completed'`,
);
console.log(`sales: ${totals?.n}  value: KES ${((totals?.v ?? 0) / 100).toLocaleString()}`);
console.log(`owed:  KES ${(((get<{o:number}>(`SELECT COALESCE(SUM(total_cents-paid_cents),0) o FROM sales WHERE status='completed'`)?.o) ?? 0)/100).toLocaleString()}`);
