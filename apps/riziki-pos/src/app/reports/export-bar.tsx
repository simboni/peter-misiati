import Link from "next/link";
import { EXPORT_TABLES, describeRange, type DateRange } from "@/lib/reports";
import { ExportButtons } from "@/components/export-buttons";

/**
 * Taking the numbers out of the app.
 *
 * Three ways, because three different things get asked for:
 *
 * The report itself, on paper or as a PDF — what goes to a bank or a landlord.
 * That is the browser's own print, over a stylesheet that drops the navigation
 * and the buttons, so what prints is the reading and not the furniture. Nothing
 * is generated server-side for it: the page on screen is already the document,
 * and a second renderer would be a second thing that can disagree with it.
 *
 * A spreadsheet — what an accountant asks for. CSV rather than .xlsx: Excel,
 * Sheets and every accounting package open it, it survives a bad connection
 * because it streams, and it needs no library in here to write. A .xlsx would
 * be a zip of XML this app has no business generating.
 *
 * The whole database — what you take to another system, or keep off the phone
 * in case the phone goes swimming.
 *
 * The exports are deliberately not filtered by the period. A period is a way of
 * reading; an export is the record, and an accountant handed "sales, but only
 * the ones from a fortnight the owner happened to be looking at" has been given
 * something worse than nothing. The screen says so rather than leaving it to be
 * discovered.
 */
export function ExportBar({ range }: { range: DateRange }) {
  return (
    <>
      <div className="no-print mb-3 flex flex-wrap items-center gap-2">
        <ExportButtons csv="sales" label={`the report for ${describeRange(range)}`} />
        <span className="text-[13px] text-muted">
          PDF takes the report as it stands — {describeRange(range)}. Excel takes every sale on
          record, which is what an accountant needs.
        </span>
      </div>

      <div className="lg:max-w-2xl">
        <details className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-ink/5">
          <summary className="cursor-pointer text-sm font-bold text-brand-dark">
            Spreadsheets and backup ▾
          </summary>

          <p className="mt-2 text-xs text-muted">
            These are the whole record, not the period above — an accountant needs every row, not
            the fortnight that happened to be on screen.
          </p>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {EXPORT_TABLES.map((t) => (
              <Link
                key={t}
                href={`/export?table=${t}`}
                prefetch={false}
                className="inline-flex min-h-11 items-center rounded-full px-3.5 text-sm font-semibold capitalize ring-1 ring-inset ring-line hover:bg-wash xl:min-h-9"
              >
                {t.replace("_", " ")}
              </Link>
            ))}
          </div>

          <div className="mt-3 border-t border-line pt-3">
            <Link
              href="/backup"
              prefetch={false}
              className="inline-flex min-h-11 items-center rounded-full bg-brand px-5 text-sm font-bold text-white shadow-sm hover:bg-brand-dark xl:min-h-10"
            >
              Download full backup
            </Link>
            <p className="mt-2 text-xs text-muted">
              One file holding everything. Keep a copy off this phone at least once a week.
            </p>
          </div>
        </details>
      </div>
    </>
  );
}
