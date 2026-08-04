import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { today } from "@/lib/domain/dates";
import type { MilkingSession } from "@/db/schema";
import {
  formatDay,
  milkSheet,
  milkingSessionsForFarm,
  saveMilkSheetAction,
  sessionLabel,
} from "@/server/milk";
import { MilkSheetForm } from "@/components/milk/MilkSheetForm";
import { BackLink, Chip, PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * The screen that runs twice a day, every day, forever. One level down from
 * home, and nothing below it is required to finish a milking.
 */
export default async function MilkPage({
  searchParams,
}: {
  // Next 16: searchParams is always a promise.
  searchParams: Promise<{ date?: string; session?: string }>;
}) {
  const sp = await searchParams;
  const session = await verifySession();

  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today();
  const available = await milkingSessionsForFarm(session);
  const current: MilkingSession = available.includes(sp.session as MilkingSession)
    ? (sp.session as MilkingSession)
    : defaultSession(available);

  const sheet = await milkSheet(session, date, current);

  return (
    <main className="mx-auto max-w-3xl p-4 pb-24">
      <BackLink to="/" />
      <PageTitle sub={`${formatDay(date)} · ${session.fullName}`}>
        {sessionLabel(current)} milking
      </PageTitle>

      <nav className="mb-4 flex flex-wrap items-center gap-2" aria-label="Milking session">
        {available.map((sName) => (
          <Link
            key={sName}
            href={`/milk?date=${date}&session=${sName}`}
            className={`tap inline-flex items-center rounded-md border px-4 py-2 text-base font-semibold ${
              sName === current ? "border-brand bg-brand text-white" : "border-line bg-surface text-ink"
            }`}
          >
            {sessionLabel(sName)}
          </Link>
        ))}
        <span className="ml-auto flex items-center gap-2">
          {sheet.lockedCount > 0 ? (
            <Chip tone="danger">{sheet.lockedCount} not for sale</Chip>
          ) : null}
          <Link href="/milk/flagged" className="tap inline-flex items-center text-sm underline">
            Review queue
          </Link>
        </span>
      </nav>

      <MilkSheetForm sheet={sheet} action={saveMilkSheetAction} />
    </main>
  );
}

/** Before midday the herdsman means the morning; after it, the evening. */
function defaultSession(available: MilkingSession[]): MilkingSession {
  const hour = new Date().getHours();
  if (hour < 11) return "MORNING";
  if (hour < 16 && available.includes("NOON")) return "NOON";
  return available.includes("EVENING") ? "EVENING" : "MORNING";
}
