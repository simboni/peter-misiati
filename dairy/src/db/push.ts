/**
 * Apply the schema to the local development database.
 *
 * Deliberately not `drizzle-kit push` — PGlite is a file on disk, not a server
 * with a connection string, so we execute the generated DDL directly.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

async function main() {
  const path = process.env.DATABASE_PATH ?? "./.pgdata";
  const pg = new PGlite(path);
  const ddl = readFileSync(join(process.cwd(), "src/db/ddl.sql"), "utf8");
  await pg.exec(ddl);
  await pg.close();
  console.log(`Schema applied to ${path}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
