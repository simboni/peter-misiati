import Link from "next/link";
import type { Metadata } from "next";
import { Container, SectionHeading } from "@/components/ui";
import { Reveal } from "@/components/reveal";
import { ProductIcon, ArrowRightIcon } from "@/components/icons";
import { personalProducts, businessProducts, type Product } from "@/lib/products";

export const metadata: Metadata = {
  title: "Insurance Products in Kenya — Motor, Medical, Life, Business & More",
  description:
    "Explore motor, medical, life, WIBA, business, home, travel, agriculture and pension covers — compared across Kenya's leading IRA-licensed underwriters.",
};

function ProductGrid({ items }: { items: Product[] }) {
  return (
    <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((p, i) => (
        <Reveal key={p.slug} delay={Math.min(i * 60, 240)}>
          <Link
            href={`/products/${p.slug}/`}
            className="group flex h-full flex-col rounded-2xl border border-paper-300 bg-paper-50 p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-navy-400 hover:shadow-md"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-navy-50 text-navy-600 transition group-hover:bg-navy-900 group-hover:text-cta-400">
              <ProductIcon name={p.icon} className="h-6 w-6" />
            </span>
            <h3 className="mt-4 font-display text-lg font-bold text-slate-900">{p.name}</h3>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-500">{p.tagline}</p>
            {p.fromNote ? (
              <p className="mt-3 text-xs font-semibold text-good-600">{p.fromNote}</p>
            ) : null}
            <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-navy-600 transition group-hover:gap-2.5">
              Details & quote <ArrowRightIcon className="h-4 w-4" />
            </span>
          </Link>
        </Reveal>
      ))}
    </div>
  );
}

export default function ProductsPage() {
  return (
    <>
      <section className="bg-navy-950 py-14 sm:py-20">
        <Container>
          <SectionHeading
            eyebrow="Products"
            title="Covers for every season of life"
            lead="Every product below is compared across multiple IRA-licensed underwriters before we recommend anything. Tap a cover to see what's included, what's not, and what it takes to claim."
            align="left"
            dark
          />
        </Container>
      </section>
      <section className="py-14 sm:py-20">
        <Container>
          <h2 className="font-display text-2xl font-bold text-slate-900">
            For you & your family
          </h2>
          <ProductGrid items={personalProducts} />
          <h2 className="mt-16 font-display text-2xl font-bold text-slate-900">
            For your business
          </h2>
          <ProductGrid items={businessProducts} />
        </Container>
      </section>
    </>
  );
}
