import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Container, btnPrimary, btnWhatsApp, Card } from "@/components/ui";
import { Reveal } from "@/components/reveal";
import { FaqList } from "@/components/faq-list";
import {
  ProductIcon,
  ArrowRightIcon,
  CheckIcon,
  XIcon,
  DocumentIcon,
  WhatsAppIcon,
} from "@/components/icons";
import { products, getProduct } from "@/lib/products";
import { underwriters } from "@/lib/content";
import { site, siteUrl, waLink } from "@/lib/site";

export function generateStaticParams() {
  return products.map((p) => ({ slug: p.slug }));
}

// Next 16: params is a Promise and must be awaited.
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = getProduct(slug);
  if (!product) return {};
  return {
    title: `${product.name} in Kenya — Compare Quotes`,
    description: `${product.tagline} Compare ${product.name.toLowerCase()} quotes from Kenya's leading underwriters with ${site.name}.`,
  };
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const product = getProduct(slug);
  if (!product) notFound();

  const quoteHref = `/quote/?product=${product.slug}`;
  const wa = waLink(
    `Hello SMP Insurance, I'd like a quote for ${product.name.toLowerCase()}.`,
  );

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Service",
      serviceType: product.name,
      description: product.tagline,
      areaServed: "Kenya",
      provider: { "@type": "InsuranceAgency", name: site.name, url: siteUrl },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: product.faqs.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
        { "@type": "ListItem", position: 2, name: "Products", item: `${siteUrl}/products/` },
        { "@type": "ListItem", position: 3, name: product.name, item: `${siteUrl}/products/${product.slug}/` },
      ],
    },
  ];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Hero */}
      <section className="bg-navy-950 py-14 sm:py-20">
        <Container>
          <nav aria-label="Breadcrumb" className="text-xs font-semibold text-navy-300">
            <Link href="/" className="hover:text-white">Home</Link>
            <span aria-hidden> / </span>
            <Link href="/products/" className="hover:text-white">Products</Link>
            <span aria-hidden> / </span>
            <span className="text-white">{product.name}</span>
          </nav>
          <div className="mt-6 flex items-start gap-5">
            <span className="hidden h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-cta-400 sm:flex">
              <ProductIcon name={product.icon} className="h-8 w-8" />
            </span>
            <div>
              <h1 className="font-display text-3xl font-extrabold tracking-tight text-white sm:text-5xl">
                {product.name}
              </h1>
              <p className="mt-4 max-w-2xl text-lg leading-relaxed text-navy-200">
                {product.tagline}
              </p>
              {product.fromNote ? (
                <p className="mt-3 inline-block rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-sm font-semibold text-cta-300">
                  {product.fromNote}
                </p>
              ) : null}
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Link href={quoteHref} className={btnPrimary}>
                  Get a quote <ArrowRightIcon className="h-5 w-5" />
                </Link>
                <a href={wa} target="_blank" rel="noopener noreferrer" className={btnWhatsApp}>
                  <WhatsAppIcon className="h-5 w-5" /> Ask on WhatsApp
                </a>
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* Summary */}
      <section className="py-12 sm:py-16">
        <Container className="max-w-3xl">
          <p className="text-lg leading-relaxed text-slate-700">{product.summary}</p>
        </Container>
      </section>

      {/* Covered / not covered */}
      <section className="pb-12 sm:pb-16">
        <Container>
          <div className="grid gap-4 lg:grid-cols-2">
            <Reveal>
              <Card className="h-full border-good-500/25">
                <h2 className="font-display text-xl font-bold text-slate-900">
                  What&apos;s covered
                </h2>
                <ul className="mt-5 space-y-3">
                  {product.covered.map((item) => (
                    <li key={item} className="flex items-start gap-3 text-sm leading-relaxed text-slate-700">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-good-500/10 text-good-600">
                        <CheckIcon className="h-3 w-3" />
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </Card>
            </Reveal>
            <Reveal delay={80}>
              <Card className="h-full">
                <h2 className="font-display text-xl font-bold text-slate-900">
                  What&apos;s typically not covered
                </h2>
                <ul className="mt-5 space-y-3">
                  {product.notCovered.map((item) => (
                    <li key={item} className="flex items-start gap-3 text-sm leading-relaxed text-slate-700">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-bad-500/10 text-bad-500">
                        <XIcon className="h-3 w-3" />
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
                <p className="mt-5 rounded-xl bg-paper-200 px-4 py-3 text-xs leading-relaxed text-slate-500">
                  Exclusions vary by underwriter — we walk you through the exact
                  policy wording before you commit. No surprises at claim time.
                </p>
              </Card>
            </Reveal>
          </div>
        </Container>
      </section>

      {/* Options / tiers */}
      {product.options ? (
        <section className="bg-paper-200 py-14 sm:py-20">
          <Container>
            <h2 className="text-center font-display text-2xl font-bold text-slate-900 sm:text-3xl">
              {product.options.title}
            </h2>
            {product.options.note ? (
              <p className="mx-auto mt-3 max-w-xl text-center text-sm text-slate-500">
                {product.options.note}
              </p>
            ) : null}
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {product.options.tiers.map((tier, i) => (
                <Reveal key={tier.name} delay={i * 80}>
                  <Card className={`h-full ${i === product.options!.tiers.length - 1 ? "border-navy-500 ring-1 ring-navy-500/30" : ""}`}>
                    <h3 className="font-display text-lg font-bold text-navy-900">{tier.name}</h3>
                    <ul className="mt-4 space-y-2.5">
                      {tier.points.map((pt) => (
                        <li key={pt} className="flex items-start gap-2.5 text-sm leading-relaxed text-slate-700">
                          <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-good-600" />
                          {pt}
                        </li>
                      ))}
                    </ul>
                  </Card>
                </Reveal>
              ))}
            </div>
          </Container>
        </section>
      ) : null}

      {/* Documents + claims */}
      <section className="py-14 sm:py-20">
        <Container>
          <div className="grid gap-10 lg:grid-cols-[1fr_1.3fr]">
            <div>
              <h2 className="flex items-center gap-3 font-display text-2xl font-bold text-slate-900">
                <DocumentIcon className="h-6 w-6 text-navy-500" />
                What you&apos;ll need to buy
              </h2>
              <ul className="mt-6 space-y-3">
                {product.documents.map((doc) => (
                  <li key={doc} className="flex items-start gap-3 rounded-xl border border-paper-300 bg-paper-50 px-4 py-3 text-sm text-slate-700">
                    <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-navy-500" />
                    {doc}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-slate-500">
                Send documents by WhatsApp — no office visit needed.
              </p>
            </div>
            <div id="how-claims-work" className="scroll-mt-28">
              <h2 className="font-display text-2xl font-bold text-slate-900">
                How claims work
              </h2>
              <ol className="mt-6 space-y-0">
                {product.claimSteps.map((step, i) => (
                  <li key={step} className="relative flex gap-4 pb-6 last:pb-0">
                    {i < product.claimSteps.length - 1 ? (
                      <span aria-hidden className="absolute left-[15px] top-9 h-full w-px bg-paper-400" />
                    ) : null}
                    <span className="z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-900 font-display text-sm font-extrabold text-cta-400">
                      {i + 1}
                    </span>
                    <p className="pt-1 text-sm leading-relaxed text-slate-700">{step}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </Container>
      </section>

      {/* Underwriters */}
      <section className="border-y border-paper-300 bg-paper-200 py-10">
        <Container>
          <p className="text-center text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
            Underwriters we place this cover with include
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2.5">
            {underwriters.slice(0, 8).map((u) => (
              <span key={u} className="rounded-full border border-paper-400 bg-paper-50 px-4 py-1.5 text-sm font-bold text-navy-700">
                {u}
              </span>
            ))}
          </div>
        </Container>
      </section>

      {/* FAQs */}
      <section className="py-14 sm:py-20">
        <Container className="max-w-3xl">
          <h2 className="text-center font-display text-2xl font-bold text-slate-900 sm:text-3xl">
            {product.navLabel} questions, answered
          </h2>
          <div className="mt-8">
            <FaqList faqs={product.faqs} />
          </div>
        </Container>
      </section>

      {/* CTA */}
      <section className="bg-navy-900 py-14 sm:py-16">
        <Container className="text-center">
          <h2 className="mx-auto max-w-2xl font-display text-3xl font-extrabold tracking-tight text-white">
            Ready to compare {product.navLabel.toLowerCase()} quotes?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-navy-200">
            {site.quotePromise} — free, and with zero obligation to buy.
          </p>
          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href={quoteHref} className={btnPrimary}>
              Get my quote <ArrowRightIcon className="h-5 w-5" />
            </Link>
            <a href={wa} target="_blank" rel="noopener noreferrer" className={btnWhatsApp}>
              <WhatsAppIcon className="h-5 w-5" /> WhatsApp us
            </a>
          </div>
        </Container>
      </section>
    </>
  );
}
