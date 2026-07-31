"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { WhatsAppIcon } from "@/components/icons";
import { getProduct } from "@/lib/products";
import { waLink, defaultWaMessage } from "@/lib/site";

/** Pre-fill the WhatsApp message with the product the visitor is reading. */
function messageForPath(pathname: string): string {
  const match = pathname.match(/^\/products\/([^/]+)/);
  if (match) {
    const product = getProduct(match[1]);
    if (product) {
      return `Hello SMP Insurance, I'd like a quote for ${product.name.toLowerCase()}.`;
    }
  }
  if (pathname.startsWith("/claims")) {
    return "Hello SMP Insurance, I need help with a claim.";
  }
  return defaultWaMessage;
}

/**
 * Two always-available conversion paths:
 *  1. A floating WhatsApp button (all viewports).
 *  2. A sticky bottom bar on mobile — Get Quote + WhatsApp — that appears
 *     once the visitor scrolls past the hero.
 */
export function FloatingCta() {
  const pathname = usePathname() ?? "/";
  const [showBar, setShowBar] = useState(false);

  useEffect(() => {
    const onScroll = () => setShowBar(window.scrollY > 480);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const wa = waLink(messageForPath(pathname));
  const onQuotePage = pathname.startsWith("/quote");

  return (
    <>
      <a
        href={wa}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Chat with us on WhatsApp"
        className={`fixed right-4 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-xl shadow-black/20 transition hover:scale-105 ${
          showBar ? "bottom-24 md:bottom-6" : "bottom-6"
        }`}
      >
        <WhatsAppIcon className="h-7 w-7" />
      </a>

      {!onQuotePage ? (
        <div
          className={`fixed inset-x-0 bottom-0 z-30 border-t border-paper-300 bg-paper-50/95 p-3 backdrop-blur transition-transform duration-300 md:hidden ${
            showBar ? "translate-y-0" : "translate-y-full"
          }`}
        >
          <div className="mx-auto flex max-w-md gap-2">
            <Link
              href="/quote/"
              className="inline-flex flex-1 items-center justify-center rounded-xl bg-cta-500 px-4 py-3 font-display text-sm font-bold text-navy-950"
            >
              Get a Quote
            </Link>
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 py-3 font-display text-sm font-bold text-[#073b1c]"
            >
              <WhatsAppIcon className="h-4 w-4" /> WhatsApp
            </a>
          </div>
        </div>
      ) : null}
    </>
  );
}
