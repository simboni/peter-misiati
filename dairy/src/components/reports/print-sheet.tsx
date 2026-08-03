/**
 * The printable daily milk sheet.
 *
 * Laid out exactly like the farm's existing notebook: cow names down the left,
 * one column per milking across the top, a total row at the foot, and blank
 * boxes where nothing was recorded so a herdsman can write in pen and reconcile
 * later.
 *
 * This is not nostalgia. M-Pesa — the most trusted money system in Kenya —
 * requires every agent to keep a paper log beside the digital record and does
 * not consider that redundant. A digital sheet that cannot be laid next to the
 * paper one is a sheet nobody trusts. `.print-sheet` and `.no-print` are in
 * globals.css for exactly this.
 */
import type { DailySheet } from "@/server/reports";

export function PrintDailySheet({ sheet }: { sheet: DailySheet }) {
  return (
    <article className="print-sheet mx-auto max-w-3xl bg-white p-4 text-ink">
      <header className="mb-3 border-b-2 border-ink pb-2">
        <div className="flex items-baseline justify-between">
          <h1 className="text-xl font-bold">{sheet.farmName}</h1>
          <p className="text-lg font-semibold">{sheet.dayLabel}</p>
        </div>
        <p className="text-sm">Milk record · {sheet.date}</p>
      </header>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th scope="col" className="border border-ink px-2 py-1 text-left w-[45%]">
              Cow
            </th>
            {sheet.sessions.map((x) => (
              <th key={x.session} scope="col" className="border border-ink px-2 py-1 text-right">
                {x.label}
              </th>
            ))}
            <th scope="col" className="border border-ink px-2 py-1 text-right">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {sheet.cows.map((c) => (
            <tr key={c.animalId}>
              <th scope="row" className="border border-ink px-2 py-1 text-left font-normal">
                {c.name}
                <span className="ml-2 text-xs text-ink-3">{c.tag}</span>
                {c.locked ? (
                  <span className="ml-2 text-xs font-bold">⛔ do not sell</span>
                ) : null}
              </th>
              {c.bySession.map((b) => (
                <td key={b.session} className="border border-ink px-2 py-1 text-right tabular-nums">
                  {/* A blank box, not a zero — a zero is a claim nobody made. */}
                  {b.litres === null ? "" : b.litres.toFixed(1)}
                </td>
              ))}
              <td className="border border-ink px-2 py-1 text-right font-semibold tabular-nums">
                {c.totalL > 0 ? c.totalL.toFixed(1) : ""}
              </td>
            </tr>
          ))}
          <tr>
            <th scope="row" className="border border-ink px-2 py-1 text-left font-bold">
              TOTAL
            </th>
            {sheet.totalsBySession.map((t) => (
              <td
                key={t.session}
                className="border border-ink px-2 py-1 text-right font-bold tabular-nums"
              >
                {t.litres.toFixed(1)}
              </td>
            ))}
            <td className="border border-ink px-2 py-1 text-right font-bold tabular-nums">
              {sheet.totalL.toFixed(1)}
            </td>
          </tr>
        </tbody>
      </table>

      {sheet.disposals.length > 0 ? (
        <section className="mt-4">
          <h2 className="mb-1 text-sm font-bold uppercase tracking-wide">Where it went</h2>
          <table className="w-full border-collapse text-sm">
            <tbody>
              {sheet.disposals.map((d) => (
                <tr key={d.label}>
                  <th scope="row" className="border border-ink px-2 py-1 text-left font-normal">
                    {d.label}
                  </th>
                  <td className="border border-ink px-2 py-1 text-right tabular-nums w-24">
                    {d.litres.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <p className="mt-4 border border-ink px-2 py-2 text-sm font-semibold">{sheet.note}</p>

      <footer className="mt-6 grid grid-cols-2 gap-6 text-sm">
        <div>
          <p className="border-b border-ink pb-6">&nbsp;</p>
          <p className="mt-1">Milked by</p>
        </div>
        <div>
          <p className="border-b border-ink pb-6">&nbsp;</p>
          <p className="mt-1">Checked by</p>
        </div>
      </footer>
    </article>
  );
}
