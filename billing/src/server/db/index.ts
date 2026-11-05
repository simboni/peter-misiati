import { drizzle } from "drizzle-orm/libsql";
import { createClient, type Client } from "@libsql/client";
import * as schema from "./schema";

export type DB = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Drizzle client bound to the app's SQLite database over libSQL.
 *
 * libSQL (not better-sqlite3) because Drizzle only exposes `db.batch()` on the
 * libSQL/D1 drivers, and every document save relies on batch() to write a
 * header and its line items atomically — see server/d1-limits.ts.
 *
 * Built ONCE for the life of the process. This is a long-lived Node server
 * rather than a per-request Worker isolate, so a new client per request would
 * leak file handles and throw away SQLite's prepared-statement cache.
 */
let client: Client | null = null;
let instance: DB | null = null;

export async function getDb(): Promise<DB> {
  if (!instance) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set (expected e.g. file:/data/tallypay.db). Refusing to start without a database.",
      );
    }
    client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });
    instance = drizzle(client, { schema });
  }
  return instance;
}

export { schema };
