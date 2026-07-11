# Canossian Sisters — North East Africa Province

A modern redesign of the Canossian Daughters of Charity (Canossian Sisters)
website, built with **Next.js 16 (App Router)**, **React 19**, **TypeScript**
and **Tailwind CSS v4**, exported as a fast static site.

The design keeps the congregation's original identity — the warm terracotta,
gold, sky-blue and sage palette drawn from the Canossian crest — and carries
every programme and service from the previous site forward.

## Pages

| Route                 | Purpose                                                              |
| --------------------- | -------------------------------------------------------------------- |
| `/`                   | Home — hero, 250th-anniversary banner, who we are, ministries, impact stats, causes, FAQ, news, volunteer CTA |
| `/about`              | Story, vision & mission, St Magdalene of Canossa, where we serve     |
| `/ministries`         | The five ministries at a glance                                      |
| `/ministries/[slug]`  | Ministry detail — education, evangelization, pastoral healthcare, formation of the laity, spiritual exercises & retreats |
| `/causes`             | Ongoing causes with funding progress — school, scholarships, hospital |
| `/gallery`            | Photo mosaic from the mission                                        |
| `/contact`            | Contact form, details, socials, FAQ                                  |
| `/donate`             | Ways to give and how to make a gift                                  |

Plus `sitemap.xml`, `robots.txt` and JSON-LD `NGO` schema.

## Editing content — one file

**All content lives in [`src/lib/site.ts`](src/lib/site.ts).** Ministries,
causes, stats, FAQs, locations, news updates, contact details — edit that one
typed file and every page (and the sitemap) updates. Adding a ministry
automatically creates its card, its `/ministries/<slug>` page, and a sitemap
entry.

Photos live in `public/images/`.

## Forms

The contact form and newsletter post to [FormSubmit](https://formsubmit.co),
which emails each submission to `contact.email` in `src/lib/site.ts` — no
backend needed. The first submission triggers a one-time activation email.

## Local development

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # static export → ./out
```

## Deployment

Static export (`output: 'export'`), so it deploys to any static host — Vercel,
Cloudflare Pages, Netlify, GitHub Pages. Build command `npm run build`, output
directory `out`. Update `site.domain` in `src/lib/site.ts` to the live domain
before launch (it drives canonical URLs, the sitemap and JSON-LD).
