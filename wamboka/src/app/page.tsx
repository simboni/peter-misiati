import Link from "next/link";
import {
  constituency,
  heroStats,
  integrityFile,
  moneyTrail,
  oversightCases,
  profile,
  timeline,
} from "@/lib/data";
import { SectionHead, SourceChips, StatusBadge } from "@/components/ui";

const kindLabel: Record<string, string> = {
  election: "Election",
  oversight: "Oversight",
  constituency: "Bumula",
  integrity: "Integrity",
  money: "Money",
};

export default function HomePage() {
  return (
    <>
      {/* ------------------------------------------------------------ hero */}
      <section className="border-b border-paper-600 bg-paper-850">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 lg:grid-cols-[1.2fr_1fr] lg:py-24">
          <div>
            <p className="font-mono text-xs font-medium tracking-[0.25em] text-green-600 uppercase">
              {profile.role} · {profile.county}
            </p>
            <h1 className="mt-4 font-display text-4xl leading-tight font-bold text-ink-100 sm:text-5xl lg:text-6xl">
              {profile.name}
            </h1>
            <p className="mt-3 font-display text-xl text-green-600 italic sm:text-2xl">
              {profile.tagline}
            </p>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-ink-400">
              {profile.positioning}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/record/"
                className="rounded-md bg-green-400 px-5 py-2.5 text-sm font-medium text-on-accent transition hover:bg-green-500"
              >
                Read the record
              </Link>
              <Link
                href="/money/"
                className="rounded-md border border-paper-500 px-5 py-2.5 text-sm font-medium text-ink-300 transition hover:border-green-400 hover:text-green-600"
              >
                Follow the money
              </Link>
              <Link
                href="/integrity/"
                className="rounded-md border border-paper-500 px-5 py-2.5 text-sm font-medium text-ink-300 transition hover:border-flag-500 hover:text-flag-500"
              >
                The hard parts →
              </Link>
            </div>
            <dl className="mt-10 grid max-w-xl grid-cols-2 gap-x-8 gap-y-3 border-t border-paper-600 pt-6 font-mono text-xs text-ink-500 sm:grid-cols-3">
              <div>
                <dt className="text-ink-600 uppercase">Party</dt>
                <dd className="mt-0.5 text-ink-300">DAP-K · Azimio</dd>
              </div>
              <div>
                <dt className="text-ink-600 uppercase">First elected</dt>
                <dd className="mt-0.5 text-ink-300">{profile.firstElected}</dd>
              </div>
              <div>
                <dt className="text-ink-600 uppercase">Term</dt>
                <dd className="mt-0.5 text-ink-300">{profile.term}</dd>
              </div>
            </dl>
          </div>

          {/* headline stats — the ledger card */}
          <div className="self-start rounded-xl border border-paper-600 bg-paper-800 p-6 shadow-sm">
            <p className="font-mono text-[11px] tracking-[0.2em] text-ink-600 uppercase">
              The record, in numbers
            </p>
            <ul className="mt-4 divide-y divide-paper-600">
              {heroStats.map((s) => (
                <li key={s.figure} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="font-mono text-2xl font-medium text-green-600">
                      {s.figure}
                    </span>
                    <StatusBadge status={s.status} />
                  </div>
                  <p className="mt-1 text-sm text-ink-400">{s.label}</p>
                  <div className="mt-2">
                    <SourceChips sources={s.sources} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------- why this site */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <div className="grid gap-8 lg:grid-cols-3">
          {[
            {
              title: "Every claim is sourced",
              body: "Each fact links to Parliament records, the NG-CDF Board, the Auditor-General, or national press. Check it yourself — that is what the chips are for.",
            },
            {
              title: "Every figure is statused",
              body: "Verified, reported, or pending — clearly labelled. Where an official number is not yet published, this site says 'pending' instead of inventing one.",
            },
            {
              title: "The bad news is here too",
              body: "The Integrity File publishes the 2026 committee findings in full — what was dismissed and what was upheld. An open file is the whole point.",
            },
          ].map((c) => (
            <div key={c.title} className="rounded-lg border border-paper-600 bg-paper-800 p-6">
              <h3 className="font-display text-lg font-semibold text-ink-100">{c.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-400">{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ----------------------------------------------------- three fronts */}
      <section className="mx-auto max-w-6xl px-5 py-8">
        <SectionHead
          kicker="The case for re-election"
          title="One MP, three fronts"
          lede="Oversight in Nairobi. Delivery in Bumula. Money in the open. Each front has its own page, its own evidence, and its own gaps stated plainly."
        />
        <div className="mt-10 grid gap-6 lg:grid-cols-3">
          <FrontCard
            href="/record/"
            kicker="Front one — Oversight"
            title="Took on a sitting Cabinet Secretary, and the auditors' backlog"
            body={`${oversightCases.length} documented cases: the Linturi impeachment, the universities probe, the NG-CDF disbursement fight.`}
            cta="The Record →"
          />
          <FrontCard
            href="/bumula/"
            kicker="Front two — Bumula"
            title="Education first: bursaries, scholarships, a top-3 county ranking"
            body={`${constituency.delivery.length} sourced delivery entries — and the project line-items to come, published as official schedules are transcribed.`}
            cta="Bumula delivery →"
          />
          <FrontCard
            href="/money/"
            kicker="Front three — Money"
            title="KSh 197M a year deserves a public ledger"
            body={`Allocations per financial year, spending priorities, and a standing pledge: ${moneyTrail.openBooksPledge.length} open-books commitments.`}
            cta="Money Trail →"
          />
        </div>
      </section>

      {/* --------------------------------------------------------- timeline */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <SectionHead
          kicker="2022 → 2027"
          title="The term, event by event"
          lede="A single chronology of the mandate — elections, oversight battles, money fights and adverse findings on one line, in order."
        />
        <ol className="mt-10 space-y-0 border-l-2 border-paper-600 pl-6">
          {timeline.map((e, i) => (
            <li key={i} className="relative pb-8 last:pb-0">
              <span
                className={`absolute top-1 -left-[31px] size-3 rounded-full ring-4 ring-paper-900 ${
                  e.kind === "integrity" ? "bg-flag-500" : "bg-green-400"
                }`}
                aria-hidden
              />
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-medium text-ink-300">{e.date}</span>
                <span className="rounded bg-paper-700 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-ink-500 uppercase">
                  {kindLabel[e.kind]}
                </span>
                <StatusBadge status={e.status} />
              </div>
              <p className="mt-1.5 font-medium text-ink-200">{e.claim}</p>
              {e.detail ? (
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-400">{e.detail}</p>
              ) : null}
              <div className="mt-2">
                <SourceChips sources={e.sources} />
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ------------------------------------------------ integrity teaser */}
      <section className="mx-auto max-w-6xl px-5 pb-16">
        <div className="rounded-xl border border-flag-500/30 bg-paper-800 p-8">
          <p className="font-mono text-xs font-medium tracking-[0.2em] text-flag-500 uppercase">
            No curated files
          </p>
          <h2 className="mt-3 font-display text-2xl font-semibold text-ink-100">
            Read the Integrity File — allegations, findings, and outcomes, unedited
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-400">
            {integrityFile.intro}
          </p>
          <Link
            href="/integrity/"
            className="mt-5 inline-block rounded-md border border-flag-500/50 px-5 py-2.5 text-sm font-medium text-flag-500 transition hover:bg-flag-500 hover:text-on-accent"
          >
            Open the file
          </Link>
        </div>
      </section>
    </>
  );
}

function FrontCard({
  href,
  kicker,
  title,
  body,
  cta,
}: {
  href: string;
  kicker: string;
  title: string;
  body: string;
  cta: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-lg border border-paper-600 bg-paper-800 p-6 transition hover:border-green-400"
    >
      <p className="font-mono text-[11px] tracking-[0.2em] text-green-600 uppercase">{kicker}</p>
      <h3 className="mt-3 font-display text-xl leading-snug font-semibold text-ink-100">
        {title}
      </h3>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-400">{body}</p>
      <span className="mt-4 text-sm font-medium text-green-600 group-hover:underline">{cta}</span>
    </Link>
  );
}
