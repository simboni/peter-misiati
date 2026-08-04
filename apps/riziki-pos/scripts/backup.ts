/**
 * Nightly database snapshot. Run from cron (see DEPLOY.md):
 *
 *   node --experimental-strip-types scripts/backup.ts
 *
 * Writes data/backups/riziki-YYYY-MM-DD.db via VACUUM INTO — a consistent
 * copy even while the app is running (the live file is in WAL mode; a plain
 * `cp` could tear across the write-ahead log). Keeps the most recent 30 and
 * deletes older ones, so the directory never quietly fills the disk.
 *
 * These snapshots live on the same machine, which protects against mistakes,
 * not fires. The "Download full backup" button on the Reports screen is the
 * off-machine copy — the owner should take one weekly.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { join, dirname } from "node:path";

const KEEP = 30;

const DB_PATH = process.env.RIZIKI_DB ?? join(process.cwd(), "data", "riziki.db");
const BACKUP_DIR = join(dirname(DB_PATH), "backups");

if (!existsSync(DB_PATH)) {
  console.error(`No database at ${DB_PATH} — nothing to back up.`);
  process.exit(1);
}

mkdirSync(BACKUP_DIR, { recursive: true });

// Nairobi date, matching how the app names business days.
const stamp = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Nairobi",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const target = join(BACKUP_DIR, `riziki-${stamp}.db`);

// Re-running on the same day replaces that day's snapshot (VACUUM INTO
// refuses to overwrite, so clear it first).
if (existsSync(target)) unlinkSync(target);

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
db.close();

// Sanity: the snapshot must open and pass its own integrity check before we
// let it count as a backup — a corrupt copy is worse than none, because it
// stops anyone looking for a good one.
const check = new DatabaseSync(target, { readOnly: true });
const result = check.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
check.close();
if (result.integrity_check !== "ok") {
  unlinkSync(target);
  console.error(`Snapshot failed its integrity check and was deleted. Investigate ${DB_PATH}.`);
  process.exit(1);
}

const size = statSync(target).size;
console.log(`Backed up to ${target} (${(size / 1024).toFixed(0)} kB).`);

// Prune, oldest first.
const old = readdirSync(BACKUP_DIR)
  .filter((f) => /^riziki-\d{4}-\d{2}-\d{2}\.db$/.test(f))
  .sort()
  .slice(0, -KEEP);
for (const f of old) {
  unlinkSync(join(BACKUP_DIR, f));
  console.log(`Pruned ${f}.`);
}
