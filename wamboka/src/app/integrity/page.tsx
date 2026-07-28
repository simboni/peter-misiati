import type { Metadata } from "next";
import { integrityFile } from "@/lib/data";
import { FactRow, SectionHead } from "@/components/ui";

export const metadata: Metadata = {
  title: "The Integrity File",
  description:
    "The complete, sourced chronology of the 2026 allegations against Hon. Jack Wanami Wamboka — the suspension, what was dismissed, and what was upheld. Unedited.",
};

export default function IntegrityPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-16">
      <SectionHead kicker="The Integrity File" title="The hard parts, in the open" lede={integrityFile.intro} />

      <ul className="mt-12 space-y-4">
        {integrityFile.events.map((e, i) => (
          <FactRow key={i} {...e} />
        ))}
      </ul>

      <div className="mt-12 rounded-xl border-l-4 border-green-400 bg-paper-850 p-8">
        <p className="font-mono text-[11px] tracking-[0.2em] text-ink-600 uppercase">
          The standard this site holds
        </p>
        <p className="mt-3 max-w-3xl font-display text-lg leading-relaxed text-ink-200 italic">
          &ldquo;{integrityFile.statement}&rdquo;
        </p>
      </div>
    </div>
  );
}
