/**
 * The shop's real, verified details in one place.
 *
 * Name, phone and location must be byte-identical everywhere they appear —
 * on the page, in the JSON-LD and in any directory listing — or search engines
 * treat them as two different businesses and the local ranking splits.
 */

export const BUSINESS = {
  name: "Riziki Industrial Chemicals",
  tagline: "Your home of Industrial Chemicals",
  /** Human-readable form, as it should be dialled locally. */
  phoneDisplay: "+254 723 496 434",
  /** E.164, for tel: links and structured data. */
  phoneE164: "+254723496434",
  /** wa.me wants the number with no plus and no spaces. */
  whatsappNumber: "254723496434",
  city: "Nairobi",
  country: "Kenya",
} as const;

/**
 * Canonical origin. The site is a static export, so this cannot be read from a
 * request — it is baked in at build time and must be updated when the client's
 * real domain is registered.
 */
export const SITE_URL = "https://rizikichemicals.co.ke";

export const telHref = `tel:${BUSINESS.phoneE164}`;

/**
 * Build a WhatsApp deep link with the message already typed.
 *
 * The shop takes almost all of its orders on WhatsApp, so every call to action
 * on the site ends here. Pre-filling removes the "what do I even say" pause
 * that loses an enquiry.
 */
export function whatsappHref(message: string): string {
  return `https://wa.me/${BUSINESS.whatsappNumber}?text=${encodeURIComponent(message)}`;
}

/** Default opener used by the header, hero and footer buttons. */
export const WA_GENERAL = whatsappHref(
  `Hello ${BUSINESS.name}, I would like to make an enquiry about your chemicals.`,
);

export const WA_PRICE_LIST = whatsappHref(
  `Hello ${BUSINESS.name}, please send me your current price list.`,
);

export const WA_MIX_KIT = whatsappHref(
  `Hello ${BUSINESS.name}, I would like a mix kit. Product: ______. Batch size: ______.`,
);

/** Enquiry about one catalogue item, opened from the product cards. */
export function whatsappForItem(itemName: string): string {
  return whatsappHref(
    `Hello ${BUSINESS.name}, I would like to ask about ${itemName}. Quantity needed: ______.`,
  );
}
