import type { Metadata } from "next";
import { org, figures, contact, site } from "@/lib/cosdep";
import { PageHero } from "@/components/page-hero";
import { Section, SectionHeading, Button, Eyebrow, Pill } from "@/components/ui";
import { Reveal } from "@/components/reveal";
import { CountUp } from "@/components/count-up";
import { LeafIcon, SproutIcon, TreeIcon, HeartIcon } from "@/components/icons";

export const metadata: Metadata = {
  title: "About COSDEP",
  description:
    "COSDEP is a registered Kenyan NGO advancing agro-ecological agriculture, natural-resource management and value addition for rural communities. Learn our mission, vision and approach.",
};

const approachIcons = [SproutIcon, LeafIcon, TreeIcon, HeartIcon];

export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="About us"
        title="Training farmers to secure their future"
        intro="For two decades, COSDEP has walked alongside rural communities in Kenya — helping households grow safe food, restore their land and build lasting income."
        image="/images/farmers-vegetables.jpg"
      />

      {/* ------------------------------ Who we are ----------------------------- */}
      <Section>
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <Reveal variant="right">
            <div className="overflow-hidden rounded-[1.75rem] shadow-lift">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/community-training.jpg"
                alt="A COSDEP facilitator leading an outdoor training with women farmers"
                className="aspect-[4/3] w-full object-cover"
              />
            </div>
          </Reveal>
          <Reveal variant="left">
            <Eyebrow>Who we are</Eyebrow>
            <h2 className="mt-4 font-display text-3xl font-bold leading-tight tracking-tight text-ink-900 text-balance sm:text-4xl">
              A community-rooted NGO
            </h2>
            <div className="mt-5 space-y-4 text-lg leading-relaxed text-ink-600 text-pretty">
              <p>{org.intro}</p>
              <p>
                Registered as the {site.fullName}, we work hands-on with
                smallholder farmers, schools and local groups — and we don&rsquo;t
                leave after the training ends. We keep checking in, sharing new
                ideas and growing the movement toward food security and
                environmental care.
              </p>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* -------------------------- Mission & vision --------------------------- */}
      <Section className="bg-forest-900 text-white">
        <div className="grid gap-8 md:grid-cols-2">
          <Reveal variant="up">
            <div className="flex h-full flex-col rounded-2xl bg-forest-800/60 p-8 ring-1 ring-forest-700/60">
              <Pill tone="white" className="self-start">
                <SproutIcon className="h-3.5 w-3.5" /> Our mission
              </Pill>
              <p className="mt-5 text-xl leading-relaxed text-forest-50 text-pretty">
                {org.mission}
              </p>
            </div>
          </Reveal>
          <Reveal variant="up" delay={100}>
            <div className="flex h-full flex-col rounded-2xl bg-forest-800/60 p-8 ring-1 ring-forest-700/60">
              <Pill tone="white" className="self-start">
                <TreeIcon className="h-3.5 w-3.5" /> Our vision
              </Pill>
              <p className="mt-5 text-xl leading-relaxed text-forest-50 text-pretty">
                {org.vision}
              </p>
            </div>
          </Reveal>
        </div>

        {/* Figures strip */}
        <div className="mt-12 grid gap-8 border-t border-forest-700/60 pt-12 sm:grid-cols-3">
          {figures.map((f) => (
            <div key={f.label} className="text-center">
              <p className="font-display text-4xl font-extrabold text-leaf-400 sm:text-5xl">
                <CountUp end={f.value} suffix={f.suffix} />
              </p>
              <p className="mt-1 text-sm text-forest-100/80">{f.label}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ------------------------------ Our approach --------------------------- */}
      <Section>
        <SectionHeading
          align="center"
          eyebrow="How we work"
          title="Our approach"
          intro="Four commitments shape everything we do — from the first seed to the final harvest."
          className="mx-auto text-center"
        />
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {org.approach.map((a, i) => {
            const Icon = approachIcons[i] ?? LeafIcon;
            return (
              <Reveal key={a.title} variant="up" delay={i * 70}>
                <div className="card flex h-full gap-5 p-7">
                  <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-forest-50 text-forest-600">
                    <Icon className="h-6 w-6" />
                  </span>
                  <div>
                    <h3 className="font-display text-lg font-bold text-ink-900">
                      {a.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-ink-500">
                      {a.body}
                    </p>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </Section>

      {/* ------------------------------ Team / band ---------------------------- */}
      <Section className="bg-sand-50">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <Reveal variant="right">
            <div className="overflow-hidden rounded-[1.75rem] shadow-lift">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/team-partners.jpg"
                alt="The COSDEP team together with partners in a green garden"
                className="aspect-[4/3] w-full object-cover"
              />
            </div>
          </Reveal>
          <Reveal variant="left">
            <Eyebrow>Our people & partners</Eyebrow>
            <h2 className="mt-4 font-display text-3xl font-bold leading-tight tracking-tight text-ink-900 text-balance sm:text-4xl">
              Stronger together
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-ink-600 text-pretty">
              Our field officers, trainers and volunteers work side by side with
              farmers, schools, funders and local partners. Together we turn
              agro-ecological knowledge into thriving gardens, greener hills and
              real household income.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button href="/get-involved#partner" variant="primary" withArrow>
                Partner with us
              </Button>
              <Button href={`mailto:${contact.email}`} variant="outline">
                {contact.email}
              </Button>
            </div>
          </Reveal>
        </div>
      </Section>
    </>
  );
}
