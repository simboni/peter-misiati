import type { Metadata } from "next";
import Link from "next/link";
import { programs, projects } from "@/lib/cosdep";
import { PageHero } from "@/components/page-hero";
import { Section, Button, Pill, Eyebrow } from "@/components/ui";
import { Reveal } from "@/components/reveal";
import { CheckIcon, ArrowRightIcon } from "@/components/icons";

export const metadata: Metadata = {
  title: "Our Programmes",
  description:
    "COSDEP works across three programme pillars: Food & Nutrition Security, Natural Resource Management, and Value Addition & Entrepreneurship.",
};

export default function ProgramsPage() {
  return (
    <>
      <PageHero
        eyebrow="What we do"
        title="Our programmes"
        intro="Three connected pillars that together secure food, restore the environment and build household income for rural communities."
        image="/images/kitchen-garden.jpg"
      />

      {/* Pillar nav */}
      <div className="border-b border-sand-200 bg-canvas/80 backdrop-blur">
        <div className="container-page flex flex-wrap gap-2 py-4">
          {programs.map((p) => (
            <Link
              key={p.slug}
              href={`#${p.slug}`}
              className="rounded-full bg-sand-100 px-4 py-1.5 text-sm font-medium text-forest-700 transition-colors hover:bg-forest-50"
            >
              {p.title}
            </Link>
          ))}
        </div>
      </div>

      {programs.map((program, idx) => {
        const related = projects.filter((p) => p.program === program.slug);
        const flip = idx % 2 === 1;
        return (
          <Section
            key={program.slug}
            id={program.slug}
            className={`scroll-mt-24 ${idx % 2 === 1 ? "bg-sand-50" : ""}`}
          >
            <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
              {/* Image */}
              <Reveal
                variant={flip ? "left" : "right"}
                className={flip ? "lg:order-2" : ""}
              >
                <div className="overflow-hidden rounded-[1.75rem] shadow-lift">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={program.image}
                    alt={program.imageAlt}
                    className="aspect-[4/3] w-full object-cover"
                  />
                </div>
              </Reveal>

              {/* Copy */}
              <Reveal
                variant={flip ? "right" : "left"}
                className={flip ? "lg:order-1" : ""}
              >
                <Pill tone="leaf">Programme {idx + 1}</Pill>
                <h2 className="mt-4 font-display text-3xl font-bold leading-tight tracking-tight text-ink-900 text-balance sm:text-4xl">
                  {program.title}
                </h2>
                <p className="mt-3 font-display text-lg font-semibold text-forest-600">
                  {program.tagline}
                </p>
                <p className="mt-4 text-lg leading-relaxed text-ink-600 text-pretty">
                  {program.summary}
                </p>

                <ul className="mt-6 grid gap-2 sm:grid-cols-2">
                  {program.activities.map((a) => (
                    <li
                      key={a}
                      className="flex items-center gap-2 text-sm font-medium text-ink-700"
                    >
                      <CheckIcon className="h-4 w-4 shrink-0 text-forest-500" />
                      {a}
                    </li>
                  ))}
                </ul>

                {related.length > 0 && (
                  <div className="mt-8 rounded-2xl border border-sand-200 bg-white p-5">
                    <Eyebrow>Related projects</Eyebrow>
                    <ul className="mt-3 space-y-2">
                      {related.map((r) => (
                        <li key={r.slug}>
                          <Link
                            href="/projects"
                            className="group inline-flex items-start gap-2 text-sm text-ink-700 hover:text-forest-700"
                          >
                            <ArrowRightIcon className="mt-0.5 h-4 w-4 shrink-0 text-forest-500 transition-transform group-hover:translate-x-0.5" />
                            {r.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Reveal>
            </div>
          </Section>
        );
      })}

      {/* CTA */}
      <section className="bg-forest-800">
        <div className="container-page py-16 text-center sm:py-20">
          <h2 className="mx-auto max-w-2xl font-display text-3xl font-extrabold text-white text-balance sm:text-4xl">
            Bring these programmes to your community
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-forest-100/85">
            Whether you want to train, fund or volunteer — there is a place for
            you in this work.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button href="/get-involved" variant="leaf" size="lg" withArrow>
              Get involved
            </Button>
            <Button href="/projects" variant="white" size="lg">
              See our projects
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
