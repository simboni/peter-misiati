import { drizzle } from "drizzle-orm/d1";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cache } from "react";
import * as schema from "./schema";

export type DB = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Request-scoped Drizzle client bound to the Cloudflare D1 database (`env.DB`).
 * Wrapped in React cache() so the many getDb() calls across a single request
 * reuse one client instead of re-resolving the Cloudflare context and building
 * a fresh Drizzle instance every time.
 */
export const getDb = cache(async (): Promise<DB> => {
  const { env } = await getCloudflareContext({ async: true });
  return drizzle(env.DB, { schema });
});

export { schema };
