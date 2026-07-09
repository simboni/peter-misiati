// Plan / subscription constants and helpers. Client-safe — no server imports.
//
// Tally is free and multi-vendor: anyone can sign up and run their whole billing
// cycle at no cost. Free documents carry a small "Powered by Tally" mark and use
// the default Tally look. The paid **Pro** plan is white-label — the vendor's own
// logo, template and accent colour, with the Tally mark removed — so the app
// reads as their own. Pro is priced per user / month.

export const PLAN_FREE = "free";
export const PLAN_PRO = "pro";

/** Monthly price per user (seat) on the Pro plan, in whole KES. */
export const PRICE_PER_SEAT_KES = 1000;

export function isPro(plan?: string | null): boolean {
  return plan === PLAN_PRO;
}

/** Monthly Pro price for a given seat count, in whole KES. */
export function monthlyPriceKes(seats: number): number {
  return Math.max(1, seats) * PRICE_PER_SEAT_KES;
}

export function formatKes(whole: number): string {
  return `KES ${whole.toLocaleString("en-KE")}`;
}

/** What upgrading to Pro unlocks — shown on the upgrade page and marketing. */
export const PRO_FEATURES: string[] = [
  "AI invoice creation — describe the job, get a ready invoice (coming soon)",
  "Your own logo on every document",
  "Remove the “Powered by TallyPay” mark",
  "Choose from 5 invoice templates",
  "Pick your brand accent colour",
  "Custom branding on invoices & emails",
  "Your own M-Pesa (Kopo Kopo) account",
];

/** The headline Pro feature — highlighted on marketing + in-app teasers. */
export const PRO_HERO_FEATURE = {
  title: "AI invoice creation",
  blurb:
    "Describe the work in plain language — “website + 1-year hosting for Acme, 50% deposit” — and TallyPay drafts the whole invoice: line items, VAT and totals. Coming soon on Pro.",
  badge: "Coming soon",
};
