import type { Metadata } from "next";
import { donation, contact, involve } from "@/lib/cosdep";
import { PageHero } from "@/components/page-hero";
import { Section, Button, Eyebrow, Pill } from "@/components/ui";
import { Reveal } from "@/components/reveal";
import {
  HeartIcon,
  LeafIcon,
  HandshakeIcon,
  CheckIcon,
  MailIcon,
  PhoneIcon,
} from "@/components/icons";

export const metadata: Metadata = {
  title: "Get Involved",
  description:
    "Donate, volunteer or partner with COSDEP to help rural Kenyan communities grow safe food, restore their land and build lasting income.",
};

const bankRows = (b: typeof donation.bank) => [
  { label: "Bank", value: b.bankName },
  { label: "Branch", value: `${b.branch} (code ${b.branchCode})` },
  { label: "Account name", value: b.accountName },
  { label: "Account number", value: b.accountNumber },
  { label: "SWIFT code", value: b.swift },
];

const volunteerAreas = [
  "Farmer training & demonstrations",
  "School gardening & mentorship",
  "Tree planting & field days",
  "Communications & storytelling",
  "Monitoring & data",
  "Fundraising & events",
];

export default function GetInvolvedPage() {
  return (
    <>
      <PageHero
        eyebrow="Get involved"
        title="Grow this future with us"
        intro="Every contribution — a gift, a skill, a partnership — helps a farming family secure food, income and a healthier environment."
        image="/images/school-tree-planting.jpg"
      />

      {/* Quick chooser */}
      <Section className="!pb-0">
        <div className="grid gap-6 md:grid-cols-3">
          {involve.map((item, i) => {
            const Icon = [HeartIcon, LeafIcon, HandshakeIcon][i] ?? HeartIcon;
            return (
              <Reveal key={item.title} variant="up" delay={i * 70}>
                <a
                  href={item.href}
                  className="group card flex h-full flex-col p-7 transition-all duration-300 hover:-translate-y-1 hover:shadow-lift"
                >
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-forest-50 text-forest-600">
                    <Icon className="h-6 w-6" />
                  </span>
                  <h3 className="mt-5 font-display text-xl font-bold text-ink-900">
                    {item.title}
                  </h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-500">
                    {item.body}
                  </p>
                </a>
              </Reveal>
            );
          })}
        </div>
      </Section>

      {/* -------------------------------- Donate ------------------------------- */}
      <Section id="donate" className="scroll-mt-24">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <Eyebrow>Donate</Eyebrow>
            <h2 className="mt-4 font-display text-3xl font-bold leading-tight tracking-tight text-ink-900 text-balance sm:text-4xl">
              Give directly to the field
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-ink-600 text-pretty">
              {donation.intro}
            </p>
            <ul className="mt-6 space-y-3">
              {[
                "Tree seedlings for schools & watersheds",
                "Hands-on agro-ecological farmer training",
                "Kitchen & school garden starter kits",
                "Continued mentorship after training",
              ].map((x) => (
                <li key={x} className="flex items-start gap-3 text-ink-700">
                  <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-forest-100 text-forest-600">
                    <CheckIcon className="h-4 w-4" />
                  </span>
                  {x}
                </li>
              ))}
            </ul>
          </div>

          {/* Bank card */}
          <Reveal variant="left">
            <div className="card overflow-hidden">
              <div className="flex items-center gap-3 border-b border-sand-200 bg-forest-600 px-6 py-5 text-white">
                <HeartIcon className="h-6 w-6" />
                <div>
                  <p className="font-display font-bold">Bank transfer</p>
                  <p className="text-sm text-forest-100">
                    Give from anywhere in the world
                  </p>
                </div>
              </div>
              <dl className="divide-y divide-sand-200">
                {bankRows(donation.bank).map((row) => (
                  <div
                    key={row.label}
                    className="flex flex-col gap-0.5 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <dt className="text-sm font-medium text-ink-500">
                      {row.label}
                    </dt>
                    <dd className="font-display font-semibold text-ink-900 sm:text-right">
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="border-t border-sand-200 bg-sand-50 px-6 py-4">
                <p className="text-sm text-ink-500">
                  Prefer to give another way, or need a receipt? {" "}
                  <a
                    href={`mailto:${contact.email}`}
                    className="font-semibold text-forest-600 hover:text-forest-700"
                  >
                    Email us
                  </a>{" "}
                  and we&rsquo;ll help.
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* ------------------------------- Volunteer ----------------------------- */}
      <Section id="volunteer" className="scroll-mt-24 bg-sand-50">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <Reveal variant="right">
            <div className="overflow-hidden rounded-[1.75rem] shadow-lift">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/tree-management-training.jpg"
                alt="Volunteers and farmers at a tree-management training day"
                className="aspect-[4/3] w-full object-cover"
              />
            </div>
          </Reveal>
          <div>
            <Eyebrow>Volunteer</Eyebrow>
            <h2 className="mt-4 font-display text-3xl font-bold leading-tight tracking-tight text-ink-900 text-balance sm:text-4xl">
              Share your skills in the field
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-ink-600 text-pretty">
              Volunteers help our programmes reach further — in the field, in
              schools and behind the scenes. Tell us where you&rsquo;d like to help.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {volunteerAreas.map((a) => (
                <Pill key={a} tone="forest">
                  {a}
                </Pill>
              ))}
            </div>
            <div className="mt-8">
              <Button href="/contact" variant="primary" withArrow>
                Become a volunteer
              </Button>
            </div>
          </div>
        </div>
      </Section>

      {/* -------------------------------- Partner ------------------------------ */}
      <Section id="partner" className="scroll-mt-24">
        <div className="rounded-[1.75rem] bg-forest-900 px-6 py-14 text-center text-white sm:px-12">
          <Pill tone="white" className="mb-5">
            <HandshakeIcon className="h-3.5 w-3.5" /> Partnerships
          </Pill>
          <h2 className="mx-auto max-w-2xl font-display text-3xl font-extrabold text-balance sm:text-4xl">
            Let&rsquo;s co-create lasting impact
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-forest-100/85 text-pretty">
            Foundations, agencies and businesses partner with COSDEP to fund
            programmes, sponsor tree-planting drives and reach more smallholder
            farmers. We&rsquo;d love to explore what we can build together.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button href={`mailto:${contact.email}`} variant="leaf" size="lg">
              <MailIcon className="h-5 w-5" /> {contact.email}
            </Button>
            <Button
              href={`tel:${contact.phone.replace(/\s/g, "")}`}
              variant="white"
              size="lg"
            >
              <PhoneIcon className="h-5 w-5" /> {contact.phoneDisplay}
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}
