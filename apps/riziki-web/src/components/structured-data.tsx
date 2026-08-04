import { BUSINESS, SITE_URL } from "@/lib/business";
import { CATEGORIES } from "@/lib/catalogue";

/**
 * `LocalBusiness` structured data.
 *
 * Only facts we actually hold go in here. The street address, geo coordinates
 * and opening hours are deliberately absent rather than guessed: a wrong
 * address in structured data sends customers to the wrong door, and Google
 * treats a mismatch against Google Business Profile as a trust signal against
 * the listing. Add them here the moment the owner confirms them.
 */
export function LocalBusinessJsonLd() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": `${SITE_URL}/#business`,
    name: BUSINESS.name,
    slogan: BUSINESS.tagline,
    description:
      "Supplier of industrial and detergent-making chemicals in Nairobi, Kenya. Raw chemicals in bulk and repacked quantities, finished cleaning products, and measured mix kits.",
    url: SITE_URL,
    telephone: BUSINESS.phoneE164,
    address: {
      "@type": "PostalAddress",
      addressLocality: BUSINESS.city,
      addressCountry: "KE",
    },
    areaServed: {
      "@type": "AdministrativeArea",
      name: `${BUSINESS.city}, ${BUSINESS.country}`,
    },
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "Chemicals and cleaning products",
      itemListElement: CATEGORIES.map((category) => ({
        "@type": "OfferCatalog",
        name: category.name,
        description: category.blurb,
      })),
    },
  };

  return (
    <script
      type="application/ld+json"
      // Escaping `<` keeps a stray tag in the data from closing the script early.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
    />
  );
}
