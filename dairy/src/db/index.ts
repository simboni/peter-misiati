import "server-only";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "./schema";

/**
 * Database client.
 *
 * Development and test run on PGlite — real Postgres semantics, compiled to
 * WASM, no server to install. Production points the same Drizzle schema at a
 * managed Postgres; because we stayed on plain Postgres with no vendor
 * extensions, that migration is a `pg_dump` rather than a rewrite.
 */

declare global {
  // eslint-disable-next-line no-var
  var __dairyPg: PGlite | undefined;
}

function client(): PGlite {
  // Reuse across hot reloads in dev, otherwise every save opens a new database.
  if (!globalThis.__dairyPg) {
    globalThis.__dairyPg = new PGlite(process.env.DATABASE_PATH ?? "./.pgdata");
  }
  return globalThis.__dairyPg;
}

export const db = drizzle(client(), { schema });
export { schema };
export type Db = typeof db;
