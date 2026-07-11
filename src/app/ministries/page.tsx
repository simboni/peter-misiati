import type { Metadata } from "next";
import { PageHero } from "@/components/page-hero";
import { Section } from "@/components/ui";
import { Reveal } from "@/components/reveal";
import { MinistryCard } from "@/components/ministry-card";
import { ministries } from "@/lib/site";

export const metadata: Metadata = {
  title: "Our Ministries",
  description:
    "One mission of charity lived five ways: education, evangelization, pastoral healthcare, formation of the laity, and spiritual exercises & retreats.",
};

export default function MinistriesPage() {
  return (
    <>
      <PageHero
        crumb="Ministries"
        eyebrow="How we serve"
        title="Our ministries"
        intro="We dedicate ourselves to serve the poor, needy and the marginalized through our five ministries — each an expression of the one charity of Christ."
      />
      <Section className="bg-cream-50">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {ministries.map((m, i) => (
            <Reveal key={m.slug} delay={i * 60}>
              <MinistryCard ministry={m} />
            </Reveal>
          ))}
        </div>
      </Section>
    </>
  );
}
