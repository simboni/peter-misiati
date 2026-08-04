import type { Metadata } from "next";
import Link from "next/link";
import { BUSINESS, telHref, WA_GENERAL, WA_PRICE_LIST } from "@/lib/business";
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

const WHAT_WE_DO = [
  {
    title: "Raw chemicals",
    lead: "Our main trade.",
    body: "Close to thirty chemicals kept in stock — from drums of Ungerol and Ufacid to 25 kg bags of caustic. We sell you the drum, or we weigh out 250 g. Buy exactly what your batch needs instead of what the packaging forces on you.",
    cta: { href: "/products/", label: "See the chemical list" },
  },
  {
    title: "Finished cleaning products",
    lead: "Mixed here, ready to use.",
    body: "Handwash, shower gel, shampoo, laundry soap, bleach, disinfectant, toilet cleaner, degreaser, carwash shampoo and more. Take it as it comes, or buy in bulk and fill your own bottles for resale.",
    cta: { href: "/products/#finished", label: "See finished products" },
  },
  {
    title: "Mix kits",
    lead: "The recipe, measured out.",
    body: "Tell us what you want to make and how much. We weigh out each chemical to the recipe, in order, so all you do at home is add water and follow the steps. The cheapest way to start making your own.",
    cta: { href: "/products/#mix-kits", label: "How mix kits work" },
  },
];

const ORDER_STEPS = [
  {
    n: "1",
    title: "Send us your list",
    body: "WhatsApp or call with the chemicals and quantities you need. If you are not sure which chemical does what, describe the product you are making and we will tell you.",
  },
  {
    n: "2",
    title: "We confirm price and pack",
    body: "We check what is in stock, confirm the pack size that suits your batch, and quote you before anything is weighed out.",
  },
  {
    n: "3",
    title: "We pack it for you",
    body: "Bulk goes out as the drum or bag. Small quantities are weighed and sealed to order, so you get the amount you paid for.",
  },
];

export default function HomePage() {
  const popular = itemsBySlug(POPULAR_SLUGS);

  return (
    <>
      {/* Hero */}
      <div className="border-b border-line bg-surface">
        <Container className="py-14 sm:py-20">
          <p className="mb-3 inline-block rounded-full bg-leaf-soft px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-leaf-ink">
            {BUSINESS.city}, {BUSINESS.country}
          </p>
          <h1 className="max-w-3xl text-3xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            Your home of{" "}
            <span className="text-accent">Industrial Chemicals</span>
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
            {BUSINESS.name} supplies the chemicals behind everyday cleaning — in bulk for
            manufacturers and resellers, and in small repacked quantities for people mixing a
            batch at home. We also mix and sell the finished cleaners ourselves.
          </p>

          <div className="mt-7 flex flex-wrap gap-3">
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

          <dl className="mt-10 grid gap-4 sm:grid-cols-3">
            {[
              { t: "Bulk or broken down", d: "170 kg drums and 50 kg bags, or repacks from 125 g." },
              { t: "Weighed to order", d: "You buy the quantity your recipe actually calls for." },
              { t: "Ask before you buy", d: "Tell us what you are making; we will tell you what you need." },
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
          lead="Whether you mix your own or you would rather buy it finished, the same shop and the same phone number serves you."
        />
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {WHAT_WE_DO.map((item) => (
            <Card key={item.title} className="flex flex-col">
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
          lead="These are the chemicals that move fastest off our shelves. The full list — with what each one is for and the packs it comes in — is on the products page."
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
          lead="Most of our orders come in by WhatsApp, because it is easy to send a list and a photo of what you used last time."
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
          Prices are not listed on this site because they follow the market and the pack size.
          Ask us and we will quote you the same day.
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
