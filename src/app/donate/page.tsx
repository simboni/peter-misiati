import type { Metadata } from "next";
import { PageHero } from "@/components/page-hero";
import { Button, Section, SectionHeading, Rubric } from "@/components/ui";
import { Reveal } from "@/components/reveal";
import { ProgressBar } from "@/components/progress-bar";
import {
  MinistryIcon,
  CheckIcon,
  HeartHandIcon,
  MailIcon,
  PhoneIcon,
} from "@/components/icons";
import { causes, ministries, contact, founder } from "@/lib/site";

export const metadata: Metadata = {
  title: "Donate",
  description:
    "Support the Canossian Sisters. Your gift builds schools, funds scholarships, equips the Canossa Hospital, and sustains the mission of charity across North & East Africa.",
};

const ways = [
  {
    title: "Educate a child",
    body: "Sponsor a learner or help build classrooms so more children receive a values-based education.",
    icon: "book" as const,
  },
  {
    title: "Heal the sick",
    body: "Equip the Canossa Hospital and support maternal and primary care for families in need.",
    icon: "heart" as const,
  },
  {
    title: "Sustain the mission",
    body: "Give where the need is greatest — evangelization, formation, retreats and daily works of charity.",
    icon: "dove" as const,
  },
];

export default function DonatePage() {
  return (
    <>
      <PageHero
        crumb="Donate"
        eyebrow="Give"
        title="Your gift becomes charity in action"
        intro="Every contribution helps us serve the poor, the young and the sick across Tanzania, Kenya, Uganda and Sudan. Thank you for walking with us."
      />

      {/* Ways to give */}
      <Section className="bg-cream-50">
        <div className="grid gap-6 md:grid-cols-3">
          {ways.map((w, i) => (
            <Reveal key={w.title} delay={i * 70}>
              <div className="card h-full p-7">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-terra-50 text-terra-600">
                  <MinistryIcon name={w.icon} className="h-6 w-6" />
                </span>
                <h3 className="mt-4 font-display text-xl font-semibold text-ink-900">{w.title}</h3>
                <p className="mt-2 text-ink-600">{w.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* Causes snapshot */}
      <Section className="bg-cream-100 bg-dots">
        <SectionHeading
          align="center"
          eyebrow="Where it goes"
          title="Causes your gift supports"
          className="mx-auto text-center"
        />
        <div className="mx-auto mt-10 grid max-w-4xl gap-4 sm:grid-cols-3">
          {causes.map((c, i) => (
            <Reveal key={c.slug} delay={i * 60}>
              <div className="card h-full p-6">
                <h3 className="font-display text-base font-semibold leading-snug text-ink-900">
                  {c.title}
                </h3>
                <div className="mt-4">
                  <ProgressBar value={c.progress} accent={c.accent} />
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* How to give */}
      <Section className="bg-cream-50">
        <div className="grid gap-10 lg:grid-cols-12 lg:items-start">
          <div className="lg:col-span-7">
            <SectionHeading
              eyebrow="How to give"
              title="Making your gift"
              intro="To make a donation or set up a partnership, please contact the Provincial House. We will gladly share our giving details and answer any questions."
            />
            <ul className="mt-8 space-y-4">
              {[
                "One-time or recurring gifts of any size",
                "Sponsorship of a student or a classroom",
                "Partnerships with parishes, schools and organizations",
                "Gifts in kind — books, medical supplies and equipment",
              ].map((item) => (
                <li key={item} className="flex gap-3 text-ink-700">
                  <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sage-500/12 text-sage-600">
                    <CheckIcon className="h-3.5 w-3.5" />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button href={`mailto:${contact.email}`} variant="primary" size="lg">
                <MailIcon className="h-4 w-4" /> Email us to give
              </Button>
              <Button href={contact.phoneHref} variant="outline" size="lg">
                <PhoneIcon className="h-4 w-4" /> {contact.phone}
              </Button>
            </div>
          </div>

          <div className="lg:col-span-5">
            <div className="card overflow-hidden bg-terra-900 p-8 text-cream-100">
              <Rubric className="mb-5 max-w-[10rem]" />
              <HeartHandIcon className="h-9 w-9 text-gold-300" />
              <p className="mt-5 font-display text-2xl font-medium leading-snug text-cream-50">
                “There is no act of charity as perfect as that of helping our neighbour to love
                God.”
              </p>
              <p className="mt-3 text-sm text-cream-200/70">— {founder.name}</p>
            </div>
          </div>
        </div>
      </Section>

      {/* Ministries footer strip */}
      <section className="border-t border-line bg-cream-100">
        <div className="container-page flex flex-wrap items-center justify-center gap-x-8 gap-y-3 py-8 text-sm text-ink-500">
          <span className="font-semibold text-ink-700">Your gift sustains:</span>
          {ministries.map((m) => (
            <span key={m.slug} className="inline-flex items-center gap-1.5">
              <MinistryIcon name={m.icon} className="h-4 w-4 text-terra-500" />
              {m.name}
            </span>
          ))}
        </div>
      </section>
    </>
  );
}
