import type { Metadata } from "next";
import Link from "next/link";
import { BUSINESS, telHref, WA_GENERAL, WA_PRICE_LIST } from "@/lib/business";
import { HeroSlider, type Slide } from "@/components/hero-slider";
import { itemsBySlug, POPULAR_SLUGS } from "@/lib/catalogue";
import {
  Card,
  Container,
  CtaLink,
  PhoneIcon,
  Section,
  SectionHeading,
  Tag,
  WhatsAppIcon,
} from "@/components/ui";

export const metadata: Metadata = {
  title: `${BUSINESS.name} — Industrial Chemicals Supplier in Nairobi`,
  description:
    "Buy industrial and detergent-making chemicals in Nairobi: caustic soda, SLES/Ungerol, LABSA (Ufacid), soda ash, hypo, STPP and more. Bulk drums and bags, or repacked from 125 g. Finished cleaners and mix kits. Call or WhatsApp +254 723 496 434.",
  alternates: { canonical: "/" },
};

const HERO_SLIDES: Slide[] = [
  {
    src: "/photos/store-labsa-drums.webp",
    srcSm: "/photos/store-labsa-drums-sm.webp",
    alt: "Rows of 250 kg drums of LABSA stacked in the Riziki store",
    eyebrow: "In stock now",
    title: "Drums, not promises",
    body: "LABSA, SLES, caustic, hypo and the rest — held here in Nairobi, in the quantities a working business actually orders.",
    cta: { href: "/products/", label: "See the chemical list" },
  },
  {
    src: "/photos/store-peroxide-wide.webp",
    srcSm: "/photos/store-peroxide-wide-sm.webp",
    alt: "Pallets of 30 litre jerricans of technical grade hydrogen peroxide",
    eyebrow: "Sealed and traceable",
    title: "Straight from the importer",
    body: "Sealed containers with their batch numbers and safety labels intact, so you know what you are buying and where it came from.",
    cta: { href: "/about/", label: "How we buy" },
  },
  {
    src: "/photos/store-chlorine-tubs.webp",
    srcSm: "/photos/store-chlorine-tubs-sm.webp",
    alt: "45 kg tubs of NSF-certified chlorine granules stacked in the store",
    eyebrow: "Bulk or broken down",
    title: "Buy the tub, or 125 grams of it",
    body: "Take the whole 45 kg, or we weigh out exactly what your batch calls for and seal it while you wait.",
    cta: { href: "/products/", label: "See pack sizes" },
  },
];

const WHAT_WE_DO = [
  {
    title: "Raw chemicals",
    lead: "Our main trade.",
    body: "About thirty chemicals in stock. Buy the whole drum, or we weigh out as little as 125 g.",
    art: "/photos/raw-drum-open.webp",
    artAlt: "An open 170 kg drum of SLES, lined and ready to be weighed out",
    cta: { href: "/products/", label: "See the chemical list" },
  },
  {
    title: "Finished cleaning products",
    lead: "Mixed here, ready to use.",
    body: "Handwash, shampoo, bleach, toilet cleaner and more — or in bulk for your own bottles.",
    art: "/photos/biodigester.webp",
    artAlt: "A tub of Biodigester, one of the finished products mixed at the shop",
    cta: { href: "/products/#finished", label: "See finished products" },
  },
  {
    title: "Mix kits",
    lead: "The recipe, measured out.",
    body: "Your recipe, weighed chemical by chemical. Add water at home and follow the steps.",
    art: "/photos/labsa-pouring.webp",
    artAlt: "LABSA being decanted into a lined drum",
    cta: { href: "/products/#mix-kits", label: "How mix kits work" },
  },
];

const ORDER_STEPS = [
  {
    n: "1",
    title: "Send us your list",
    body: "WhatsApp or call — or just describe what you are making.",
  },
  {
    n: "2",
    title: "We confirm price and pack",
    body: "Stock checked, pack size matched to your batch, quoted before anything is weighed.",
  },
  {
    n: "3",
    title: "We pack it for you",
    body: "Bulk goes as the drum or bag; small amounts are weighed and sealed to order.",
  },
];

