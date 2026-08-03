import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { today, isISODate, type ISODate } from "@/lib/domain/dates";
import { dailySheet } from "@/server/reports";
import { PrintDailySheet } from "@/components/reports/print-sheet";
import { PrintButton } from "@/components/reports/print-button";
import { ExportLink } from "@/components/reports/export-links";

export const dynamic = "force-dynamic";

/**
 * The printable daily sheet.
 *
 * Everything except the sheet itself carries `.no-print`, so what comes out of
 * the printer is one clean page that looks like the notebook page it replaces.
 * There is no PDF library here on purpose — Chrome on Android prints to PDF
 * natively, offline, and for free.
 */
export default async function PrintDailyPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const session = await verifySession();
  const { date } = await searchParams; // Next 16: searchParams is always a Promise.
  const on: ISODate = date && isISODate(date) ? date : today();
  const sheet = await dailySheet(session, on);

  return (
    <main className="mx-auto max-w-3xl p-4">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href="/reports" className="text-sm text-ink-2">
          <span aria-hidden>←</span> Reports
        </Link>
        <div className="flex flex-wrap gap-3">
          <ExportLink name="daily-sheet" label="CSV" query={`?asOf=${on}`} />
          <PrintButton />
        </div>
      </div>

      <form className="no-print mb-4 flex items-end gap-3" method="get">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Which day</span>
          <input
            type="date"
            name="date"
            defaultValue={on}
            className="rounded-md border border-line bg-surface px-3 py-2 text-base"
          />
        </label>
        <button
          type="submit"
          className="rounded-md border border-line bg-surface px-5 py-3 text-base font-semibold"
        >
          Show
        </button>
      </form>

      <PrintDailySheet sheet={sheet} />

      <p className="no-print mt-4 text-sm text-ink-3">
        Keep the printed sheet in the shed and tick it as you milk. The paper log and the phone are
        meant to sit side by side — that is how M-Pesa earned its trust, and it is how a milk record
        stays checkable.
      </p>
    </main>
  );
}
