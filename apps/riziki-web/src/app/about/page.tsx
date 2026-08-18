import type { Metadata } from "next";
import { BUSINESS, telHref, WA_GENERAL } from "@/lib/business";
import {
  Card,
  Container,
  CtaLink,
  PhoneIcon,
  Section,
  SectionHeading,
  WhatsAppIcon,
} from "@/components/ui";
import { openGraphFor } from "@/lib/seo";

export const metadata: Metadata = {
  title: "About us",
  description:
    "Riziki Industrial Chemicals is a Nairobi chemical supplier serving both people who mix their own cleaning products and people who want the finished product. Right chemical, right grade, measured properly.",
  alternates: { canonical: "/about/" },
  openGraph: openGraphFor({
    title: `About ${BUSINESS.name}`,
    description:
      "A Nairobi chemical supplier serving both people who mix their own cleaning products and people who want the finished product.",
    path: "/about/",
  }),
};

const WHY_SPECIALIST = [
  {
    title: "The right chemical",
    body: "Half the trouble people have with a batch comes from buying something that looks similar but does a different job. Caustic soda is not soda ash. Fine salt is not industrial salt. Tell us what you are making and we will point you at what actually belongs in it.",
  },
  {
    title: "The right grade",
    body: "The same chemical name covers several grades and strengths, and they are not interchangeable. Buying from a shop that only sells chemicals means someone can tell you which one your recipe needs before you pay for it.",
  },
  {
    title: "Measured properly",
    body: "Detergent recipes are ratios. Guessing a quantity because that is the pack size available is how a batch ends up thin, cloudy or too harsh. We weigh out what you ask for, so your ratios hold.",
  },
  {
    title: "One place, whole list",
    body: "A recipe usually needs six or eight different things. Getting them from one counter — and being able to ask about all of them at once — is faster and cheaper than chasing them across town.",
  },
];

