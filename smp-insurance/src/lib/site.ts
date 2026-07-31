/**
 * SMP Insurance Agency — single source of truth for brand + contact details.
 *
 * ⚠️ PLACEHOLDERS: every value marked TODO must be replaced with the client's
 * real details before going live (phone, WhatsApp, email, address, IRA
 * licence number, domain, social links). Nothing else in the codebase
 * hard-codes these — change them here and the whole site updates, including
 * the WhatsApp links, tel: links, JSON-LD and metadata.
 */

export const site = {
  name: "SMP Insurance Agency",
  shortName: "SMP Insurance",
  legalName: "SMP Insurance Agency",
  domain: "smpinsurance.co.ke", // TODO: real domain
  tagline: "Insurance that shows up when it matters",
  description:
    "SMP Insurance Agency is an IRA-licensed insurance agency in Nairobi, Kenya. We compare motor, medical, life, business and travel covers from Kenya's leading underwriters, handle the paperwork, and fight for your claims.",

  // ── Contact (TODO: replace with the client's real details) ──────────────
  phone: "+254 700 000 000", // TODO
  phoneHref: "+254700000000", // TODO — digits only, used in tel: links
  whatsapp: "254700000000", // TODO — international format, no plus sign
  email: "cover@smpinsurance.co.ke", // TODO
  address: {
    street: "Insurance House, 3rd Floor, Moi Avenue", // TODO
    city: "Nairobi",
    country: "Kenya",
    poBox: "P.O. Box 00000-00100, Nairobi", // TODO
  },
  hours: "Mon–Fri 8:00am–6:00pm · Sat 9:00am–1:00pm",
  hoursSchema: ["Mo-Fr 08:00-18:00", "Sa 09:00-13:00"],

  // ── Credentials ─────────────────────────────────────────────────────────
  iraLicence: "IRA/05/00000/2026", // TODO: real IRA licence number
  quotePromise: "Quotes within 2 working hours",

  // ── Socials (TODO: real profiles, or remove) ────────────────────────────
  socials: {
    facebook: "https://facebook.com/smpinsurance",
    x: "https://x.com/smpinsurance",
    linkedin: "https://linkedin.com/company/smpinsurance",
    instagram: "https://instagram.com/smpinsurance",
  },
} as const;

export const siteUrl = `https://${site.domain}`;

/** Build a wa.me link with a pre-filled message. */
export function waLink(message: string): string {
  return `https://wa.me/${site.whatsapp}?text=${encodeURIComponent(message)}`;
}

export const defaultWaMessage =
  "Hello SMP Insurance, I'd like a quote please.";
