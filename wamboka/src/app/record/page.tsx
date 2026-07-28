import type { Metadata } from "next";
import { oversightCases } from "@/lib/data";
import { FactRow, SectionHead } from "@/components/ui";

export const metadata: Metadata = {
  title: "The Record — Oversight & Legislation",
  description:
    "Documented oversight casework of Hon. Jack Wanami Wamboka, MP for Bumula: the Linturi impeachment, the universities audit probe, and the NG-CDF disbursement fight — every claim sourced.",
};

const toneStyles = {
  win: "border-green-400/40 bg-green-400/5 text-green-600",
  mixed: "border-amber-500/40 bg-amber-100/60 text-amber-500",
  open: "border-paper-500 bg-paper-700 text-ink-400",
} as const;

const toneLabel = { win: "Outcome — delivered", mixed: "Outcome — contested", open: "Ongoing" } as const;

export default function RecordPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-16">
      <SectionHead
        kicker="The Record"
        title="Oversight casework, documented"
        lede="Not adjectives — cases. Each one states what was done, what it cost, how the votes fell, and how it ended. Sources on every line; verdicts included even where they went the other way."
      />

      <div className="mt-12 space-y-12">
        {oversightCases.map((c) => (
          <article
            key={c.slug}
            id={c.slug}
            className="rounded-xl border border-paper-600 bg-paper-850 p-6 sm:p-8"
          >
            <p className="font-mono text-[11px] tracking-[0.2em] text-green-600 uppercase">
              {c.kicker}
            </p>
            <h3 className="mt-2 font-display text-2xl font-semibold text-ink-100 sm:text-3xl">
              {c.title}
            </h3>
            <p className="mt-4 max-w-3xl leading-relaxed text-ink-400">{c.summary}</p>

            <div className={`mt-6 rounded-lg border p-4 ${toneStyles[c.outcomeTone]}`}>
              <p className="font-mono text-[10px] font-medium tracking-[0.2em] uppercase">
                {toneLabel[c.outcomeTone]}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-300">{c.outcome}</p>
            </div>

            <h4 className="mt-8 font-mono text-[11px] tracking-[0.2em] text-ink-600 uppercase">
              The evidence line
            </h4>
            <ul className="mt-3 space-y-3">
              {c.facts.map((f, i) => (
                <FactRow key={i} {...f} />
              ))}
            </ul>
          </article>
        ))}
      </div>
    </div>
  );
}
