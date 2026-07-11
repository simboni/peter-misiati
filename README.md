# COSDEP — Community Sustainable Development Empowerment Programme

A redesigned website for **COSDEP**, a registered Kenyan NGO *training farmers to
secure their future* through agro-ecological agriculture, natural-resource
management and value addition.

Built with **Next.js 16 (App Router)**, **React 19**, **TypeScript** and
**Tailwind CSS v4**, and exported as a fast, self-contained static site.

## Design

A light, nature-forward **"living green"** design system built on the
organisation's original leaf-green brand — deep forest greens for trust, a vivid
leaf accent for energy, and warm cream/sand neutrals that let the field
photography breathe. Typography pairs **Poppins** (display, continuity with the
original brand) with **Inter** (body).

## Pages

| Route            | Purpose                                                                        |
| ---------------- | ------------------------------------------------------------------------------ |
| `/`              | Home — hero slider, welcome, key figures, programmes, gallery, projects, testimonials, get-involved, donate CTA |
| `/about`         | Who we are, mission & vision, our approach, people & partners                  |
| `/programs`      | The three programme pillars in depth, with related projects                    |
| `/projects`      | Filterable directory of every project                                          |
| `/get-involved`  | Donate (with bank details), volunteer, and partnership sections                |
| `/contact`       | Contact form + address, phone, email and socials                               |

Plus `sitemap.xml`, `robots.txt` and JSON-LD `NGO`/Organization schema.

## The three programme pillars

1. **Food & Nutrition Security** — agro-ecological training, kitchen / sack /
   vertical gardens, school gardening, integrated pest management, composting.
2. **Natural Resource Management** — tree planting, agroforestry, watershed &
   wetland rehabilitation, climate-resilience advocacy.
3. **Value Addition & Entrepreneurship** — value-added organic products,
   market outlets & linkages, bio-inputs, farmer & youth enterprise.

## Key figures

**6,000+** direct farmers reached · **10,000+** trees planted · **30+** school
gardens established.

## Editing content — one file

**All content lives in [`src/lib/cosdep.ts`](src/lib/cosdep.ts).** The mission,
programmes, projects, figures, testimonials, gallery, donation details and
contact info are all typed in that single file — edit there and every page,
card and menu updates itself.

### Images

Field photographs live in [`public/images/`](public/images) with semantic
names (e.g. `farmers-vegetables.jpg`, `community-tree-planting.jpg`). They are
referenced from `src/lib/cosdep.ts`.

## Contact form delivery

The form at `/contact` posts to a no-backend service
([FormSubmit](https://formsubmit.co)) that emails each enquiry to
`contact.email` in `src/lib/cosdep.ts`. The first submission triggers a one-time
activation email — click the link once and delivery is on for good.

## Local development

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # static export → ./out
```

## Deployment

Static export (`output: 'export'`), so it deploys to any static host — Vercel,
Cloudflare Pages, Netlify or GitHub Pages. Set the build command to
`npm run build` and the output directory to `out`. Update `site.domain` in
`src/lib/cosdep.ts` to the live domain before launch — it drives the canonical
URLs, sitemap and structured data.

---

© 2026 Community Sustainable Development Empowerment Programme (COSDEP).
