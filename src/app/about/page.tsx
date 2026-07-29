import type { Metadata } from "next";
import {
  coreValues,
  governance,
  identity,
  site,
  team,
} from "@/lib/keysa";
import { PageHero } from "@/components/page-hero";
import { TeamCard } from "@/components/team-card";
import { Button, SectionHeading } from "@/components/ui";
import { Reveal } from "@/components/reveal";
import { ProgramIcon } from "@/components/program-icon";
import {
  ArrowRightIcon,
  CheckIcon,
  EyeIcon,
  HeartIcon,
  TargetIcon,
} from "@/components/icons";

export const metadata: Metadata = {
  title: "About Us",
  description:
    "The story, vision, values, leadership and governance of the Kenya Youth Support Association (KEYSA) — a registered non-profit empowering youth across Bungoma, Kakamega, Busia and Nairobi counties since 2020.",
};

export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="About KEYSA"
        title="Rooted in the community, built for its youth"
        lede="The Kenya Youth Support Association was founded in 2020 in Matungu, Kakamega County, by people deeply rooted in the local community. Today we serve young people across Bungoma, Kakamega and Busia counties and in Nairobi — with one conviction: youth are the primary drivers of any nation's development."
      />

      {/* Story */}
      <section className="py-16 sm:py-20">
        <div className="container-page grid gap-12 lg:grid-cols-[1.1fr_0.9fr]">
          <Reveal>
            <div className="space-y-5 text-base leading-relaxed text-mist-400">
              <SectionHeading eyebrow="Our story" title="From a shared conviction to a registered movement" />
              <p className="!mt-6">
                KEYSA began as a group of neighbours, educators and development
                professionals in Kakamega County who refused to watch talent go to
                waste. The COVID-19 pandemic made the stakes brutally clear: school
                closures pushed girls into early motherhood and boys into odd jobs,
                and traffickers began preying on the most vulnerable.
              </p>
              <p>
                So we organised. In 2023 the association was formally registered, a
                board elected, and the work put on a proper governance footing —
                bank account, board resolutions, signatories and all. Today KEYSA
                designs and runs programs across five thematic areas: education,
                sports and talents, technology, financial literacy, and community
                development with climate action.
              </p>
              <p>
                We work where we live. That means our beneficiaries are not
                statistics — they are our neighbours’ children, our former
                classmates, the young people we meet at the market and on the
                pitch. It’s why inclusivity is non-negotiable and why every program
                is built with local leaders, schools and families at the table.
              </p>
            </div>
          </Reveal>

          <div className="space-y-5">
            <Reveal delay={80}>
              <div className="win p-7">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-green-400/10 text-green-400">
                  <EyeIcon className="h-5.5 w-5.5" />
                </span>
                <h3 className="mt-4 font-display text-lg font-bold text-mist-100">Our vision</h3>
                <p className="mt-2 text-sm leading-relaxed text-mist-400">{identity.vision}</p>
              </div>
            </Reveal>
            <Reveal delay={160}>
              <div className="win p-7">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent-400/10 text-accent-400">
                  <TargetIcon className="h-5.5 w-5.5" />
                </span>
                <h3 className="mt-4 font-display text-lg font-bold text-mist-100">Our mission</h3>
                <p className="mt-2 text-sm leading-relaxed text-mist-400">{identity.mission}</p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Objectives */}
      <section className="border-t border-ink-600 py-16 sm:py-20">
        <div className="container-page">
          <Reveal>
            <SectionHeading
              eyebrow="Our objectives"
              title="Five commitments that guide everything we run"
              lede="Every program and project is designed to advance these objectives."
            />
          </Reveal>
          <ol className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {identity.objectives.map((objective, i) => (
              <Reveal key={objective.slice(0, 40)} delay={i * 60}>
                <li className="flex h-full items-start gap-4 rounded-2xl border border-ink-600 bg-ink-800 p-6">
                  <span className="font-display text-3xl font-bold text-green-400/40">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <p className="text-sm leading-relaxed text-mist-400">{objective}</p>
                </li>
              </Reveal>
            ))}
            <Reveal delay={identity.objectives.length * 60}>
              <li className="flex h-full flex-col justify-center rounded-2xl border border-dashed border-green-400/40 bg-green-400/5 p-6">
                <p className="flex items-start gap-2.5 text-sm font-medium leading-relaxed text-mist-200">
                  <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
                  Our founding commitment: {identity.commitment}
                </p>
              </li>
            </Reveal>
          </ol>
        </div>
      </section>

      {/* Values */}
      <section className="border-y border-ink-600 bg-ink-850 py-16 sm:py-20">
        <div className="container-page">
          <Reveal>
            <SectionHeading
              eyebrow="Core values"
              title="The five commitments we measure ourselves against"
              center
            />
          </Reveal>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {coreValues.map((value, i) => (
              <Reveal key={value.name} delay={i * 60}>
                <div className="h-full rounded-2xl border border-ink-600 bg-ink-800 p-6 text-center">
                  <span className="mx-auto inline-flex h-11 w-11 items-center justify-center rounded-full bg-green-400/10 text-green-400">
                    <ProgramIcon name={value.icon} className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 font-display text-sm font-bold text-mist-100">
                    {value.name}
                  </h3>
                  <p className="mt-2 text-xs leading-relaxed text-mist-400">
                    {value.description}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Leadership */}
      <section className="py-16 sm:py-20">
        <div className="container-page">
          <Reveal>
            <SectionHeading
              eyebrow="Leadership"
              title="The people accountable for the mission"
              lede="An elected board of chairperson, treasurer and secretary — all founding members and official signatories — leads a wider team of eleven founding members."
            />
          </Reveal>
          <div className="mt-12 grid items-start gap-5 lg:grid-cols-3">
            {team.map((member, i) => (
              <Reveal key={member.name} delay={i * 90}>
                <TeamCard member={member} />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Governance & transparency */}
      <section className="border-t border-ink-600 bg-ink-850 py-16 sm:py-20">
        <div className="container-page">
          <Reveal>
            <SectionHeading
              eyebrow="Governance & transparency"
              title="Built to be trusted with your support"
              lede="Donors deserve certainty. KEYSA runs on formal governance — elected leadership, board resolutions, joint signatories and regular reporting."
            />
          </Reveal>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {governance.map((item, i) => (
              <Reveal key={item.title} delay={i * 70}>
                <div className="h-full rounded-2xl border border-ink-600 bg-ink-800 p-6">
                  <p className="font-display text-3xl font-bold text-green-400/40">
                    {String(i + 1).padStart(2, "0")}
                  </p>
                  <h3 className="mt-3 font-display text-base font-bold text-mist-100">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-mist-400">{item.detail}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal delay={200}>
            <div className="mt-12 flex flex-wrap items-center justify-between gap-6 rounded-2xl border border-green-400/30 bg-green-400/5 p-7">
              <div>
                <h3 className="font-display text-lg font-bold text-mist-100">
                  Questions about our governance?
                </h3>
                <p className="mt-1 text-sm text-mist-400">
                  Write to us at {site.email} — we’re happy to share our registration
                  and board documentation with serious donors and partners.
                </p>
              </div>
              <div className="flex gap-3">
                <Button href="/contact/">Contact us</Button>
                <Button href="/donate/" variant="donate">
                  <HeartIcon className="h-4 w-4" />
                  Donate
                </Button>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Founder's essay pointer */}
      <section className="py-16 sm:py-20">
        <div className="container-page">
          <Reveal>
            <div className="win flex flex-col items-start gap-6 p-8 sm:flex-row sm:items-center sm:justify-between">
              <div className="max-w-2xl">
                <p className="kicker">From our founder</p>
                <h3 className="mt-2 font-display text-xl font-bold text-mist-100">
                  “Real education is about unlocking the potential that lies inside
                  every person.”
                </h3>
                <p className="mt-2 text-sm text-mist-400">
                  Read Edmond Juma’s essay on legacy, learning and the generation
                  preparing to take over.
                </p>
              </div>
              <Button href="/news/crafting-a-legacy/" variant="ghost">
                Read the essay
                <ArrowRightIcon className="h-4 w-4" />
              </Button>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
