#!/usr/bin/env node
//
// Apply pending SQL migrations to the app's SQLite database.
//
// This deliberately reuses the SAME bookkeeping wrangler used on Cloudflare D1
// — a `d1_migrations` table listing applied filenames. The production data is
// imported from a `wrangler d1 export` dump, which already contains that table
// with every migration up to 0013 recorded. Reusing it means the import "just
// works": this runner sees them as applied and does not try to re-create
// tables that are already there.
//
//   DATABASE_URL=file:/data/tallypay.db node scripts/migrate.mjs
//
// Each migration file is applied as one transactional batch, so a file either
// lands completely or not at all.

import { createClient } from "@libsql/client";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (expected e.g. file:/data/tallypay.db).");
  process.exit(1);
}

const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });

// Same shape wrangler creates, so a database imported from D1 is recognised.
await client.execute(`
  CREATE TABLE IF NOT EXISTS d1_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

const applied = new Set(
  (await client.execute("SELECT name FROM d1_migrations")).rows.map((r) => String(r.name)),
);

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

let ran = 0;
for (const file of files) {
  if (applied.has(file)) continue;

  const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
  const statements = sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

  if (statements.length === 0) {
    console.log(`  ${file} — empty, recording as applied`);
  } else {
    console.log(`  ${file} — ${statements.length} statement(s)`);
  }

  try {
    await client.batch(
      [...statements, { sql: "INSERT INTO d1_migrations (name) VALUES (?)", args: [file] }],
      "write",
    );
  } catch (err) {
    console.error(`\n✗ ${file} failed — nothing from this file was applied.\n`, err);
    process.exit(1);
  }
  ran++;
}

console.log(
  ran === 0
    ? `Database is up to date (${applied.size} migration(s) already applied).`
    : `Applied ${ran} migration(s); ${applied.size + ran} total.`,
);
await client.close();
