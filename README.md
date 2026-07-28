# KEYSA — Kenya Youth Support Association

The official website of the **Kenya Youth Support Association (KEYSA)**, a
registered non-profit founded in 2020 in Namamali Ward, Matungu Constituency,
Kakamega County, Kenya. Built with **Next.js 16 (App Router)**, **React 19**,
**TypeScript** and **Tailwind CSS v4**, exported as a fast static site.

## Pages

| Route              | Purpose                                                              |
| ------------------ | -------------------------------------------------------------------- |
| `/`                | Home — hero, mission, impact stats, programs, featured projects, donate CTA |
| `/about`           | Story, vision & mission, core values, leadership bios, governance    |
| `/programs`        | The five thematic areas at a glance                                  |
| `/programs/[slug]` | Full program detail — rationale, activities, outcomes, related projects |
| `/projects`        | Fundable initiatives (seeking funding) and delivered work            |
| `/projects/[slug]` | Full project brief — background, objectives, activities, outcomes, sustainability |
| `/donate`          | Giving impact examples, ways to give, transparency, donor FAQ        |
| `/get-involved`    | Volunteer, mentor, coach, partner, sponsor                           |
| `/news`            | Stories and milestones, incl. the founder's essay                    |
| `/contact`         | Contact cards + mailto-powered contact form                          |

Plus `sitemap.xml`, `robots.txt`, a web app manifest, JSON-LD `NGO` schema,
OG/Twitter share images, a themed 404, and light/dark themes.

## Editing content — one file

**All content lives in [`src/lib/keysa.ts`](src/lib/keysa.ts).** Programs,
projects, team bios, values, giving examples, governance notes, articles and
navigation are all typed data. Adding a project there auto-creates its card,
its `/projects/<slug>` page and its sitemap entry — you never touch the page
components.

### Donation channels

The donate page deliberately routes payment details through
`info@keysa.org` (no account numbers published) to protect donors from
impersonation scams. When the association is ready to publish an M-Pesa
paybill or add a payment processor, extend `src/app/donate/page.tsx`.

## Local development

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # static export → ./out
```

## Deployment

Static export (`output: 'export'`), so it deploys to any static host — Vercel,
Cloudflare Pages, Netlify, GitHub Pages. Set the build command to `npm run
build` and the output directory to `out`. `site.url` in `src/lib/keysa.ts`
drives canonical URLs, the sitemap and JSON-LD.

---

© Kenya Youth Support Association.
