import type { Metadata } from "next";
import { BUSINESS, SITE_URL, telHref, WA_MIX_KIT, WA_PRICE_LIST } from "@/lib/business";
import { CATEGORIES, ITEMS } from "@/lib/catalogue";
import {
  Card,
  Container,
  CtaLink,
  PhoneIcon,
  PhotoHeader,
  Section,
  SectionHeading,
  WhatsAppIcon,
} from "@/components/ui";
import { openGraphFor } from "@/lib/seo";
import { Catalogue } from "./catalogue";

export const metadata: Metadata = {
  title: "Products & chemical catalogue",
  description:
    "Our full chemical list with what each one is used for and the pack sizes available: SLES/Ungerol, LABSA (Ufacid), caustic soda and pearls, hypo, chlorine, soda ash (Magadi), STPP, CMC, EDTA, glycerine, pine oil and more — plus finished cleaners and mix kits. Nairobi, Kenya.",
  alternates: { canonical: "/products/" },
  openGraph: openGraphFor({
    title: `Chemical catalogue — ${BUSINESS.name}`,
    description:
      "Search our chemicals by name or by what you are making. Bulk drums and bags, or repacks from 125 g. Finished cleaning products and measured mix kits.",
    path: "/products/",
  }),
};

const MIX_KIT_STEPS = [
  {
    n: "1",
    title: "Tell us the product and the batch",
    body: "“I want to make 20 litres of dishwashing liquid.” That is enough to start. If you already have a recipe you trust, bring it and we will work to that instead.",
  },
  {
    n: "2",
    title: "We weigh out each chemical",
    body: "Every ingredient is measured to your batch size and packed separately, labelled, in the order you will add them.",
  },
  {
    n: "3",
    title: "You mix it at home",
    body: "We go through the steps with you before you leave — what to dissolve first, what to add slowly, what to leave to settle. Come back and ask if a batch does not come out right.",
  },
];

/**
 * `ItemList` structured data for the catalogue.
 *
 * Names only, no prices or availability claims: this page carries neither, and
 * marking up a price we do not publish would be a lie told to a search engine.
 */
function CatalogueJsonLd() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `Chemicals and cleaning products — ${BUSINESS.name}`,
    url: `${SITE_URL}/products/`,
    numberOfItems: ITEMS.length,
    itemListElement: ITEMS.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "Product",
        name: item.name,
        description: item.uses,
        category: CATEGORIES.find((category) => category.id === item.category)?.name,
        brand: { "@type": "Brand", name: BUSINESS.name },
      },
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
    />
  );
}

