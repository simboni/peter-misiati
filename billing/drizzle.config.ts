import { defineConfig } from "drizzle-kit";

// Generates SQL migrations from the Drizzle schema into ./drizzle, which is
// also wrangler's `migrations_dir` so `wrangler d1 migrations apply` runs them.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
});
