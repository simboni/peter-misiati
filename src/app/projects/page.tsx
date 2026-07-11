import type { Metadata } from "next";
import { PageHero } from "@/components/page-hero";
import { Section, Button } from "@/components/ui";
import { ProjectsDirectory } from "@/components/projects-directory";

export const metadata: Metadata = {
  title: "Our Projects",
  description:
    "Explore COSDEP's projects across Kiambu, Murang'a and the Aberdares — from watershed conservation and tree planting to organic market outlets and agroecology.",
};

export default function ProjectsPage() {
  return (
    <>
      <PageHero
        eyebrow="Our work in the field"
        title="Projects"
        intro="Current and upcoming projects turning agro-ecological ideas into real change — restoring watersheds, planting trees and building farmer enterprises."
        image="/images/community-tree-planting.jpg"
      />

      <Section>
        <ProjectsDirectory />
      </Section>

      <section className="bg-sand-50">
        <div className="container-page py-16 text-center sm:py-20">
          <h2 className="mx-auto max-w-2xl font-display text-3xl font-bold text-ink-900 text-balance sm:text-4xl">
            Want to fund or support a project?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-ink-500">
            Partner with COSDEP to bring lasting change to more farming
            communities across Kenya.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button href="/get-involved#partner" variant="primary" size="lg" withArrow>
              Explore partnership
            </Button>
            <Button href="/contact" variant="outline" size="lg">
              Contact us
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
