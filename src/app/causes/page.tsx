import type { Metadata } from "next";
import { PageHero } from "@/components/page-hero";
import { Button, Section, SectionHeading } from "@/components/ui";
import { Reveal } from "@/components/reveal";
import { ProgressBar } from "@/components/progress-bar";
import { HeartHandIcon, ArrowRightIcon } from "@/components/icons";
import { causes } from "@/lib/site";

export const metadata: Metadata = {
  title: "Causes",
  description:
    "Join us in our ongoing causes — help build a Canossa school, fund scholarships, and equip the Canossa Hospital in Tanzania.",
};

export default function CausesPage() {
  return (
    <>
      <PageHero
        crumb="Causes"
        eyebrow="Ongoing causes"
        title="Join us in our ongoing causes"
        intro="Every gift, large or small, becomes education, healing and hope for the communities we serve. Here is where your generosity goes."
      />

      <Section className="bg-cream-50">
        <div className="space-y-8">
          {causes.map((c, i) => (
            <Reveal key={c.slug} delay={i * 60}>
              <article className="card grid gap-0 overflow-hidden lg:grid-cols-12">
                <div className="relative min-h-64 lg:col-span-5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={c.image}
                    alt={c.title}
                    loading="lazy"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                </div>
                <div className="flex flex-col justify-center p-7 lg:col-span-7 lg:p-10">
                  <h2 className="font-display text-2xl font-semibold text-ink-900 sm:text-3xl">
                    {c.title}
                  </h2>
                  <p className="mt-3 leading-relaxed text-ink-600">{c.summary}</p>
                  {c.quote && (
                    <p className="mt-4 border-l-2 border-gold-400 pl-4 font-display italic text-terra-700">
                      “{c.quote.text}”
                      {c.quote.by && <span className="mt-1 block text-sm not-italic text-ink-500">— {c.quote.by}</span>}
                    </p>
                  )}
                  <div className="mt-6 max-w-md">
                    <ProgressBar value={c.progress} accent={c.accent} label="Toward our goal" />
                  </div>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <Button href="/donate" variant="primary">
                      <HeartHandIcon className="h-4 w-4" /> Donate to this cause
                    </Button>
                    <Button href="/contact" variant="outline" withArrow>
                      Partner with us
                    </Button>
                  </div>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </Section>

      <section className="relative overflow-hidden bg-terra-900">
        <div className="absolute inset-0 glow-warm" />
        <div className="container-page relative py-16 text-center">
          <SectionHeading
            align="center"
            title={<span className="text-cream-50">Every act of charity counts</span>}
            className="mx-auto text-center [&_span]:!text-gold-300"
          />
          <p className="mx-auto mt-4 max-w-xl text-cream-200/85">
            Support the whole mission with a single gift, and we will direct it where the need is
            greatest.
          </p>
          <div className="mt-8 flex justify-center">
            <Button href="/donate" variant="gold" size="lg">
              Give to the mission <ArrowRightIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