export default function HomePage() {
  const popular = itemsBySlug(POPULAR_SLUGS);

  return (
    <>
      {/* Hero */}
      <div className="border-b border-line bg-surface">
        <Container className="py-10 sm:py-14">
          <div className="max-w-3xl">
            <p className="mb-3 inline-block rounded-full bg-leaf-soft px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-leaf-ink">
              {BUSINESS.city}, {BUSINESS.country}
            </p>
            <h1 className="text-3xl font-extrabold leading-tight tracking-tight sm:text-5xl">
              Your home of <span className="text-accent">Industrial Chemicals</span>
            </h1>
            <p className="mt-4 text-base leading-relaxed text-muted sm:text-lg">
              Chemicals in bulk or repacked from 125 g. Finished cleaners mixed on our own bench.
              Mix kits weighed to your recipe.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <CtaLink href={WA_GENERAL} tone="whatsapp">
                <WhatsAppIcon />
                Order on WhatsApp
              </CtaLink>
              <CtaLink href={telHref} tone="brand">
                <PhoneIcon />
                {BUSINESS.phoneDisplay}
              </CtaLink>
              <CtaLink href="/products/" tone="outline">
                Browse the catalogue
              </CtaLink>
            </div>
          </div>

          {/*
            Photographs of the actual store, full width, under the headline
            rather than beside it.

            Beside it the slider was 505px of a 1280px screen and its captions
            fought the h1 for the same job. Underneath and full width it does
            what the owner asked of it: a buyer deciding whether a Nairobi
            supplier can really fill their order is asking "do they have it?",
            and a stack of sealed drums answers that before any copy does.
          */}
          <div className="mt-8">
            <HeroSlider slides={HERO_SLIDES} />
          </div>

          <dl className="mt-10 grid gap-4 sm:grid-cols-3">
            {[
              { t: "Bulk or broken down", d: "170 kg drums and 50 kg bags, or repacks from 125 g." },
              { t: "Weighed to order", d: "Buy the quantity your recipe actually calls for." },
              { t: "Ask before you buy", d: "Tell us what you are making; we point you right." },
            ].map((point) => (
              <div key={point.t} className="rounded-xl border border-line bg-page p-4">
                <dt className="text-sm font-extrabold">{point.t}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-muted">{point.d}</dd>
              </div>
            ))}
          </dl>
        </Container>
      </div>

      {/* The three lines of business */}
      <Section>
        <SectionHeading
          eyebrow="What we do"
          title="Three ways to buy from us"
          lead="Mix your own, or buy it finished — same shop, same number."
        />
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {WHAT_WE_DO.map((item) => (
            <Card key={item.title} className="flex flex-col">
              <img
                src={item.art}
                alt={item.artAlt}
                loading="lazy"
                decoding="async"
                className="mb-4 h-40 w-full rounded-xl object-cover"
                width={414}
                height={414}
              />
              <h3 className="text-lg font-extrabold tracking-tight">{item.title}</h3>
              <p className="mt-1 text-sm font-bold text-leaf-ink">{item.lead}</p>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-muted">{item.body}</p>
              <Link
                href={item.cta.href}
                className="mt-4 text-sm font-bold text-accent hover:underline"
              >
                {item.cta.label} →
              </Link>
            </Card>
          ))}
        </div>
      </Section>

      {/* A taste of the catalogue */}
      <Section tone="surface">
        <SectionHeading
          eyebrow="In stock"
          title="Some of what people ask for most"
          lead="The fastest movers. The full list is on the products page."
        />
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {popular.map((item) => (
            <li key={item.slug} className="rounded-2xl border border-line bg-page p-4">
              <h3 className="text-base font-extrabold tracking-tight">{item.name}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{item.uses}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {item.packs.slice(0, 4).map((pack) => (
                  <Tag key={pack}>{pack}</Tag>
                ))}
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-8 flex flex-wrap gap-3">
          <CtaLink href="/products/" tone="brand">
            See all products
          </CtaLink>
          <CtaLink href={WA_PRICE_LIST} tone="outline">
            <WhatsAppIcon />
            Ask for today&rsquo;s prices
          </CtaLink>
        </div>
      </Section>

      {/* Ordering */}
      <Section>
        <SectionHeading
          eyebrow="Ordering"
          title="How to place an order"
          lead="Most orders come in on WhatsApp."
        />
        <ol className="mt-8 grid gap-5 md:grid-cols-3">
          {ORDER_STEPS.map((step) => (
            <li key={step.n} className="rounded-2xl border border-line bg-surface p-5">
              <span
                aria-hidden="true"
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-sm font-extrabold text-accent"
              >
                {step.n}
              </span>
              <h3 className="mt-3 text-base font-extrabold tracking-tight">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-sm leading-relaxed text-muted">
          No prices online — they follow the market. Ask and we quote the same day.
        </p>
      </Section>

      {/* Closing call to action */}
      <div className="border-t border-line bg-brand text-white">
        <Container className="py-12 text-center sm:py-16">
          <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
            Tell us what you need
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-white sm:text-base">
            One number for orders, prices and advice — the same number on WhatsApp.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <CtaLink href={WA_GENERAL} tone="whatsapp">
              <WhatsAppIcon />
              Message us on WhatsApp
            </CtaLink>
            <a
              href={telHref}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold text-brand hover:bg-white/90"
            >
              <PhoneIcon />
              {BUSINESS.phoneDisplay}
            </a>
          </div>
        </Container>
      </div>
    </>
  );
}
