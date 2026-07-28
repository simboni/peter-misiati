import type { Metadata } from "next";
import { projects } from "@/lib/keysa";
import { PageHero } from "@/components/page-hero";
import { Button } from "@/components/ui";
import { Reveal } from "@/components/reveal";
import { ProjectCard } from "@/components/project-card";
import { HeartIcon } from "@/components/icons";

export const metadata: Metadata = {
  title: "Projects",
  description:
    "KEYSA's initiatives in Kakamega County: TVET education for vulnerable youth, climate action, sports and talent development, and community tournaments — each with clear targets and budgets, ready for donor support.",
};

export default function ProjectsPage() {
  const active = projects.filter((p) => p.status !== "Completed");
  const completed = projects.filter((p) => p.status === "Completed");

  return (
    <>
      <PageHero
        eyebrow="Projects"
        title="Designed, costed and ready to change lives"
        lede="These aren't vague intentions — each project has defined beneficiaries, activities, budgets and sustainability plans, drawn from formal proposals. Donors and partners can fund a whole project or a single line item."
      />

      <section className="py-16 sm:py-20">
        <div className="container-page">
          <Reveal>
            <h2 className="font-display text-2xl font-bold text-mist-100">
              Seeking funding
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-mist-400">
              Ready to launch the moment funding lands — join us as a founding donor
              of any of these initiatives.
            </p>
          </Reveal>
          <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {active.map((project, i) => (
              <Reveal key={project.slug} delay={i * 80}>
                <ProjectCard project={project} />
              </Reveal>
            ))}
          </div>

          {completed.length > 0 && (
            <>
              <Reveal>
                <h2 className="mt-16 font-display text-2xl font-bold text-mist-100">
                  Delivered
                </h2>
                <p className="mt-2 max-w-2xl text-sm text-mist-400">
                  Proof of execution — projects KEYSA has already brought to the
                  community.
                </p>
              </Reveal>
              <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {completed.map((project, i) => (
                  <Reveal key={project.slug} delay={i * 80}>
                    <ProjectCard project={project} />
                  </Reveal>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      <section className="border-t border-ink-600 bg-ink-850 py-16">
        <div className="container-page text-center">
          <Reveal>
            <h2 className="mx-auto max-w-2xl font-display text-2xl font-bold text-mist-100 sm:text-3xl text-balance">
              Want to fund a project — or co-design a new one with us?
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-mist-400">
              We partner with foundations, companies, county government and
              individuals. Full proposals with detailed budgets are available on
              request.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Button href="/donate/" variant="donate">
                <HeartIcon className="h-4 w-4" />
                Fund a project
              </Button>
              <Button href="/contact/" variant="ghost">
                Request a proposal
              </Button>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
