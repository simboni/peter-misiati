import { Suspense } from "react";
import type { Metadata } from "next";
import { Container } from "@/components/ui";
import { QuoteForm } from "@/components/quote-form";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Get a Free Insurance Quote in Kenya",
  description: `Request motor, medical, life, WIBA or business insurance quotes in about 2 minutes. ${site.quotePromise} from Kenya's leading underwriters.`,
};

export default function QuotePage() {
  return (
    <>
      <section className="bg-navy-950 py-12 sm:py-16">
        <Container className="text-center">
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Get your free quote
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-navy-200">
            Answer a few questions and we&apos;ll compare Kenya&apos;s leading
            underwriters for you. Free, fast, and zero obligation.
          </p>
        </Container>
      </section>
      <section className="py-12 sm:py-16">
        <Container>
          {/* useSearchParams (product deep-links) requires a Suspense boundary */}
          <Suspense fallback={null}>
            <QuoteForm />
          </Suspense>
        </Container>
      </section>
    </>
  );
}
