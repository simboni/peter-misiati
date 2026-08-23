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
    body: "LABSA, SLES, caustic, hypo and the rest — held here in Nairobi, in bulk or weighed out from 125 g.",
  },
  {
    src: "/photos/store-peroxide-wide.webp",
    srcSm: "/photos/store-peroxide-wide-sm.webp",
    alt: "Pallets of 30 litre jerricans of technical grade hydrogen peroxide",
    eyebrow: "Sealed and traceable",
    body: "Straight from the importer, batch numbers and safety labels intact. You know what you are buying.",
  },
  {
    src: "/photos/store-chlorine-tubs.webp",
    srcSm: "/photos/store-chlorine-tubs-sm.webp",
    alt: "45 kg tubs of NSF-certified chlorine granules stacked in the store",
    eyebrow: "Bulk or broken down",
    body: "Take the whole 45 kg tub, or we weigh out exactly what your batch calls for and seal it while you wait.",
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
      {/*
        The slider is the page — first element, full bleed, nothing above it but
        the header. The owner was clear: it should be the very first thing you
        see, and anything worth highlighting belongs inside it. So the headline,
        the promise and the two ways to order are handed to it as children.
      */}
      <HeroSlider
        slides={HERO_SLIDES}
        headline={
          <>
            Your home of <span className="text-leaf-light">Industrial Chemicals</span>
          </>
        }
        actions={
          <>
            <CtaLink href={WA_GENERAL} tone="whatsapp">
              <WhatsAppIcon />
              Order on WhatsApp
            </CtaLink>
            {/* Solid white, not the outline tone: an outlined button on a
                photograph is a rectangle of nothing. */}
            <a
              href={telHref}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold text-on-photo transition hover:bg-white/90"
            >
              <PhoneIcon />
              {BUSINESS.phoneDisplay}
            </a>
            <Link
              href="/products/"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/15 px-5 py-3 text-sm font-bold text-white ring-1 ring-inset ring-white/40 backdrop-blur transition hover:bg-white/25"
            >
              Browse the catalogue
            </Link>
          </>
        }
      />

      <div className="border-b border-line bg-surface">
        <Container className="py-10 sm:py-12">
          <dl className="grid gap-4 sm:grid-cols-3">
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
