/**
 * Full database backup — OWNER ONLY.
 *
 * CSVs are for reading the data somewhere else; this is for coming back. One
 * file, downloadable to the phone or a memory stick, that restores the whole
 * system — sales, formulas, ledger, users — by being copied back into place.
 *
 * `VACUUM INTO` is the mechanism: it writes a consistent snapshot to a fresh
 * file even while the shop keeps selling (the live db is in WAL mode; copying
 * the file directly could tear across the write-ahead log).
 */

import { readFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { requireOwner } from "@/lib/auth";
import { db, audit } from "@/lib/db";
import { businessDate } from "@/lib/units";

export const dynamic = "force-dynamic";

export async function GET() {
  let ownerId: number;
  try {
    const owner = await requireOwner();
    ownerId = owner.id;
  } catch {
    return new Response("Only the owner can download a backup.\n", {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  // VACUUM INTO refuses to overwrite, so the target must be fresh every time.
  const dir = join(tmpdir(), "riziki-backup");
  mkdirSync(dir, { recursive: true });
  const snapshot = join(dir, `snap-${randomBytes(8).toString("hex")}.db`);

  try {
    db().exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
    const bytes = readFileSync(snapshot);
    audit(ownerId, "backup", "database", null, `${bytes.byteLength} bytes`);

    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": "application/vnd.sqlite3",
        "content-disposition": `attachment; filename="riziki-backup-${businessDate()}.db"`,
        "content-length": String(bytes.byteLength),
        "cache-control": "no-store",
      },
    });
  } finally {
    if (existsSync(snapshot)) unlinkSync(snapshot);
  }
}
