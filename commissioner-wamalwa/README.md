# Commissioner Dr. Dennis Wamalwa — Official Website

A modern, fast, fully self-contained website for **Commissioner Dr. Dennis Wamalwa (PhD)** of the Kenya National Commission on Human Rights (KNCHR) — rebuilt from the original WordPress/Divi content into clean, portable static files.

> **Equal rights for every person.** A professional home for the Commissioner's record, causes, and story — built to inform, to inspire, and to support his reappointment.

---

## ✨ What's inside

| Page | File | Purpose |
|------|------|---------|
| **Home** | `index.html` | Flagship landing page — hero, impact stats, the five focus areas, about preview, featured news, gallery preview, get-involved & contact |
| **About** | `about.html` | Full biography, current roles, a career timeline, education & scholarship |
| **My Work** | `work.html` | KNCHR mandate, services offered, and the five focus areas in depth |
| **News & Press** | `news.html` | Filterable news grid + full archive of headlines |
| **Articles** | `news/*.html` | Three full stories (reparations, mental health in prisons, Ethiopian study visit) |
| **Gallery** | `gallery.html` | Masonry photo gallery with a keyboard-navigable lightbox |

### Design & engineering highlights
- **Zero dependencies, zero build step** — plain HTML, one CSS file, one JS file. Opens by double-clicking `index.html`.
- **Dignified, on-brand palette** — ink + KNCHR gold + justice emerald, with an editorial *Fraunces × Inter* type pairing.
- **Light & dark themes** — respects the visitor's system preference and remembers their manual choice.
- **Modern motion** — scroll-reveal animations, animated impact counters, hover-reveal cards — all disabled automatically under `prefers-reduced-motion`.
- **Accessible** — semantic HTML, skip links, alt text, keyboard-friendly lightbox, strong contrast.
- **Responsive** — looks great from a 320px phone to a widescreen desktop.
- **SEO-ready** — descriptive titles, meta descriptions, and Open Graph tags on every page.

---

## 📁 Structure

```
commissioner-wamalwa/
├── index.html            # Home
├── about.html            # About / My Journey
├── work.html             # My Work
├── news.html             # News & Press
├── gallery.html          # Gallery
├── news/                 # Full article pages
│   ├── reparations-framework.html
│   ├── mental-health-correctional.html
│   └── ethiopia-study-visit.html
└── assets/
    ├── css/styles.css    # The full design system
    ├── js/main.js        # All interactions (theme, nav, reveal, counters, lightbox, filter)
    └── img/              # All photographs & imagery
```

---

## 🚀 Deploying (easiest first)

This is a **static site** — it can be hosted anywhere, for free, in minutes.

**Option A — GitHub Pages**
1. Put the contents of this folder in a repository (e.g. `Commissioner-Wamalwa`).
2. Repo **Settings → Pages → Source: Deploy from branch → `main` / root**.
3. Your site goes live at `https://<user>.github.io/<repo>/`.

**Option B — Netlify / Vercel / Cloudflare Pages**
- Drag-and-drop this folder onto the dashboard, or connect the repo. No build command needed; publish directory is the folder itself.

**Option C — Any web host**
- Upload the folder via FTP/cPanel to your domain (e.g. `commrdrdenniswamalwa.co.ke`).

**Preview locally**
```bash
cd commissioner-wamalwa
python3 -m http.server 8000
# open http://localhost:8000
```

---

## ✏️ Editing content

- **Text** lives directly in the HTML — search for the words you want to change.
- **Photos** live in `assets/img/`. Replace a file (keep the name) to swap an image, or add new ones and reference them.
- **Colours & fonts** are all defined as CSS variables at the top of `assets/css/styles.css` (`:root { --gold: … }`).
- **News**: to add a story, copy one of the files in `news/` and update the text, then add a card to `news.html` and `index.html`.

---

## 📞 Contact details on the site
Office lines: **020 271 7900 · 020 271 7908** — Mobile: **0733 780 000 · 0724 256 448**
Hours: Mon–Fri, 8:00am – 5:00pm.

*Content and imagery adapted from the Commissioner's existing site material. All rights reserved.*
