# SMP Insurance Agency — Website

A state-of-the-art marketing website for **SMP Insurance Agency**, a Kenyan
insurance agency (intermediary). Built with Next.js 16 (App Router,
Turbopack), Tailwind CSS 4 and TypeScript, exported as a fully static site
(`output: "export"`) so it deploys to any host — Vercel, Cloudflare Pages,
cPanel, or GitHub Pages.

## What's inside

| Route | Purpose |
| --- | --- |
| `/` | Trust-first home: hero, product grid, stats, underwriter marquee, how-it-works, claims promise, testimonials, FAQ preview |
| `/products/` | Product hub (personal vs business) |
| `/products/<slug>/` | 10 product pages — motor, medical, life, personal accident, WIBA, business/SME, home, travel, agriculture, pensions — each with covered / not-covered lists, cover-level comparison, documents needed, step-by-step claims guide, FAQs, and `Service` + `FAQPage` + `BreadcrumbList` JSON-LD |
| `/quote/` | 3-step quote form (product → details → contact). Deep-linkable: `/quote/?product=motor`. Submits via WhatsApp (primary), email or phone — no backend required |
| `/claims/` | Claims hub: golden rules, per-product guides, IRA escalation rights |
| `/about/` | Story, values, licensing credentials, underwriter partners |
| `/faq/` | General FAQ with `FAQPage` schema |
| `/contact/` | All contact channels |

Sitewide: sticky header with click-to-call + products mega-menu, floating
WhatsApp button with per-page pre-filled messages, mobile sticky quote bar,
`InsuranceAgency` JSON-LD, sitemap.xml and robots.txt.

The copy is grounded in current Kenyan market practice: TPO/TPFT/
comprehensive motor tiers, DMVIC digital certificates (*352#), SHA/SHIF (the
NHIF successor), WIBA 2007 employer obligations, IPF premium instalments,
M-PESA payment, police-abstract claims steps, and IRA/PCF consumer rights.

## ⚠️ Before going live — replace the placeholders

1. **`src/lib/site.ts`** — every `TODO`: phone, WhatsApp number, email,
   domain, physical address, opening hours, socials and the **real IRA
   licence number**. All links (tel/wa.me/mailto), the footer, metadata and
   JSON-LD update automatically from this one file.
2. **`src/lib/content.ts`** —
   - `underwriters`: trim to the underwriters SMP actually holds agency
     appointments with (never list non-partners);
   - `stats`: use the client's real figures;
   - `testimonials`: **sample placeholders — must be replaced with real,
     permissioned client reviews before launch.**
3. **`src/lib/products.ts`** — indicative price ranges (e.g. motor
   comprehensive "3–7.5% of value") reflect the current market but should be
   confirmed with the client's underwriters.
4. Optional: swap the built-in SVG logo (`src/components/logo.tsx`,
   `src/app/icon.svg`) for the client's official logo; add an
   `opengraph-image.png`.

## Develop

```bash
cd smp-insurance
npm install
npm run dev    # http://localhost:3000
npm run build  # static export to ./out
npm run lint
```

## Deploy

The build emits plain HTML/CSS/JS to `out/`. Point any static host at it.
If serving from a sub-path, set `PAGES_BASE_PATH` at build time (see
`next.config.ts`). Post-launch checklist: connect the real domain with
HTTPS, create/claim the Google Business Profile (category “Insurance
agency”) with matching name/address/phone, and submit the sitemap in Google
Search Console.
