import type { Metadata } from "next";
import { PageHero } from "@/components/page-hero";
import { Button, Section, SectionHeading, Eyebrow, Rubric } from "@/components/ui";
import { Reveal } from "@/components/reveal";
import { MinistryIcon, CheckIcon } from "@/components/icons";
import { identity, founder, ministries, locations, stats } from "@/lib/site";

export const metadata: Metadata = {
  title: "About Us",
  description:
    "The Canossian Daughters of Charity — founded by St Magdalene of Canossa in 1808 — serve the poor across Tanzania, Kenya, Uganda and Sudan.",
};

export default function AboutPage() {
  return (
    <>
      <PageHero
        crumb="About"
        eyebrow="Who we are"
        title="Women of the Word, servants of the poor"
        intro="Rooted in the charism of St Magdalene of Canossa, we bring the love of the Crucified Christ to the little ones, the sick and the poor across North & East Africa."
      />

      {/* Story + portrait */}
      <Section className="bg-cream-50">
        <div className="grid gap-12 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-7">
            <Reveal>
              <Eyebrow>Our story</Eyebrow>
              <h2 className="mt-4 font-display text-3xl font-semibold leading-tight text-ink-900 sm:text-4xl">
                Canossian Daughters of Charity, Servants of the Poor
              </h2>
              <div className="mt-5 space-y-4 text-lg leading-relaxed text-ink-600">
                <p>{identity.charism}</p>
                <p>
                  Present in the {" "}
                  <strong className="text-ink-800">North East Africa Province</strong> — Tanzania,
                  Kenya, Uganda and Sudan — the Sisters live one mission of charity through five
                  ministries: education, evangelization, pastoral healthcare, formation of the
                  laity, and spiritual retreats.
                </p>
                <p className="border-l-2 border-gold-400 pl-4 font-display text-xl italic text-terra-700">
                  “{identity.motto}”
                </p>
              </div>
            </Reveal>
          </div>
          <div className="lg:col-span-5">
            <Reveal variant="left">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/daughters.jpg"
                alt="Canossian Daughters of Charity"
                className="w-full rounded-2xl border border-line object-cover shadow-sm"
              />
            </Reveal>
          </div>
        </div>
      </Section>

      {/* Vision & Mission */}
      <Section className="bg-cream-100 bg-dots">
        <div className="grid gap-6 md:grid-cols-2">
          <Reveal>
            <div className="card h-full p-8">
              <Eyebrow>Our vision</Eyebrow>
              <p className="mt-4 font-display text-2xl font-medium leading-snug text-ink-900">
                {identity.vision}
              </p>
            </div>
          </Reveal>
          <Reveal delay={80}>
            <div className="card h-full p-8">
              <Eyebrow>Our mission</Eyebrow>
              <p className="mt-4 font-display text-2xl font-medium leading-snug text-ink-900">
                {identity.mission}
              </p>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* Foundress */}
      <section className="relative overflow-hidden bg-terra-900 text-cream-100">
        <div className="absolute inset-0 glow-warm" />
        <div className="container-page relative grid gap-12 py-16 sm:py-20 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-5">
            <Reveal>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/church-2.jpg"
                alt="A place of prayer"
                className="w-full rounded-2xl border border-terra-700 object-cover"
              />
            </Reveal>
          </div>
          <div className="lg:col-span-7">
            <Reveal variant="left">
              <Eyebrow className="!text-gold-300">Our foundress · {founder.anniversary}</Eyebrow>
              <h2 className="mt-4 font-display text-3xl font-semibold text-cream-50 sm:text-4xl">
                {founder.name}
              </h2>
              <p className="mt-2 text-sm font-medium uppercase tracking-wide text-gold-300">
                {founder.years} · Founded {founder.founded}
              </p>
              <p className="mt-5 text-lg leading-relaxed text-cream-200/90">{founder.blurb}</p>
              <ul className="mt-8 space-y-4">
                {founder.quotes.map((q) => (
                  <li key={q} className="flex gap-3 font-display text-lg italic text-cream-100">
                    <span className="text-gold-300">“</span>
                    <span>{q}</span>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Ministries summary */}
      <Section className="bg-cream-50">
        <SectionHeading
          align="center"
          eyebrow="How we serve"
          title="Five ministries, one charism"
          className="mx-auto text-center"
        />
        <div className="mx-auto mt-12 grid max-w-4xl gap-4 sm:grid-cols-2">
          {ministries.map((m, i) => (
            <Reveal key={m.slug} delay={i * 50}>
              <a
                href={`/ministries/${m.slug}`}
                className="flex items-start gap-4 rounded-2xl border border-line bg-white p-5 transition-colors hover:border-terra-300"
              >
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-terra-50 text-terra-600">
                  <MinistryIcon name={m.icon} className="h-5.5 w-5.5" />
                </span>
                <div>
                  <h3 className="font-display text-lg font-semibold text-ink-900">{m.name}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-600">{m.summary}</p>
                </div>
              </a>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* Where we serve */}
      <Section className="bg-cream-100">
        <div className="grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <SectionHeading
              eyebrow="Where we serve"
              title="The North East Africa Province"
              intro="Our Province covers four countries, with the Provincial House in Dar es Salaam, Tanzania."
            />
            <div className="mt-8 grid grid-cols-2 gap-4">
              {stats.slice(0, 2).map((s) => (
                <div key={s.label} className="card p-5">
                  <div className="font-display text-3xl font-semibold text-terra-600">
                    {s.value.toLocaleString()}
                    {s.suffix}
                  </div>
                  <div className="mt-1 text-sm text-ink-600">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="lg:col-span-7">
            <div className="grid gap-4 sm:grid-cols-2">
              {locations.map((l, i) => (
                <Reveal key={l.country} delay={i * 60}>
                  <div className="flex h-full items-start gap-3 rounded-2xl border border-line bg-white p-5">
                    <CheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-sage-600" />
                    <div>
                      <div className="font-display text-lg font-semibold text-ink-900">
                        {l.country}
                      </div>
                      <div className="text-sm text-ink-600">{l.note}</div>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* CTA */}
      <Section className="bg-cream-50">
        <div className="card flex flex-col items-center gap-6 overflow-hidden bg-terra-50 px-8 py-14 text-center">
          <Rubric className="max-w-xs" />
          <h2 className="max-w-2xl font-display text-3xl font-semibold text-ink-900 sm:text-4xl">
            Walk with us in the mission of charity
          </h2>
          <p className="max-w-xl text-ink-600">
            Whether through prayer, volunteering or a gift, you can share in the love of Christ
            for the poor.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Button href="/donate" variant="primary" size="lg" withArrow>
              Support our mission
            </Button>
            <Button href="/contact" variant="outline" size="lg">
              Contact us
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}
