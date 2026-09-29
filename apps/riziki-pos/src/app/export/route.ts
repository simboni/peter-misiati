/**
 * CSV export — OWNER ONLY.
 *
 * "You can always get your data out" is a promise in the quotation, so this
 * route has to work on the worst day: no internet for the fancy version, a phone
 * that is nearly full, a shop that has decided to move to another system. It
 * streams, it escapes properly, and it needs nothing but a browser.
 *
 * `GET /export?table=sales|stock|batches|customers|expenses`
 *
 * Optionally `&period=month` or `&from=…&to=…`, in which case the file holds
 * that slice of business days and nothing else. That is not only convenience:
 * answering a question about one Tuesday used to mean handing over every sale
 * the shop has ever made, because whole-table was the only export there was.
 */

import type { NextRequest } from "next/server";
import { requireOwner } from "@/lib/auth";
import { audit } from "@/lib/db";
import { businessDate } from "@/lib/units";
import { csvStream, isExportTable, isDatedExport, EXPORT_TABLES } from "@/lib/reports";
import { listRange, readListPeriod } from "@/lib/list-range";

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
  const sp = request.nextUrl.searchParams;
  const table = sp.get("table") ?? "";

  if (!isExportTable(table)) {
    return new Response(
      `Unknown table "${table}". Choose one of: ${EXPORT_TABLES.join(", ")}.\n`,
      { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  /*
    The dates the screen was filtered to, carried into the file.

    A table with no date of its own — the shelf, the customer list — ignores
    them rather than silently returning nothing: both are snapshots of now, and
    a range over either would be a claim nobody could check.
  */
  const period = readListPeriod({
    period: sp.get("period") ?? undefined,
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
  });
  const range = isDatedExport(table)
    ? listRange(period, businessDate(), sp.get("from") ?? undefined, sp.get("to") ?? undefined)
    : null;

  // The audit log says WHAT was taken out, so it has to say how much of it.
  audit(ownerId, "export", table, null, range ? `${range.from} to ${range.to}` : "everything");

  const span = range ? `${range.from}_to_${range.to}` : businessDate();
  const filename = `riziki-${table}-${span}.csv`;

  return new Response(csvStream(table, range), {
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
