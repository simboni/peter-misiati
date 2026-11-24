/**
 * Integration tests for the chase queue against a real SQLite database.
 *
 * reminders.test.ts covers the scheduling arithmetic in isolation; this file
 * covers the part that only a database can tell you — that the WHERE clause
 * actually excludes drafts, paid invoices, quotations and other tenants' rows,
 * and that a recorded send stops a step from firing again.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/libsql";
import { createClient, type Client } from "@libsql/client";
import * as schema from "../src/server/db/schema";
import { loadChaseQueue, recordManualChase } from "../src/server/reminder-queue";

type DB = ReturnType<typeof drizzle<typeof schema>>;

let dir = "";
let client: Client;
let db: DB;

const ORG = "org-1";
const OTHER_ORG = "org-2";
const DUE = new Date("2026-03-10T09:00:00Z");
const NOW = new Date("2026-03-20T09:00:00Z"); // 10 days past due

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "tallypay-test-"));
  client = createClient({ url: `file:${join(dir, "test.db")}` });
  db = drizzle(client, { schema });

  // Apply the real migrations so the test runs against production DDL.
  const migrations = join(process.cwd(), "drizzle");
  const files = (await readdir(migrations)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const sql = await readFile(join(migrations, f), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) {
      const trimmed = stmt.trim();
      if (trimmed) await client.execute(trimmed);
    }
  }

  for (const id of [ORG, OTHER_ORG]) {
    await db.insert(schema.organization).values({ id, name: `Org ${id}`, slug: id, createdAt: NOW });
    await db.insert(schema.orgProfile).values({ id: `prof-${id}`, organizationId: id });
  }

  await db.insert(schema.client).values([
    { id: "c1", organizationId: ORG, name: "Zippy Dry Cleaners", email: "zippy@example.test" },
    { id: "c2", organizationId: ORG, name: "Opted Out Ltd", email: "out@example.test", remindersOptOut: true },
    { id: "c3", organizationId: ORG, name: "No Email Co" },
    { id: "c9", organizationId: OTHER_ORG, name: "Someone Else" },
  ]);

  const inv = (
    id: string,
    over: Partial<typeof schema.invoice.$inferInsert> = {},
  ): typeof schema.invoice.$inferInsert => ({
    id,
    organizationId: ORG,
    clientId: "c1",
    number: id.toUpperCase(),
    type: "invoice",
    status: "sent",
    issueDate: DUE,
    dueDate: DUE,
    currency: "KES",
    total: 50_000,
    balanceDue: 50_000,
    shareToken: `tok-${id}`,
    ...over,
  });

  await db.insert(schema.invoice).values([
    inv("chase-me"),
    inv("part-paid", { status: "partial", amountPaid: 20_000, balanceDue: 30_000 }),
    inv("overdue-status", { status: "overdue" }),
    inv("paused", { remindersPaused: true }),
    inv("opted-out", { clientId: "c2" }),
    inv("no-email", { clientId: "c3" }),
    inv("not-due-yet", { dueDate: new Date("2026-04-30T09:00:00Z") }),
    // All of the following must stay OUT of the queue entirely.
    inv("still-draft", { status: "draft" }),
    inv("settled", { status: "paid", amountPaid: 50_000, balanceDue: 0 }),
    inv("voided", { status: "void" }),
    inv("no-due-date", { dueDate: null }),
    inv("a-quotation", { type: "quotation" }),
    inv("other-tenant", { organizationId: OTHER_ORG, clientId: "c9" }),
  ]);
});

after(async () => {
  client?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

test("the queue holds only chaseable invoices for this org", async () => {
  const { rows } = await loadChaseQueue(db, ORG, NOW);
  const ids = rows.map((r) => r.id).sort();
  assert.deepEqual(ids, [
    "chase-me",
    "no-email",
    "not-due-yet",
    "opted-out",
    "overdue-status",
    "part-paid",
    "paused",
  ]);
});

test("a draft, a paid, a void, a quotation and another tenant never appear", async () => {
  const { rows } = await loadChaseQueue(db, ORG, NOW);
  const ids = new Set(rows.map((r) => r.id));
  for (const gone of ["still-draft", "settled", "voided", "no-due-date", "a-quotation", "other-tenant"]) {
    assert.ok(!ids.has(gone), `${gone} should not be in the queue`);
  }
});

test("rows carry the age and the step that is due", async () => {
  const { rows } = await loadChaseQueue(db, ORG, NOW);
  const r = rows.find((x) => x.id === "chase-me")!;
  assert.equal(r.daysOverdue, 10);
  assert.equal(r.step, 7, "latest passed step of -3,0,3,7,14 at 10 days late is 7");
  assert.equal(r.blocked, null);
  assert.equal(r.sentSteps.length, 0);
});

test("blocked rows stay in the queue but say why", async () => {
  const { rows } = await loadChaseQueue(db, ORG, NOW);
  const by = (id: string) => rows.find((x) => x.id === id)!;

  assert.equal(by("paused").blocked, "paused");
  assert.equal(by("paused").step, null, "a paused invoice never has a step due");

  assert.equal(by("opted-out").blocked, "client-opted-out");
  assert.equal(by("opted-out").step, null);

  assert.equal(by("no-email").blocked, "no-email");
  // No email is not a scheduling block — the step is due, it just can't be
  // emailed, which is what puts it in front of the vendor to send by hand.
  assert.equal(by("no-email").step, 7);
});

test("an invoice not yet due is listed with nothing to send", async () => {
  const { rows } = await loadChaseQueue(db, ORG, NOW);
  const r = rows.find((x) => x.id === "not-due-yet")!;
  assert.ok(r.daysOverdue < 0);
  assert.equal(r.step, null);
});

test("part-paid invoices are chased for the remaining balance", async () => {
  const { rows } = await loadChaseQueue(db, ORG, NOW);
  const r = rows.find((x) => x.id === "part-paid")!;
  assert.equal(r.balanceDue, 30_000);
  assert.equal(r.step, 7);
});

test("recording a chase stops that step firing again", async () => {
  const before = await loadChaseQueue(db, ORG, NOW);
  assert.equal(before.rows.find((r) => r.id === "overdue-status")!.step, 7);

  await recordManualChase(db, {
    organizationId: ORG,
    invoiceId: "overdue-status",
    step: 7,
    channel: "whatsapp",
    tone: "firm",
    now: NOW,
  });

  const after1 = await loadChaseQueue(db, ORG, NOW);
  const r = after1.rows.find((x) => x.id === "overdue-status")!;
  assert.deepEqual(r.sentSteps, [7]);
  assert.equal(r.step, null, "the quiet period holds after a same-day send");

  // Four days later the 14-day step has passed and is unsent, so it is due.
  const later = await loadChaseQueue(db, ORG, new Date("2026-03-24T09:00:00Z"));
  assert.equal(later.rows.find((x) => x.id === "overdue-status")!.step, 14);
});

test("recording the same step twice does not double-log it", async () => {
  for (let i = 0; i < 2; i++) {
    await recordManualChase(db, {
      organizationId: ORG,
      invoiceId: "part-paid",
      step: 7,
      channel: "whatsapp",
      tone: "friendly",
      now: NOW,
    });
  }
  const { rows } = await loadChaseQueue(db, ORG, NOW);
  assert.deepEqual(rows.find((r) => r.id === "part-paid")!.sentSteps, [7]);
});

test("the queue is ordered most overdue first", async () => {
  const { rows } = await loadChaseQueue(db, ORG, NOW);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i - 1].daysOverdue >= rows[i].daysOverdue, "rows must descend by age");
  }
});
