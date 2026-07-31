import Link from "next/link";
import type { Metadata } from "next";
import { Container, SectionHeading, btnPrimary } from "@/components/ui";
import { FaqList } from "@/components/faq-list";
import { ArrowRightIcon } from "@/components/icons";
import { generalFaqs } from "@/lib/content";
import { products } from "@/lib/products";

export const metadata: Metadata = {
  title: "Insurance FAQ — Honest Answers for Kenya",
  description:
    "How agencies are paid, IRA regulation, premium instalments, digital motor certificates, claims escalation and more — answered plainly.",
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: generalFaqs.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
};

export default function FaqPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <section className="bg-navy-950 py-14 sm:py-20">
        <Container>
          <SectionHeading
            eyebrow="FAQ"
            title="Straight answers, no fine print"
            lead="The questions Kenyans actually ask us — answered the way we'd answer a friend. Product-specific questions live on each product page."
            align="left"
            dark
          />
        </Container>
      </section>
      <section className="py-14 sm:py-20">
        <Container className="max-w-3xl">
          <FaqList faqs={generalFaqs} />
          <div className="mt-12">
            <h2 className="font-display text-lg font-bold text-slate-900">
              Product-specific questions
            </h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {products.map((p) => (
                <Link
                  key={p.slug}
                  href={`/products/${p.slug}/`}
                  className="rounded-full border border-paper-400 bg-paper-50 px-4 py-2 text-sm font-bold text-navy-700 transition hover:border-navy-400 hover:bg-navy-50"
                >
                  {p.navLabel} FAQ
                </Link>
              ))}
            </div>
          </div>
          <div className="mt-12 rounded-2xl bg-navy-900 p-8 text-center">
            <h2 className="font-display text-xl font-bold text-white">
              Still unsure? That&apos;s what we&apos;re for.
            </h2>
            <div className="mt-5 flex justify-center">
              <Link href="/quote/" className={btnPrimary}>
                Ask us for a quote <ArrowRightIcon className="h-5 w-5" />
              </Link>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
