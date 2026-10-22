/* ---------------------------------------------------------------------------
   The visual wall — what the home page shows instead of telling.

   A portfolio full of pretty landing pages reads as "I can make things look
   nice", which every template shop also claims. What cannot be faked is a
   screen out of a system that is actually running someone's business: the
   admin, the money, the thing that happens after the customer pays.
   So every `proof` shot below is deliberately one of the unglamorous ones.

   Captions are in the CLIENT'S language, never the stack's. "Sells tickets and
   scans them at the gate without internet" is the thing a theatre owner is
   buying. "Laravel 13 modular monolith" is for the case study, which is still
   there, one click away, for the people who want it.

   A slab has to earn its place: either screens captured from the running
   system (64 Theatre, Fit Generations) or a product's own UI (SMP Credits).
   What does not get one is a project represented by a single marketing shot —
   those stay in the mosaic below. Better a smaller wall that is all substance
   than a long one padded out with front pages.
--------------------------------------------------------------------------- */

export type Shot = {
  src: string;
  alt: string;
  /** One line, under the image. What this screen proves. */
  caption: string;
  width: number;
  height: number;
  /** Render in a phone frame rather than a browser frame. */
  phone?: boolean;
};

export type Showcase = {
  /** Matches a Project slug, so the case study is one click away. */
  slug: string;
  client: string;
  /** The single sentence. What it does for the business, not how. */
  outcome: string;
  live: string;
  liveLabel: string;
  hero: Shot;
  proof: Shot[];
};

export const showcase: Showcase[] = [
  {
    slug: "64-theatre",
    client: "64 Theatre",
    outcome: "Sells tickets online, takes M-Pesa, and scans guests in at the gate when the venue's internet drops.",
    live: "https://tickets.64theatre.art",
    liveLabel: "tickets.64theatre.art",
    hero: {
      src: "/screens/64theatre-home.webp",
      alt: "64 Theatre — what's on, with a show playing across the hero",
      caption: "What a buyer sees",
      width: 1440,
      height: 900,
    },
    proof: [
      {
        src: "/screens/64theatre-performances.webp",
        alt: "The admin: a performance with its ticket types and prices",
        caption: "Every show, every price, set by the theatre",
        width: 1300,
        height: 1200,
      },
      {
        src: "/screens/64theatre-settings.webp",
        alt: "Settings: taking money, what it costs, selling on commission, server",
        caption: "Every money setting on one screen",
        width: 1400,
        height: 1150,
      },
      {
        src: "/screens/64theatre-referrals.webp",
        alt: "The commission settings for public sellers",
        caption: "Anyone can sell a ticket and earn on it",
        width: 1400,
        height: 1150,
      },
    ],
  },
  {
    slug: "fit-generations",
    client: "Fit Generations Gym",
    outcome: "Members join, pay by M-Pesa — in full or in instalments — and the gym sees exactly what came in and what it spent.",
    live: "https://fitgenerationsgym.com",
    liveLabel: "fitgenerationsgym.com",
    hero: {
      src: "/screens/fitgen-dashboard.webp",
      alt: "The gym's dashboard: money in, money out, what is still owed",
      caption: "Money in, money out, still owed — one screen",
      width: 1600,
      height: 1222,
    },
    proof: [
      {
        src: "/screens/fitgen-partpay-mobile.webp",
        alt: "A member choosing to pay part of an invoice on their phone",
        caption: "Pay in full, or pay part of it",
        width: 760,
        height: 1645,
        phone: true,
      },
      {
        src: "/screens/fitgen-invoice.webp",
        alt: "An invoice showing paid so far and the balance still to go",
        caption: "Balance carried — access waits until it clears",
        width: 1600,
        height: 1125,
      },
      {
        src: "/screens/fitgen-expenses.webp",
        alt: "The expenses ledger with a breakdown of where the month's money went",
        caption: "Rent, wages, power — where the month went",
        width: 1600,
        height: 1222,
      },
    ],
  },
  {
    slug: "smp-credits",
    client: "SMP Credits",
    outcome: "Lending that runs on M-Pesa: the office sees the whole loan book, and the member repays from their phone in seconds.",
    live: "https://smpcredits.co.ke",
    liveLabel: "smpcredits.co.ke",
    hero: {
      src: "/mockups/smp-credits-admin.webp",
      alt: "SMP Credits admin — outstanding loan book, work queues and lending versus collections",
      caption: "The loan book, split into principal, interest and fees",
      width: 1600,
      height: 1156,
    },
    proof: [
      {
        src: "/mockups/thumbs/smp-credits-member.webp",
        alt: "SMP Credits member app — loan balance, savings and M-Pesa repayment",
        caption: "What the member sees, and repays from",
        width: 800,
        height: 500,
      },
      {
        src: "/mockups/thumbs/smp-credits-reports.webp",
        alt: "SMP Credits admin — reports",
        caption: "Reports the office can hand to a board",
        width: 800,
        height: 500,
      },
      {
        src: "/mockups/thumbs/smp-credits-android.webp",
        alt: "SMP Credits on Android — member home screen",
        caption: "Same product, shipped to Android",
        width: 700,
        height: 1244,
        phone: true,
      },
    ],
  },
];

export const showcaseSlugs = new Set(showcase.map((s) => s.slug));
