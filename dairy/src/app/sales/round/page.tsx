import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { today } from "@/lib/domain/dates";
import type { MilkingSession } from "@/db/schema";
import { formatDay, milkingSessionsForFarm, sessionLabel } from "@/server/milk";
import { deliveryRound, recordRoundAction } from "@/server/sales";
import { RoundSheet } from "@/components/sales/RoundSheet";
import { Chip, PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function RoundPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; session?: string }>;
}) {
  const sp = await searchParams;
  const session = await verifySession();

  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today();
  const available = await milkingSessionsForFarm(session);
  const current: MilkingSession = available.includes(sp.session as MilkingSession)
    ? (sp.session as MilkingSession)
    : "MORNING";

  const round = await deliveryRound(session, date, current);

  return (
    <main className="mx-auto max-w-3xl p-4 pb-24">
      <PageTitle sub={`${formatDay(date)} · ${session.fullName}`}>
        {sessionLabel(current)} round
      </PageTitle>

      <nav className="mb-4 flex flex-wrap items-center gap-2" aria-label="Round session">
        {available.map((sName) => (
          <Link
            key={sName}
            href={`/sales/round?date=${date}&session=${sName}`}
            className={`tap inline-flex items-center rounded-md border px-4 py-2 text-base font-semibold ${
              sName === current ? "border-brand bg-brand text-white" : "border-line bg-surface text-ink"
            }`}
          >
            {sessionLabel(sName)}
          </Link>
        ))}
        <span className="ml-auto flex items-center gap-2">
          {round.overLimit.length > 0 ? (
            <Chip tone="danger">{round.overLimit.length} over their limit</Chip>
          ) : null}
          <Link href="/sales" className="tap inline-flex items-center text-sm underline">
            Today&apos;s milk
          </Link>
        </span>
      </nav>

      <RoundSheet round={round} action={recordRoundAction} />
    </main>
  );
}
