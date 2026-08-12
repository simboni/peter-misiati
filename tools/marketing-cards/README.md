# marketing-cards

Builds the WhatsApp card deck in `public/marketing/cards/` — six 1080² squares
and three 1080×1920 stories. Captions for each one are in
`docs/marketing/whatsapp-cards.md`.

The cards are HTML, screenshotted. That is the point: changing a price or a
headline is one line in `build.mjs` and one command, rather than nine files
reopened in an image editor and re-exported by hand.

## Build

```bash
cd tools/marketing-cards
npm init -y && npm install qrcode          # QR for the business card
npx playwright install chromium            # or point at an existing Chromium

node getfonts.mjs                          # once — see below
node build.mjs                             # writes cards.html + manifest.json
node shoot.mjs                             # writes out/*.png
cp out/*.png ../../public/marketing/cards/
```

## The pieces

| File | Does |
| --- | --- |
| `base.css` | Tokens and shared card furniture. Palette is the portfolio's own (`src/app/globals.css`) so the deck can't drift from the brand. |
| `build.mjs` | One entry per card — copy, layout, order. Edit here. |
| `shoot.mjs` | Renders each card to an exact-size PNG and checks it. |
| `getfonts.mjs` | Downloads Space Grotesk / Inter / JetBrains Mono and inlines them as data URIs into `fonts-inline.css`. |

`fonts-inline.css` is generated, not committed — it is ~330 KB of base64 and
`getfonts.mjs` rebuilds it in seconds. Run it before the first build, and again
if the brand fonts change. Without it every headline silently falls back to
DejaVu Sans and the spacing goes to pieces, so `shoot.mjs` prints whether each
family actually loaded — check that line.

## What `shoot.mjs` enforces

- **Exact frame size.** A card that isn't precisely 1080² gets rejected, because
  WhatsApp will crop or letterbox anything else.
- **Edge clearance.** Nothing may overflow the frame *or* come within 20px of it.
  Content that stops a few pixels short reads as clipped once WhatsApp has
  recompressed the image.
- **No page errors.**

Two things it cannot check, so check them by eye:

- **Legibility after compression.** WhatsApp recompresses hard. Keep body text
  at 20px+ and avoid thin weights; if you shrink something, look at the result.
- **The QR still resolves.** It is generated from `https://wa.me/254706289514`.
  If you change the number, decode the rendered PNG rather than trusting it —
  `jsqr` against a canvas of the export takes a minute and a wrong QR on a
  business card is worse than no QR at all.

## Story safe zones

`.card.story` reserves 170px at the top and 250px at the bottom. WhatsApp Status
draws the sender row over the top of the image and a Reply bar over the bottom;
a phone number or CTA placed in either is one nobody can read. Keep clear of
both when rearranging.
