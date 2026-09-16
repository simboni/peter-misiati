/**
 * A snapshot of the facility's database. Run from cron (see DEPLOY.md), and
 * by deploy/update.sh before it touches anything:
 *
 *   node --experimental-strip-types scripts/backup.ts
 *
 * VACUUM INTO, not `cp`. The live file is in WAL mode and a plain copy can
 * tear across the write-ahead log — producing a file that opens, looks fine,
 * and is missing the last consultation. Every snapshot is integrity-checked
 * and its audit chain re-verified before it is allowed to count.
 *
 * TIMED TO THE MINUTE, NOT THE DAY. An update takes a snapshot, and two
 * updates in one afternoon must not overwrite each other's — the second one
 * is taken precisely because the first went wrong.
 *
 * These live on the same machine, which protects against a mistake and not
 * against a fire. An off-machine copy is a separate job and DEPLOY.md says so.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { join, dirname } from "node:path";

/** Snapshots to keep. A clinic's database is small; history is cheap. */
const KEEP = Number(process.env.AFYA_BACKUPS_KEEP ?? 60);

const DB_PATH = process.env.AFYA_DB ?? join(process.cwd(), "data", "afya.db");
const BACKUP_DIR = join(dirname(DB_PATH), "backups");

if (!existsSync(DB_PATH)) {
  console.error(`No database at ${DB_PATH} — nothing to back up.`);
  process.exit(1);
}

mkdirSync(BACKUP_DIR, { recursive: true });

// Nairobi time, because that is the clock the people reading the filename are on.
const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Nairobi",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
}).formatToParts(new Date());
const at = (type: string) => parts.find((p) => p.type === type)!.value;
const stamp = `${at("year")}-${at("month")}-${at("day")}-${at("hour")}${at("minute")}`;

const target = join(BACKUP_DIR, `afya-${stamp}.db`);
if (existsSync(target)) unlinkSync(target); // VACUUM INTO refuses to overwrite.

const live = new DatabaseSync(DB_PATH, { readOnly: true });
live.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
live.close();

// A corrupt snapshot is worse than none: it stops whoever is looking for a
// good one. Both checks run against the copy, never against the live file.
const copy = new DatabaseSync(target, { readOnly: true });
const integrity = (copy.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
copy.close();
if (integrity !== "ok") {
  unlinkSync(target);
  console.error(`Snapshot failed its integrity check and was deleted. Investigate ${DB_PATH}.`);
  process.exit(1);
}

// And the chain, which is the thing that makes this an evidential record
// rather than a pile of rows. Verified against the snapshot by pointing the
// app's own verifier at it.
process.env.AFYA_DB = target;
const { verifyAuditChain } = await import("../src/lib/db.ts");
const chain = verifyAuditChain();
if (!chain.ok) {
  console.error(
    `Snapshot's audit chain is broken at entry ${chain.failedAtId} (${chain.reason}). ` +
      `The snapshot is kept at ${target} — it is evidence — but do not treat it as a clean restore point.`,
  );
  process.exit(1);
}

console.log(
  `Backed up to ${target} (${(statSync(target).size / 1024).toFixed(0)} kB, ` +
    `audit chain intact over ${chain.checked} entries).`,
);

// Prune, oldest first. The name sorts chronologically, which is why it is shaped that way.
const old = readdirSync(BACKUP_DIR)
  .filter((f) => /^afya-\d{4}-\d{2}-\d{2}-\d{4}\.db$/.test(f))
  .sort()
  .slice(0, -KEEP);
for (const f of old) {
  unlinkSync(join(BACKUP_DIR, f));
  console.log(`Pruned ${f}.`);
}
