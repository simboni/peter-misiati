import type { Metadata } from "next";
import Link from "next/link";
import { BUSINESS, telHref, WA_GENERAL } from "@/lib/business";
import { Container, CtaLink, PhoneIcon, WhatsAppIcon } from "@/components/ui";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

/**
 * A dead link should still end in an order. The most likely reason someone
 * lands here is a mistyped or stale product URL, so point them at the
 * catalogue and the phone rather than at nothing.
 */
export default function NotFound() {
  return (
    <Container className="py-20 text-center sm:py-28">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-accent">Error 404</p>
      <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
        We could not find that page
      </h1>
      <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted">
        The link may be out of date. Everything we sell is on the products page — or just call
        us and tell us what you need.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <CtaLink href="/products/" tone="brand">
          Go to the catalogue
        </CtaLink>
        <CtaLink href={WA_GENERAL} tone="whatsapp">
          <WhatsAppIcon />
          WhatsApp us
        </CtaLink>
        <CtaLink href={telHref} tone="outline">
          <PhoneIcon />
          {BUSINESS.phoneDisplay}
        </CtaLink>
      </div>
      <p className="mt-8 text-sm text-muted">
        Or start again from the{" "}
        <Link href="/" className="font-bold text-accent hover:underline">
          home page
        </Link>
        .
      </p>
    </Container>
  );
}