export default function AboutPage() {
  return (
    <>
      <div className="border-b border-line bg-surface">
        <Container className="py-12 sm:py-16">
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-accent">
            About us
          </p>
          <h1 className="max-w-3xl text-3xl font-extrabold tracking-tight sm:text-4xl">
            A chemicals shop, not a general store
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
            {BUSINESS.name} trades in {BUSINESS.city} under one plain promise, the one painted
            on our own signboard: <strong className="text-ink">{BUSINESS.tagline}</strong>.
            Chemicals are what we know and all we sell.
          </p>
        </Container>
      </div>

      <Section>
        <div className="grid gap-8 md:grid-cols-[1.4fr_1fr]">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-extrabold tracking-tight">What we do</h2>
            <div className="mt-4 space-y-4 text-base leading-relaxed text-muted">
              <p>
                Our main trade is raw chemicals. We buy them in trade quantities — drums, bags
                and sacks — and sell them on either whole or repacked into the smaller amounts
                that a household mixer, a small workshop or a start-up brand can afford. That
                means the same shelf serves a factory buying a 250 kg drum of Ufacid and a woman
                buying 250 g of it to make dishwashing liquid for her shop.
              </p>
              <p>
                We also mix and sell finished cleaning products. Not everyone wants to make
                their own, and not every job is worth a batch. Handwash, shower gel, shampoo,
                laundry soap, bleach, disinfectant, toilet cleaner, fabric softener, degreaser
                and carwash shampoo come off our own mixing bench.
              </p>
              <p>
                Between those two sits the mix kit: the chemicals for one recipe, weighed out to
                the batch size you want, so you can mix it yourself without buying a whole pack
                of each ingredient. It is the way most people start.
              </p>
            </div>
          </div>

          <Card className="h-fit">
            <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-muted">
              Who we serve
            </h2>
            <ul className="mt-4 space-y-4 text-sm leading-relaxed">
              <li>
                <strong className="block">People who mix their own</strong>
                <span className="text-muted">
                  Small manufacturers, soap and detergent makers, salons, schools, hotels and
                  anyone building a product to sell.
                </span>
              </li>
              <li>
                <strong className="block">People who want it finished</strong>
                <span className="text-muted">
                  Households, offices, carwashes, cleaning contractors and shopkeepers buying
                  in bulk to fill their own bottles.
                </span>
              </li>
              <li>
                <strong className="block">People who are still learning</strong>
                <span className="text-muted">
                  Come with the product you want to make. We will talk you through what goes
                  into it before you spend anything.
                </span>
              </li>
            </ul>
          </Card>
        </div>
      </Section>

      <Section tone="surface">
        <SectionHeading
          eyebrow="Why it matters"
          title="Why buy from a specialist"
          lead="Chemicals bought casually cost more than they save — in wasted batches, in products that do not work, and sometimes in accidents."
        />
        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          {WHY_SPECIALIST.map((point) => (
            <Card key={point.title} className="bg-page">
              <h3 className="text-base font-extrabold tracking-tight">{point.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{point.body}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section>
        <SectionHeading
          eyebrow="Handling"
          title="Sold with the advice that should come with it"
          lead="Several of the products on our list are corrosive or strongly oxidising. They are safe to work with when they are treated properly, and dangerous when they are not."
        />
        <ul className="mt-6 max-w-2xl space-y-3 text-sm leading-relaxed text-muted">
          <li className="rounded-xl border border-line bg-surface p-4">
            Ask us how to store and handle anything you have not used before — that advice is
            part of the sale, not an extra.
          </li>
          <li className="rounded-xl border border-line bg-surface p-4">
            Never mix bleach or hypo with acid cleaners such as hydrochloric acid. The
            combination releases chlorine gas.
          </li>
          <li className="rounded-xl border border-line bg-surface p-4">
            When diluting caustic soda, add the caustic to the water — never water to caustic —
            and keep your face away from the container.
          </li>
          <li className="rounded-xl border border-line bg-surface p-4">
            Keep every chemical and finished product labelled, sealed and out of reach of
            children. Do not repack into drinks bottles.
          </li>
        </ul>
      </Section>

      <Section tone="wash">
        <SectionHeading
          eyebrow="Visit us"
          title="The shop itself"
          lead="Drums of Ungerol by the counter, the scale that weighs your order out, and shelves from bulk sacks down to 125 g packs — on Ronald Ngara Street in the CBD."
        />
        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          <figure className="overflow-hidden rounded-2xl border border-line bg-surface">
            <img
              src="/photos/shop-counter.jpeg"
              alt="The Riziki counter: yellow Ungerol drums, the weighing scale, and shelves of repacked chemicals behind"
              className="aspect-[3/4] w-full object-cover"
              loading="lazy"
              width={960}
              height={1280}
            />
            <figcaption className="p-3 text-xs text-muted">
              The counter — your order is weighed out here while you wait.
            </figcaption>
          </figure>
          <figure className="overflow-hidden rounded-2xl border border-line bg-surface">
            <img
              src="/photos/shop-store.jpeg"
              alt="Inside the shop: bulk drums, sacks of salt, and shelves of bottled finished products"
              className="aspect-[3/4] w-full object-cover"
              loading="lazy"
              width={960}
              height={1280}
            />
            <figcaption className="p-3 text-xs text-muted">
              Bulk in the store, small packs on the shelf — the same chemical either way.
            </figcaption>
          </figure>
        </div>

        <ul className="mt-5 grid grid-cols-3 gap-4">
          {[
            { src: "/photos/raw-drum-open.webp", alt: "An open drum of SLES, lined, ready to be weighed out", cap: "Opened and weighed to order" },
            { src: "/photos/labsa-pouring.webp", alt: "LABSA being decanted into a lined drum", cap: "Decanted from bulk" },
            { src: "/photos/salt-sacks.webp", alt: "Fifty-kilo sacks of industrial salt in a delivery van", cap: "Deliveries as they arrive" },
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
              <p className="px-3 py-2 text-[11px] font-bold leading-snug text-muted">{photo.cap}</p>
            </li>
          ))}
        </ul>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Card>
            <h3 className="text-sm font-extrabold">Where</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {BUSINESS.address.building}
              <br />
              {BUSINESS.address.street}, {BUSINESS.address.area}
            </p>
          </Card>
          <Card>
            <h3 className="text-sm font-extrabold">When</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {BUSINESS.hours.days}, {BUSINESS.hours.open} – {BUSINESS.hours.close}.
              <br />
              Closed {BUSINESS.hours.closedOn}.
            </p>
          </Card>
        </div>
      </Section>

      <div className="border-t border-line bg-brand text-white">
        <Container className="py-12 text-center sm:py-16">
          <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
            Come with a question, not just an order
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-white sm:text-base">
            If you are not sure what your recipe needs, ask. It costs nothing and it saves a
            wasted batch.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <CtaLink href={WA_GENERAL} tone="whatsapp">
              <WhatsAppIcon />
              Ask on WhatsApp
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
