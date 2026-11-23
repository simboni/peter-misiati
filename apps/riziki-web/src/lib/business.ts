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
  /** Confirmed by the owner, 4 Aug 2026. */
  address: {
    building: "Obedi House, Ground Floor, Room A26",
    street: "Ronald Ngara Street",
    area: "Nairobi CBD",
    /** One line, for footers and print. */
    display: "Obedi House, Ground Floor, Room A26 — Ronald Ngara Street, Nairobi CBD",
  },
  hours: {
    days: "Monday – Saturday",
    open: "8:00 am",
    close: "6:00 pm",
    closedOn: "Sunday & public holidays",
  },
  /** Lipa na M-Pesa Buy Goods till, as posted at the counter. */
  mpesaTill: "4373016",
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
export function whatsappHref(message: string, source?: string): string {
  const text = source ? `${message}\n\nRef: ${source}` : message;
  return `https://wa.me/${BUSINESS.whatsappNumber}?text=${encodeURIComponent(text)}`;
}

/**
 * WHERE A LEAD CAME FROM, CARRIED IN THE MESSAGE ITSELF.
 *
 * Every enquiry this site produces arrives as a WhatsApp message, and wa.me
 * has nowhere to put anything but the message. No query string survives, no
 * referrer reaches the shop's phone, and analytics stops dead at the tap.
 * Without a mark in the text, a lead from the Ungerol page, a lead from a
 * price-list button and a lead from a Facebook post all arrive looking
 * identical — so there is no way to tell which page or post is worth more,
 * and no way to judge anything spent on either.
 *
 * So the source rides along as a short last line. It reads as a reference
 * because that is what it is, customers are used to seeing one, and the shop
 * reads it off the first message without asking anybody where they heard
 * about it. Keep the codes short and stable: they are the join between what
 * the website records and what the shop actually receives.
 */
const opener = `Hello ${BUSINESS.name},`;

/** The general enquiry, from the header, hero, footer and 404. */
export const waGeneral = (source: string) =>
  whatsappHref(`${opener} I would like to make an enquiry about your chemicals.`, source);

/** The price list, which is the single most asked-for thing on the site. */
export const waPriceList = (source: string) =>
  whatsappHref(`${opener} please send me your current price list.`, source);

/** A made-up batch rather than raw chemicals. */
export const waMixKit = (source: string) =>
  whatsappHref(`${opener} I would like a mix kit. Product: ______. Batch size: ______.`, source);

/** Enquiry about one catalogue item, opened from the product cards. */
export function whatsappForItem(itemName: string, source = "product"): string {
  return whatsappHref(
    `${opener} I would like to ask about ${itemName}. Quantity needed: ______.`,
    source,
  );
}
