/**
 * Rebuild `src/db/ddl.sql` from the drizzle migration folder.
 *
 * `ddl.sql` is what `createTestDb()` and `push.ts` actually execute — PGlite is
 * a file on disk, not a server, so there is no `drizzle-kit migrate` to run
 * against it. The file used to be concatenated by hand after every
 * `drizzle-kit generate`, which is exactly the kind of step that gets skipped
 * once and then silently drifts from the schema for a fortnight.
 *
 *   npx tsx src/db/build-ddl.ts
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(process.cwd(), "drizzle");
const OUT = join(process.cwd(), "src/db/ddl.sql");

const files = readdirSync(MIGRATIONS)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort();

if (files.length === 0) {
  console.error(`No migrations found in ${MIGRATIONS}`);
  process.exit(1);
}

const statements: string[] = [];
for (const f of files) {
  const sql = readFileSync(join(MIGRATIONS, f), "utf8");
  for (const raw of sql.split("--> statement-breakpoint")) {
    const s = raw.trim();
    if (s.length > 0) statements.push(s.endsWith(";") ? s : `${s};`);
  }
}

const header = `-- GENERATED FILE — do not edit.
-- Rebuilt from drizzle/*.sql by \`npx tsx src/db/build-ddl.ts\`.
-- Source migrations: ${files.join(", ")}
`;

writeFileSync(OUT, `${header}\n${statements.join("\n")}\n`, "utf8");
console.log(`${OUT} — ${statements.length} statements from ${files.length} migration(s)`);
