/**
 * CSV export — OWNER ONLY.
 *
 * "You can always get your data out" is a promise in the quotation, so this
 * route has to work on the worst day: no internet for the fancy version, a phone
 * that is nearly full, a shop that has decided to move to another system. It
 * streams, it escapes properly, and it needs nothing but a browser.
 *
 * `GET /export?table=sales|stock|batches|customers|expenses`
 */

import type { NextRequest } from "next/server";
import { requireOwner } from "@/lib/auth";
import { audit } from "@/lib/db";
import { businessDate } from "@/lib/units";
import { csvStream, isExportTable, EXPORT_TABLES } from "@/lib/reports";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Cost, margin and customer balances all live in these files, so the same
  // owner gate as the reports screen applies. `requireOwner` throws; turn that
  // into an honest status code rather than a stack trace.
  let ownerId: number;
  try {
    const owner = await requireOwner();
    ownerId = owner.id;
  } catch {
    return new Response("Only the owner can export data.\n", {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  // On the request object `searchParams` is plain and synchronous — it is the
  // route's `params`/`searchParams` *props* that became promises in Next.js 16.
  const table = request.nextUrl.searchParams.get("table") ?? "";

  if (!isExportTable(table)) {
    return new Response(
      `Unknown table "${table}". Choose one of: ${EXPORT_TABLES.join(", ")}.\n`,
      { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  audit(ownerId, "export", table);

  const filename = `riziki-${table}-${businessDate()}.csv`;

  return new Response(csvStream(table), {
    status: 200,
    headers: {
      // text/csv plus the filename is what makes Android offer "Save to Files"
      // rather than rendering a wall of text.
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
