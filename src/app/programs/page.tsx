import type { Metadata } from "next";
import Link from "next/link";
import { programs } from "@/lib/keysa";
import { PageHero } from "@/components/page-hero";
import { Button } from "@/components/ui";
import { Reveal } from "@/components/reveal";
import { ProgramIcon } from "@/components/program-icon";
import { ArrowRightIcon, CheckIcon, HeartIcon } from "@/components/icons";

export const metadata: Metadata = {
  title: "Our Programs",
  description:
    "KEYSA's five thematic areas: Education & TVET scholarships, Sports & Talents, Technology & digital skills, Financial Literacy, and Community Development with Climate Action.",
};

export default function ProgramsPage() {
  return (
    <>
      <PageHero
        eyebrow="Programs"
        title="Five fronts in the fight for youth potential"
        lede="Each thematic area targets a specific barrier — school fees, missing platforms, digital exclusion, financial illiteracy, or a community's fraying resilience. Together they form one pathway from vulnerability to leadership."
      />

      <section className="py-16 sm:py-20">
        <div className="container-page space-y-8">
          {programs.map((program, i) => (
            <Reveal key={program.slug}>
              <article
                id={program.slug}
                className={`grid gap-8 rounded-2xl border border-ink-600 bg-ink-800 p-8 sm:p-10 lg:grid-cols-[1.1fr_0.9fr] ${
                  i % 2 === 1 ? "lg:[&>*:first-child]:order-2" : ""
                }`}
              >
                <div>
                  <span className="inline-flex h-13 w-13 items-center justify-center rounded-xl bg-green-400/10 p-3 text-green-400">
                    <ProgramIcon name={program.icon} className="h-7 w-7" />
                  </span>
                  <p className="mt-5 text-xs font-semibold uppercase tracking-wider text-mist-500">
                    {program.tagline}
                  </p>
                  <h2 className="mt-2 font-display text-2xl font-bold tracking-tight text-mist-100 sm:text-3xl">
                    {program.name}
                  </h2>
                  <p className="mt-4 text-base leading-relaxed text-mist-400">
                    {program.summary}
                  </p>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <Button href={`/programs/${program.slug}/`}>
                      Full program details
                      <ArrowRightIcon className="h-4 w-4" />
                    </Button>
                    <Button href="/donate/" variant="ghost">
                      Fund this work
                    </Button>
                  </div>
                </div>
                <div className="rounded-xl border border-ink-600 bg-ink-850 p-6">
                  <h3 className="kicker">What this looks like on the ground</h3>
                  <ul className="mt-4 space-y-3">
                    {program.activities.slice(0, 4).map((activity) => (
                      <li
                        key={activity}
                        className="flex items-start gap-2.5 text-sm leading-relaxed text-mist-400"
                      >
                        <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
                        {activity}
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-ink-600 bg-ink-850 py-16">
        <div className="container-page text-center">
          <Reveal>
            <h2 className="mx-auto max-w-2xl font-display text-2xl font-bold text-mist-100 sm:text-3xl text-balance">
              Programs run on partnership. Pick the one that speaks to you.
            </h2>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Button href="/donate/" variant="donate">
                <HeartIcon className="h-4 w-4" />
                Donate to a program
              </Button>
              <Link
                href="/projects/"
                className="inline-flex items-center gap-2 rounded-full border border-ink-500 px-6 py-3 text-sm font-semibold text-mist-200 transition-colors hover:border-green-400"
              >
                See active projects
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
