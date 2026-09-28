# Marketing screens

Advertisement-ready images of the system, made from the real application — not
mock-ups. Every screen here was photographed from a running build against a
**showroom database**: two months of invented trading, seeded by the scripts in
this folder so that any of it can be made again, unchanged, at any time.

> **The figures are sample data.** The turnover, the profit, the debts and the
> customer names are invented, and each image carries a line saying so. Riziki's
> real trading is not in any of these files and must not be put into them —
> a shop's takings are nobody else's business.

## `ads/` — finished pieces

| File | Size | What it is | Where it goes |
| --- | --- | --- | --- |
| `ad-1-hero.png` | 3200 × 2000 | "Your whole shop, in one screen." Dashboard on a laptop and a phone. | Website header, a pitch deck's first slide, a printed flyer's front |
| `ad-2-counter.png` | 3200 × 2000 | "Four taps to a sale." The counter mid-sale, with the payment panel open and four numbered notes. | The selling section of a site; a leaflet's inside page |
| `ad-3-grid.png` | 3200 × 2000 | "Not a till with a chemicals label stuck on it." Six capabilities, each with its own screen. | A features page; the second slide of a pitch |
| `ad-4-square.png` | 2160 × 2160 | "Did the shop make money today?" Square, for a feed. | WhatsApp status, Instagram, Facebook, LinkedIn |
| `ad-5-sheet.png` | 2480 × 3508 (A4 at 300 dpi) | Everything the system does, on one page, with three screens and a note on how it is built. | Print it, or attach it to an e-mail as the spec sheet |
| `ad-6-anatomy.png` | 3200 × 2000 | The dashboard with its four parts numbered and explained. | Explaining the reporting module to somebody who has not seen it |

All six are PNG at roughly 2× so they stay sharp on a phone screen and survive
being printed. The A4 sheet is sized for 300 dpi paper.

## `screens/` — the raw screens

Plain screenshots, JPEG, no frames or captions, for dropping into a deck, a
proposal or a website of your own:

`d-` laptop (1440 × 900) · `p-` phone (390 × 844) · `c-` a document on its own

```
d-reports          the dashboard, folded          p-reports   the dashboard on a phone
d-reports-chart    the sales-and-profit chart     p-sell      the counter on a phone
d-reports-days     the day-by-day ledger          p-stock     the shelf on a phone
d-sell             the counter, every chemical    p-mix       the mixing board on a phone
d-pay              a sale mid-payment             c-receipt   an invoice
d-mix              the mixing board               c-delivery  a delivery note
d-stock            the shelf, valued at cost
d-formula          a recipe with its mixing steps
d-debts            who owes, and since when
d-purchases        deliveries from suppliers
d-items            products and prices
d-dayclose         the day's cash, counted
```

## Making them again

The pictures are only as good as the shop behind them, so the shop is a script.

```sh
# 1. a showroom database — two months of healthy trading, no alarming states
rm -rf /tmp/showroom && mkdir -p /tmp/showroom
RIZIKI_DB=/tmp/showroom/pos.db node --experimental-strip-types marketing/showroom.ts
RIZIKI_DB=/tmp/showroom/pos.db node --experimental-strip-types marketing/premix.ts

# 2. serve it
npm run build
RIZIKI_DB=/tmp/showroom/pos.db npx next start -p 3111
```

Then photograph it with any browser, or with Playwright at
`deviceScaleFactor: 2`. The compositions themselves are plain HTML and CSS —
a headline, a drawn browser frame and an `<img>` — which is why they can be
re-worded in a text editor rather than re-drawn.

`showroom.ts` is deliberately unflattering in the places that matter: it leaves
a few items running low and a few bills unpaid, because the screen that says
*"4 items are at or under the level you set"* is the screen worth advertising.
What it does not leave is anything broken — no stock below zero, no product
without a cost price — since those are true warnings about a real shop and not
what these pictures are about.

## Re-rendering a composition

```sh
cd marketing/compositions
node render.mjs ad-1-hero:1600:1000        # writes ../ads/ad-1-hero.png
```

The committed pieces in `ads/` were rendered from the original lossless
screenshots; the sources here point at the JPEGs in `screens/`, so a re-render
is a touch softer. Re-shoot the screen you need as a PNG if that matters.

---

## `tour/` — the client walkthrough

`riziki-pos-end-to-end.pdf` (13 pages, A4) explains the whole system in the
order it happens: goods in, money back, the ledger under both; a day at the
counter; how cost is worked out and frozen; the two ways a recipe sells; credit
and its papers; the dashboard; who sees what; what cannot be changed; and how
the thing is kept running. It is the handout for a wrap-up meeting — the same
content is published as a page at `tour/index.html`.

Regenerating the PDF needs the webfonts embedded once (the instructions are at
the top of `tour/build-pdf.py`), then:

```sh
cd marketing/tour
python3 build-pdf.py     # writes print.html — no sticky nav, both recipe
                         # routes shown, diagram labels sized for A4
node render-pdf.mjs      # writes ../riziki-pos-end-to-end.pdf
```

The page and the PDF are the same source. Edit `tour/index.html` and both
follow.
