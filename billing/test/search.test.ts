/**
 * Integration tests for global search against a real SQLite database.
 *
 * The LIKE escaping in particular cannot be tested without a database: a bare
 * LIKE and a LIKE ... ESCAPE '\' behave identically on ordinary text and
 * differ only on names containing % or _, which is exactly the case that was
 * wrong before.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/libsql";
import { createClient, type Client } from "@libsql/client";
import * as schema from "../src/server/db/schema";
import { globalSearch } from "../src/server/search";

type DB = ReturnType<typeof drizzle<typeof schema>>;

let dir = "";
let client: Client;
let db: DB;

const ORG = "org-1";
const OTHER = "org-2";
const NOW = new Date("2026-03-20T09:00:00Z");

const titles = (hits: { title: string }[]) => hits.map((h) => h.title).sort();

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "tallypay-search-"));
  client = createClient({ url: `file:${join(dir, "s.db")}` });
  db = drizzle(client, { schema });

  const migrations = join(process.cwd(), "drizzle");
  for (const f of (await readdir(migrations)).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = await readFile(join(migrations, f), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) {
      const t = stmt.trim();
      if (t) await client.execute(t);
    }
  }

  for (const id of [ORG, OTHER]) {
    await db.insert(schema.organization).values({ id, name: id, slug: id, createdAt: NOW });
  }

  await db.insert(schema.client).values([
    { id: "c1", organizationId: ORG, name: "Zippy Dry Cleaners", email: "zippy@example.test", phone: "0712345678" },
    { id: "c2", organizationId: ORG, name: "50% Off Traders" },
    { id: "c3", organizationId: ORG, name: "Under_score Co" },
    { id: "c9", organizationId: OTHER, name: "Rival Holdings", email: "rival@example.test" },
  ]);

  const inv = (id: string, number: string, total: number, org = ORG, cid = "c1", type = "invoice") => ({
    id,
    organizationId: org,
    clientId: cid,
    number,
    type,
    status: "sent",
    issueDate: NOW,
    dueDate: NOW,
    currency: "KES",
    subtotal: total,
    total,
    balanceDue: total,
    shareToken: `tok-${id}`,
  });

  await db.insert(schema.invoice).values([
    inv("i1", "INV-0042", 2_000_000),
    inv("i2", "INV-0043", 4_550_050),
    inv("i3", "QUO-0001", 999_999, ORG, "c1", "quotation"),
    inv("i9", "INV-9999", 2_000_000, OTHER, "c9"),
  ]);

  await db.insert(schema.item).values([
    { id: "it1", organizationId: ORG, name: "Dry cleaning service", description: "Per garment, express", unitPrice: 50_000 },
    { id: "it2", organizationId: ORG, name: "Retired service", unitPrice: 100, active: false },
  ]);
});

after(async () => {
  client?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

test("finds an invoice by number, whatever the case", async () => {
  assert.deepEqual(titles(await globalSearch(db, ORG, "INV-0042")), ["INV-0042"]);
  assert.deepEqual(titles(await globalSearch(db, ORG, "inv-0042")), ["INV-0042"]);
});

test("finds an invoice by the amount a person would type", async () => {
  assert.deepEqual(titles(await globalSearch(db, ORG, "20000")), ["INV-0042"]);
  assert.deepEqual(titles(await globalSearch(db, ORG, "20,000")), ["INV-0042"], "commas are ignored");
  assert.deepEqual(titles(await globalSearch(db, ORG, "45500.50")), ["INV-0043"], "decimals work");
});

test("a client's name finds the client and their invoices", async () => {
  const hits = await globalSearch(db, ORG, "Zippy");
  assert.deepEqual(titles(hits), ["INV-0042", "INV-0043", "QUO-0001", "Zippy Dry Cleaners"]);
});

test("clients are searchable by email and phone", async () => {
  assert.deepEqual(titles(await globalSearch(db, ORG, "zippy@example")), ["Zippy Dry Cleaners"]);
  assert.deepEqual(titles(await globalSearch(db, ORG, "071234")), ["Zippy Dry Cleaners"]);
});

// The regression this file exists for.
test("LIKE wildcards in the DATA are findable", async () => {
  assert.deepEqual(titles(await globalSearch(db, ORG, "50%")), ["50% Off Traders"]);
  assert.deepEqual(titles(await globalSearch(db, ORG, "50% Off")), ["50% Off Traders"]);
  assert.deepEqual(titles(await globalSearch(db, ORG, "Under_score")), ["Under_score Co"]);
});

test("LIKE wildcards in the QUERY are not treated as wildcards", async () => {
  // Were these unescaped, "%%" would match every row in every table.
  assert.deepEqual(await globalSearch(db, ORG, "%%"), []);
  assert.deepEqual(await globalSearch(db, ORG, "___"), []);
  assert.deepEqual(await globalSearch(db, ORG, "%Zippy%"), [], "literal, so no match");
});

test("search never crosses the tenant boundary", async () => {
  // Same amount exists in both orgs; only ours may come back.
  assert.deepEqual(titles(await globalSearch(db, ORG, "20000")), ["INV-0042"]);
  assert.deepEqual(titles(await globalSearch(db, OTHER, "20000")), ["INV-9999"]);
  assert.deepEqual(await globalSearch(db, ORG, "Rival"), [], "another tenant's client is invisible");
  assert.deepEqual(await globalSearch(db, ORG, "INV-9999"), []);
});

test("inactive items are left out", async () => {
  assert.deepEqual(titles(await globalSearch(db, ORG, "Retired")), []);
  assert.deepEqual(titles(await globalSearch(db, ORG, "Dry cleaning")), ["Dry cleaning service"]);
});

test("quotations are labelled as quotations, not invoices", async () => {
  const hits = await globalSearch(db, ORG, "QUO-0001");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, "quotation");
  assert.equal(hits[0].href, "/quotations/i3");
});

test("a one-character query does no work", async () => {
  assert.deepEqual(await globalSearch(db, ORG, "I"), []);
  assert.deepEqual(await globalSearch(db, ORG, " "), []);
  assert.deepEqual(await globalSearch(db, ORG, ""), []);
});
