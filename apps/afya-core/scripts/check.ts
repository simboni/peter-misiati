/**
 * Is this installation sound? Run after an update, and any time somebody asks.
 *
 *   node --experimental-strip-types scripts/check.ts
 *
 * Exits non-zero on anything wrong, so deploy/update.sh and cron can act on it
 * without reading the output.
 *
 * Two questions, and they are different. PRAGMA integrity_check asks whether
 * SQLite can still read its own file. The audit chain asks whether anybody has
 * altered a record behind the application's back — a file can be perfectly
 * well-formed and have had a row rewritten in it, and that is exactly the case
 * this system exists to make detectable.
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";

const DB_PATH = process.env.AFYA_DB ?? join(process.cwd(), "data", "afya.db");

if (!existsSync(DB_PATH)) {
  console.error(`No database at ${DB_PATH}.`);
  process.exit(1);
}

let failed = false;

const conn = new DatabaseSync(DB_PATH, { readOnly: true });
const integrity = (conn.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
const foreignKeys = conn.prepare("PRAGMA foreign_key_check").all();
conn.close();

if (integrity === "ok") {
  console.log("file            intact");
} else {
  console.error(`file            CORRUPT — ${integrity}`);
  failed = true;
}

if (foreignKeys.length === 0) {
  console.log("references      consistent");
} else {
  console.error(`references      ${foreignKeys.length} broken — a row points at something that is not there`);
  failed = true;
}

const { verifyAuditChain } = await import("../src/lib/db.ts");
const chain = verifyAuditChain();
if (chain.ok) {
  console.log(`audit chain     intact, ${chain.checked} entries`);
} else {
  console.error(
    `audit chain     BROKEN at entry ${chain.failedAtId} after ${chain.checked} — ${chain.reason}\n` +
      `                Something changed a record outside the application. Do not carry on as if\n` +
      `                this were a bad deployment: keep this file, and go back to the last snapshot\n` +
      `                whose chain verified.`,
  );
  failed = true;
}

process.exit(failed ? 1 : 0);
