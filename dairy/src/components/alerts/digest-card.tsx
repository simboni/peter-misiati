/**
 * The daily digest, shown as the SMS it will be sent as.
 *
 * Rendered in a monospaced block on purpose: the owner should see exactly the
 * message that arrives on the phone, not a prettier version of it. The Sky
 * Dairy pattern earns trust by being the same four facts every single day, and
 * a screen that dresses it up breaks that.
 */
import { Card, Chip } from "@/components/ui";
import { kes } from "@/lib/money";
import type { DailyDigest } from "@/server/alerts";

export function DigestCard({ d }: { d: DailyDigest }) {
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Today&rsquo;s message</h2>
        <Chip tone={d.segments > 1 ? "warn" : "neutral"}>
          {d.charactersUsed} characters · {d.segments} SMS
        </Chip>
      </div>

      <p className="mt-3 rounded-md border border-line bg-paper p-3 font-mono text-sm leading-relaxed">
        {d.sms}
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-ink-3">Milked</dt>
          <dd className="text-lg font-semibold tabular-nums">{d.totalL} L</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-3">Delivered</dt>
          <dd className="text-lg font-semibold tabular-nums">{d.deliveredL} L</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-3">Value today</dt>
          <dd className="text-lg font-semibold tabular-nums">{kes(d.valueKes)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-3">Month to date</dt>
          <dd className="text-lg font-semibold tabular-nums">{kes(d.monthToDateKes)}</dd>
        </div>
      </dl>

      {d.urgent.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {d.urgent.map((u, i) => (
            <li
              key={i}
              className="rounded-md border-l-4 border-danger bg-danger-soft px-3 py-2 text-sm font-medium"
            >
              <span aria-hidden className="mr-2">⛔</span>
              {u}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
