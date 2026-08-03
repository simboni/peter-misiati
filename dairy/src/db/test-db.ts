import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as schema from "./schema";

/**
 * A throwaway in-memory database per test file.
 *
 * Real Postgres semantics — window functions, generated columns, array columns,
 * `on conflict do nothing` — without a server, so the whole suite runs in CI or
 * on a laptop with nothing installed.
 */
export async function createTestDb() {
  const pg = new PGlite(); // in-memory
  const ddl = readFileSync(join(process.cwd(), "src/db/ddl.sql"), "utf8");
  await pg.exec(ddl);
  return { db: drizzle(pg, { schema }), pg, close: () => pg.close() };
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>["db"];
