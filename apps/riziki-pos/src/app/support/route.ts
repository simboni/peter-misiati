import type { NextRequest } from "next/server";
import { requireOwner } from "@/lib/auth";
import { audit } from "@/lib/db";
import { businessDate } from "@/lib/units";
import { listRange, readListPeriod } from "@/lib/list-range";
import { supportBundle, bundleName } from "@/lib/support-bundle";

export const dynamic = "force-dynamic";

/**
 * One file to send when somebody is helping with the figures.
 *
 * `GET /support?period=month`, or `&from=…&to=…`.
 *
 * Owner only, like every other export — it carries cost and margin. What it
 * does NOT carry is anybody's name: see `lib/support-bundle`, where the columns
 * are emptied at the source rather than left to whoever presses the button to
 * remember.
 *
 * The audit log records the range, because "what did we send, and when" is a
 * question worth being able to answer later.
 */
export async function GET(request: NextRequest) {
  let ownerId: number;
  try {
    const owner = await requireOwner();
    ownerId = owner.id;
  } catch {
    return new Response("Only the owner can take these figures out.\n", {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const sp = request.nextUrl.searchParams;
  const period = readListPeriod({
    period: sp.get("period") ?? undefined,
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
  });
  const range = listRange(period, businessDate(), sp.get("from") ?? undefined, sp.get("to") ?? undefined);

  audit(
    ownerId,
    "export",
    "support",
    null,
    range ? `${range.from} to ${range.to}, names removed` : "everything, names removed",
  );

  return new Response(supportBundle(range), {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="${bundleName(range)}"`,
      "cache-control": "no-store",
    },
  });
}
