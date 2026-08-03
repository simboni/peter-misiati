/**
 * Action completion rate.
 *
 * The ONLY alert metric on any screen in this system. Never "we sent you 412
 * alerts this month" — that is a vanity number, and a rising one is a warning
 * sign rather than a success. What matters is the share of raised jobs that
 * were actually done, and the share of cleared ones somebody marked wrong.
 */
import { Card } from "@/components/ui";
import type { CompletionRate } from "@/server/alerts";

export function CompletionRateCard({ r }: { r: CompletionRate }) {
  const pct = Math.round(r.completionRatePct);
  const tone = pct >= 80 ? "bg-ok" : pct >= 50 ? "bg-brass" : "bg-danger";

  return (
    <Card>
      <h2 className="text-lg font-semibold">Jobs done</h2>
      <p className="mt-1 text-sm text-ink-2">{r.headline}</p>

      <div className="mt-4">
        <div
          className="h-3 w-full overflow-hidden rounded-full bg-paper"
          role="img"
          aria-label={`${pct} per cent of jobs done`}
        >
          <div className={`h-full ${tone}`} style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        <p className="mt-2 text-sm text-ink-2">
          {r.done} of {r.raised} done · {r.stillOpen} still open
          {r.wrong > 0 ? ` · ${r.wrong} marked wrong` : ""}
        </p>
      </div>

      {r.byKind.length > 0 ? (
        <details className="mt-4 rounded-md border border-line">
          <summary className="cursor-pointer px-3 py-3 text-sm font-medium">
            Which kinds of job get done
          </summary>
          <ul className="space-y-2 border-t border-line p-3 text-sm">
            {r.byKind.map((k) => (
              <li key={k.kind} className="flex justify-between gap-3">
                <span className="text-ink-2">{k.kind.replace(/_/g, " ").toLowerCase()}</span>
                <span className="tabular-nums">
                  {k.done}/{k.raised}
                  {k.wrong > 0 ? ` · ${k.wrong} wrong` : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}
