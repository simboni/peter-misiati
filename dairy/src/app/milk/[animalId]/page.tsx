import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { today } from "@/lib/domain/dates";
import { formatDay, lactationCurve } from "@/server/milk";
import { LactationCurveChart } from "@/components/milk/LactationCurveChart";
import { Card, Chip, PageTitle } from "@/components/ui";
import { litres } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function LactationPage({
  params,
}: {
  // Next 16: params is always a promise.
  params: Promise<{ animalId: string }>;
}) {
  const { animalId } = await params;
  const session = await verifySession();
  const curve = await lactationCurve(session, animalId, today());

  const stats: Array<{ label: string; value: string; hint?: string }> = [
    { label: "Days in milk", value: curve.daysInMilk === null ? "—" : String(curve.daysInMilk),
      hint: curve.lastCalvingOn ? `calved ${formatDay(curve.lastCalvingOn)}` : "no calving recorded" },
    { label: "Peak", value: litres(curve.peakDailyL), hint: curve.daysToPeak === null ? undefined : `on day ${curve.daysToPeak}` },
    { label: "This lactation", value: litres(curve.cumulativeL), hint: `${litres(curve.averageDailyL)} a day` },
    { label: "Projected 305-day", value: litres(curve.projected305L), hint: "from her peak" },
    { label: "Persistency", value: `${curve.persistencyPct}%`, hint: "of peak held per month" },
  ];

  return (
    <main className="mx-auto max-w-3xl p-4 pb-16">
      <PageTitle sub={`Tag ${curve.tag}`}>{curve.name}</PageTitle>

      <p className="mb-4">
        <Link href="/milk" className="text-sm underline">
          Back to today&apos;s sheet
        </Link>
      </p>

      <Card className="mb-4">
        <LactationCurveChart curve={curve} />
      </Card>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label}>
            <dt className="text-sm text-ink-2">{s.label}</dt>
            <dd className="text-xl font-semibold tabular-nums">{s.value}</dd>
            {s.hint ? <dd className="text-xs text-ink-3">{s.hint}</dd> : null}
          </Card>
        ))}
      </dl>

      {curve.persistencyPct < 88 && curve.daysInMilk !== null && curve.daysInMilk > 90 ? (
        <p className="mt-4">
          <Chip tone="warn">Below 88% — check her feed and her health before blaming the cow</Chip>
        </p>
      ) : null}

      {curve.days.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-2 text-lg font-semibold">Every day recorded</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm print-sheet">
              <thead>
                <tr className="border-b border-line text-left text-ink-2">
                  <th className="py-2">Date</th>
                  <th>Day</th>
                  <th className="text-right">Litres</th>
                </tr>
              </thead>
              <tbody>
                {[...curve.days].reverse().map((d) => (
                  <tr key={d.date} className="border-b border-line/60">
                    <td className="py-2">{formatDay(d.date)}</td>
                    <td className="tabular-nums text-ink-2">{d.dim ?? "—"}</td>
                    <td className="text-right tabular-nums">{d.litres.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  );
}
