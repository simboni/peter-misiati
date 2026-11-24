/**
 * The money figures on every screen must agree.
 *
 * Seeded with the exact shape the 24 Nov 2026 product audit found in
 * production: KES 77,750 of unsent drafts, and KES 46,500 genuinely owed on
 * two sent invoices. The dashboard was reporting 124,250 — drafts counted as
 * receivables — because `totalInvoiced` excluded drafts while `outstanding`
 * beside it did not, and Reports excluded neither.
 *
 * A finance tool that miscounts loses users silently, so this file exists to
 * make that failure loud. If someone adds a money figure with its own idea of
 * which invoices count, these assertions break.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/libsql";
import { createClient, type Client } from "@libsql/client";
import * as schema from "../src/server/db/schema";
import { loadDashboard } from "../src/server/dashboard";
import { loadChaseQueue } from "../src/server/reminder-queue";

type DB = ReturnType<typeof drizzle<typeof schema>>;

let dir = "";
let client: Client;
let db: DB;

const ORG = "org-1";
const NOW = new Date("2026-11-24T09:00:00Z");
const LONG_AGO = new Date("2026-07-23T09:00:00Z"); // ~124 days before NOW
const FUTURE = new Date("2026-12-31T09:00:00Z");

// What the audit found in production, to the shilling.
const DRAFT_TOTAL = 7 * 500_000 + 2_275_000 + 2_000_000; // KES 77,750.00 in cents
const OWED_TOTAL = 4_000_000 + 650_000; // KES 46,500.00 — INV-0026 + INV-0001
const OVERDUE_TOTAL = 650_000; // only INV-0001 is past due

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "tallypay-money-"));
  client = createClient({ url: `file:${join(dir, "m.db")}` });
  db = drizzle(client, { schema });

  for (const f of (await readdir(join(process.cwd(), "drizzle"))).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = await readFile(join(process.cwd(), "drizzle", f), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) {
      const t = stmt.trim();
      if (t) await client.execute(t);
    }
  }

  await db.insert(schema.organization).values({ id: ORG, name: "SMP", slug: "smp", createdAt: NOW });
  await db.insert(schema.orgProfile).values({ id: "p1", organizationId: ORG });
  await db.insert(schema.client).values({ id: "c1", organizationId: ORG, name: "A Client", email: "c@example.test" });

  const inv = (
    id: string,
    number: string,
    total: number,
    status: string,
    dueDate: Date | null,
    paid = 0,
  ): typeof schema.invoice.$inferInsert => ({
    id,
    organizationId: ORG,
    clientId: "c1",
    number,
    type: "invoice",
    status,
    issueDate: LONG_AGO,
    dueDate,
    currency: "KES",
    subtotal: total,
    total,
    amountPaid: paid,
    balanceDue: Math.max(0, total - paid),
    shareToken: `tok-${id}`,
  });

  const rows = [
    // 7 drafts of KES 5,000, plus two larger ones — never sent to anybody.
    ...Array.from({ length: 7 }, (_, i) => inv(`d${i}`, `DRAFT-${i}`, 500_000, "draft", LONG_AGO)),
    inv("d7", "DRAFT-7", 2_275_000, "draft", LONG_AGO),
    inv("d8", "DRAFT-8", 2_000_000, "draft", LONG_AGO),
    // Genuinely owed.
    inv("i26", "INV-0026", 4_000_000, "sent", FUTURE),
    inv("i01", "INV-0001", 650_000, "sent", LONG_AGO),
    // Settled and cancelled — neither is outstanding.
    inv("ip", "INV-0010", 1_000_000, "paid", LONG_AGO, 1_000_000),
    inv("iv", "INV-0011", 9_900_000, "void", LONG_AGO),
  ];
  await db.insert(schema.invoice).values(rows);
});

after(async () => {
  client?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

test("the dashboard does not count drafts as money owed", async () => {
  const d = await loadDashboard(db, ORG, NOW);
  assert.equal(
    d.outstanding,
    OWED_TOTAL,
    `outstanding should be ${OWED_TOTAL} (46,500.00), not ${d.outstanding} — drafts must not count`,
  );
  assert.equal(d.openCount, 2, "two real open invoices, not eleven");
});

test("invoiced and outstanding use the SAME rule as each other", async () => {
  const d = await loadDashboard(db, ORG, NOW);
  // Invoiced = the two sent + the paid one. Drafts and the void are excluded
  // from BOTH figures; previously only this one excluded them.
  assert.equal(d.totalInvoiced, OWED_TOTAL + 1_000_000);
  assert.ok(
    d.totalInvoiced >= d.outstanding,
    "you cannot owe more than was ever invoiced — that is the symptom the audit caught",
  );
});

test("overdue means sent, owing, and past its due date", async () => {
  const d = await loadDashboard(db, ORG, NOW);
  assert.equal(d.overdue, OVERDUE_TOTAL, "only INV-0001 is overdue");
  assert.equal(d.overdueCount, 1, "one overdue invoice, not three");
});

test("a void invoice is money to nobody", async () => {
  const d = await loadDashboard(db, ORG, NOW);
  assert.ok(d.totalInvoiced < 9_900_000, "the void invoice must not appear in invoiced");
  assert.ok(d.outstanding < 9_900_000, "nor in outstanding");
});

// The one that matters: two screens, one answer.
test("the dashboard and the chase queue agree on what is owed", async () => {
  const d = await loadDashboard(db, ORG, NOW);
  const { rows } = await loadChaseQueue(db, ORG, NOW);
  const queueOwed = rows.reduce((s, r) => s + r.balanceDue, 0);

  assert.equal(
    queueOwed,
    d.outstanding,
    `Reminders says ${queueOwed} and the dashboard says ${d.outstanding}. ` +
      "Two screens must never give a vendor two different answers about their own money.",
  );
  assert.equal(queueOwed, OWED_TOTAL);
});

test("the chase queue contains no drafts", async () => {
  const { rows } = await loadChaseQueue(db, ORG, NOW);
  assert.deepEqual(
    rows.map((r) => r.number).sort(),
    ["INV-0001", "INV-0026"],
    "only invoices someone has actually been sent",
  );
});
