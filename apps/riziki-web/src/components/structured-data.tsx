import { BUSINESS, SITE_URL } from "@/lib/business";
import { CATEGORIES } from "@/lib/catalogue";

/**
 * `LocalBusiness` structured data.
 *
 * Only facts we actually hold go in here — the address and opening hours are
 * the owner's own, confirmed 4 Aug 2026. They must stay byte-identical with
 * the visible pages and (once created) the Google Business Profile: Google
 * treats a mismatch as a trust signal against the listing.
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
      streetAddress: `${BUSINESS.address.building}, ${BUSINESS.address.street}`,
      addressLocality: BUSINESS.city,
      addressCountry: "KE",
    },
    openingHoursSpecification: {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
      opens: "08:00",
      closes: "18:00",
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
