import { optionalSession } from "@/lib/dal";
import { isISODate, type ISODate } from "@/lib/domain/dates";
import { reportCsv, toCsvBundle, isReportName } from "@/server/reports";

/**
 * CSV export.
 *
 * A Route Handler rather than a Server Action because the browser must receive
 * a FILE — `<a download>` and nothing else, so it works on a cheap Android
 * phone with no JavaScript in the path.
 *
 * CSV rather than XLSX or PDF because CSV opens on any phone in Kenya, weighs
 * nothing on a 2G link and can be re-read from cache. `/reports/export/all` is
 * the full data dump: vendor lock-in is failure #2 in this market and the exit
 * door is deliberately unlocked and clearly signposted.
 *
 * SECURITY: a Route Handler is a public HTTP endpoint. It re-derives the
 * session itself and never trusts a query parameter for identity — the farm
 * scope comes from the cookie, and every query underneath filters on it.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const session = await optionalSession();
  if (!session?.userId) {
    // No redirect: a download that silently returns the login page as a CSV is
    // worse than an honest refusal.
    return new Response("Sign in first, then download again.\r\n", {
      status: 401,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const { name } = await params; // Next 16: params is always a Promise.
  if (!isReportName(name)) {
    return new Response("There is no report by that name.\r\n", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const url = new URL(request.url);
  const opt = (key: string): ISODate | undefined => {
    const v = url.searchParams.get(key);
    return v && isISODate(v) ? v : undefined;
  };
  const month = url.searchParams.get("month") ?? undefined;

  try {
    const tables = await reportCsv(session, name, {
      from: opt("from"),
      to: opt("to"),
      asOf: opt("asOf"),
      month: month && /^\d{4}-\d{2}(-\d{2})?$/.test(month) ? month : undefined,
    });

    const body = toCsvBundle(tables);
    const filename = `${tables[0]?.name ?? name}.csv`;

    return new Response(
      // A BOM, so Excel on a Windows machine at the co-operative office opens
      // Kenyan names with accents correctly instead of as mojibake.
      `\uFEFF${body}`,
      {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${filename}"`,
          "cache-control": "no-store",
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "That report could not be built.";
    return new Response(`${message}\r\n`, {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}
