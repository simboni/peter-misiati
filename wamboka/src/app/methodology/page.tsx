import type { Metadata } from "next";
import { methodology } from "@/lib/data";
import { SectionHead, StatusBadge } from "@/components/ui";

export const metadata: Metadata = {
  title: "Methodology & Sources",
  description:
    "How this record is compiled: the sourcing rules, the three verification statuses, and the official registers every figure is traced to.",
};

export default function MethodologyPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-16">
      <SectionHead kicker="Methodology" title="How this record is built" lede={methodology.intro} />

      <div className="mt-10 grid gap-5 sm:grid-cols-2">
        {methodology.rules.map((r) => (
          <div key={r.title} className="rounded-lg border border-paper-600 bg-paper-800 p-6">
            <h3 className="font-display text-lg font-semibold text-ink-100">{r.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-400">{r.body}</p>
          </div>
        ))}
      </div>

      {/* status legend */}
      <section className="mt-14">
        <h3 className="font-mono text-[11px] tracking-[0.2em] text-ink-600 uppercase">
          The three statuses
        </h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {(
            [
              ["verified", "Confirmed in official records or multiple independent reports."],
              ["reported", "Carried by credible national press; official document still to be transcribed."],
              ["pending", "Official figure not yet published or obtained — stated openly instead of invented."],
            ] as const
          ).map(([status, text]) => (
            <div key={status} className="rounded-lg border border-paper-600 bg-paper-800 p-5">
              <StatusBadge status={status} />
              <p className="mt-3 text-sm leading-relaxed text-ink-400">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* data sources */}
      <section className="mt-14">
        <h3 className="font-mono text-[11px] tracking-[0.2em] text-ink-600 uppercase">
          The registers this record is traced to
        </h3>
        <ul className="mt-4 divide-y divide-paper-600 rounded-xl border border-paper-600 bg-paper-800">
          {methodology.dataSources.map((s) => (
            <li key={s.name} className="flex flex-col gap-1 px-6 py-4 sm:flex-row sm:items-baseline sm:justify-between">
              {s.url === "#" ? (
                <span className="font-medium text-ink-200">{s.name}</span>
              ) : (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-green-600 hover:underline"
                >
                  {s.name}
                </a>
              )}
              <span className="text-sm text-ink-500 sm:max-w-md sm:text-right">{s.what}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-10 rounded-lg border border-amber-500/30 bg-amber-100/50 p-5 font-mono text-xs leading-relaxed text-amber-500">
        {methodology.disclaimer}
      </p>
    </div>
  );
}
