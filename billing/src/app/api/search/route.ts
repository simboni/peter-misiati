import { requireOrg } from "@/server/org";
import { globalSearch } from "@/server/search";

export const dynamic = "force-dynamic";

/**
 * Backs the ⌘K palette. Scoped through requireOrg, so a signed-in user can
 * only ever search their own workspace — the organizationId comes from the
 * session, never from the request.
 */
export async function GET(req: Request) {
  const { db, organizationId } = await requireOrg();
  const q = new URL(req.url).searchParams.get("q") ?? "";

  // Bound the input: a palette query is a few words, and an enormous string
  // would only make LIKE scan harder for no benefit.
  if (q.length > 120) return Response.json({ hits: [] });

  const hits = await globalSearch(db, organizationId, q);
  return Response.json(
    { hits },
    { headers: { "Cache-Control": "no-store" } },
  );
}
