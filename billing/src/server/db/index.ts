import { drizzle } from "drizzle-orm/d1";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import * as schema from "./schema";

export type DB = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Request-scoped Drizzle client bound to the Cloudflare D1 database (`env.DB`).
 * The binding only exists per-request, so we resolve it lazily each call.
 */
export async function getDb(): Promise<DB> {
  const { env } = await getCloudflareContext({ async: true });
  return drizzle(env.DB, { schema });
}

export { schema };