export default function ProductsPage() {
  return (
    <>
      <CatalogueJsonLd />

      <PhotoHeader
        src="/photos/store-labsa-drums.webp"
        srcSm="/photos/store-labsa-drums-sm.webp"
        eyebrow="Catalogue"
        title="Everything we sell, and what it is for"
        lead={`${ITEMS.length} products across chemicals, finished cleaners and mix kits. Search by the name you know it by — we have listed the local names alongside the chemical ones — or by the product you are trying to make.`}
      >
        <div className="mt-6 flex flex-wrap gap-3">
          <CtaLink href={WA_PRICE_LIST} tone="whatsapp">
            <WhatsAppIcon />
            Ask for today&rsquo;s prices
          </CtaLink>
          {/* On a dark header the outline button would be an invisible box, so
              this one is solid. */}
          <a
            href={telHref}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold text-on-photo transition hover:bg-white/90"
          >
            <PhoneIcon />
            {BUSINESS.phoneDisplay}
          </a>
        </div>
      </PhotoHeader>

      {/* How to read the list */}
      <Section>
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="bg-surface">
            <h2 className="text-sm font-extrabold">Pack sizes</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Bulk comes as it arrives — 170 kg and 250 kg drums, 50 kg bags, 25 kg bags.
              Repacks step down 20 kg, 5 kg, 1 kg, 500 g, 250 g and 125 g depending on the
              chemical. If the size you want is not listed, ask: we repack to order.
            </p>
          </Card>
          <Card className="bg-surface">
            <h2 className="text-sm font-extrabold">Prices</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Not published here, because they move with the market and the pack. Send your
              list on WhatsApp and we will quote you the same day.
            </p>
          </Card>
          <Card className="bg-surface">
            <h2 className="text-sm font-extrabold">Not sure which one?</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Describe the product you want to make rather than guessing at a chemical name.
              That is the fastest way to the right shelf — and it is what we are here for.
            </p>
          </Card>
        </div>
      </Section>


      {/* Photographs of the actual stock. The catalogue below is names and pack
          sizes; a buyer deciding whether to make the trip into town wants to see
          that the drums are really there. */}
      <Section tone="surface" className="pt-0">
        <SectionHeading
          eyebrow="From the store"
          title="What you are buying"
          lead="Photographs from our own store and deliveries — not stock pictures."
        />
        <ul className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            { src: "/photos/sles-drums.webp", alt: "Labelled 170 kg drums of SLES in the store", cap: "SLES in 170 kg drums" },
            { src: "/photos/salt-sacks.webp", alt: "Fifty-kilo sacks of industrial salt stacked in a delivery van", cap: "Industrial salt, by the sack" },
            { src: "/photos/jerricans.webp", alt: "Rows of twenty-litre jerricans of liquid chemical on a delivery truck", cap: "Liquids in 20 L jerricans" },
            { src: "/photos/biodigester.webp", alt: "A tub of Biodigester, a finished product for pit latrines and septic tanks", cap: "Finished products" },
            { src: "/photos/store-chlorine-tubs-sm.webp", alt: "45 kg tubs of NSF-certified chlorine granules stacked in the store", cap: "Chlorine by the 45 kg tub" },
            { src: "/photos/store-peroxide-tall-sm.webp", alt: "Pallets of 30 litre jerricans of technical grade hydrogen peroxide", cap: "Peroxide, 30 L sealed" },
          ].map((photo) => (
            <li key={photo.src} className="overflow-hidden rounded-2xl border border-line bg-surface">
              <img
                src={photo.src}
                alt={photo.alt}
                loading="lazy"
                decoding="async"
                className="aspect-square w-full object-cover"
                width={414}
                height={414}
              />
              <p className="px-3 py-2.5 text-xs font-bold text-muted">{photo.cap}</p>
            </li>
          ))}
        </ul>
      </Section>

      {/* The catalogue itself */}
      <Section tone="wash" className="pt-0">
        <h2 className="sr-only">Product catalogue</h2>
        <Catalogue />
      </Section>

      {/* Mix kits */}
      <Section id="mix-kits" className="scroll-mt-32">
        <SectionHeading
          eyebrow="Mix kits"
          title="The recipe, weighed out for you"
          lead="A mix kit is not a product on a shelf — it is your recipe, measured. You get every chemical for one batch, in the right quantity, so you can mix it yourself without buying a full pack of each ingredient."
        />
        <ol className="mt-8 grid gap-5 md:grid-cols-3">
          {MIX_KIT_STEPS.map((step) => (
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

        <div className="mt-8 rounded-2xl border border-line bg-surface p-5">
          <h3 className="text-base font-extrabold">Kits we put together most often</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Any of the finished products above can be supplied as a kit instead — dishwashing
            liquid, laundry soap, handwash, shower gel, shampoo, fabric softener, bleach,
            disinfectant, toilet cleaner, degreaser and carwash shampoo. Batch sizes and prices
            depend on what you are making, so tell us the product and the quantity.
          </p>
          <CtaLink href={WA_MIX_KIT} tone="whatsapp" className="mt-4">
            <WhatsAppIcon />
            Ask for a mix kit
          </CtaLink>
        </div>
      </Section>

      <Section tone="surface">
        <div className="max-w-3xl space-y-3 text-xs leading-relaxed text-muted">
          <p>
            <strong className="text-ink">About the descriptions.</strong> The uses given above
            are general guidance to help you find the right shelf, not a specification or a
            safety data sheet. Grades and strengths vary — confirm with us before you order,
            and follow the handling advice for anything you have not used before.
          </p>
          <p>
            <strong className="text-ink">About the brand names.</strong> Names such as Harpic,
            Dettol and Jik are used only to describe the type of product a cleaner is
            comparable to. They are the trade marks of their respective owners, and the
            products we mix are our own, not theirs.
          </p>
        </div>
      </Section>
    </>
  );
}
