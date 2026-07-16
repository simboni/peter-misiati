# Publishing TallyPay to Google Play

TallyPay is a web app. We ship it to Play as a **Trusted Web Activity (TWA)** —
a thin Android wrapper that opens the real site full‑screen (no browser bar) and
**auto‑updates every time you deploy**. No separate mobile codebase.

## What's already in the code (done)

- **Web app manifest** — `src/app/manifest.ts` → served at `/manifest.webmanifest`
  (name, icons, `#059669` theme colour, `standalone` display, `start_url`).
- **Icons** — `public/icons/icon-192.png`, `icon-512.png`, `maskable-512.png`.
- **Service worker** — `public/sw.js` (installability + an offline screen at
  `public/offline.html`), registered by `src/components/register-sw.tsx`.
- **Digital Asset Links** — served at `/.well-known/assetlinks.json` by the app
  (`app/api/assetlinks` + a rewrite), configurable via Worker vars — see step 3.
- **Privacy policy** — `/privacy` (required by Play).

After deploying, confirm these resolve:
`https://tallypay.co.ke/manifest.webmanifest`, `/sw.js`,
`/.well-known/assetlinks.json`, `/privacy`.

## Step 1 — One‑time setup

- Create a **Google Play Developer account** (~USD 25 one‑time):
  https://play.google.com/console/signup
- Install Node (already have it) and a JDK 17+ for the packaging tool.

## Step 2 — Generate the Android app bundle (.aab)

Easiest (no local tooling): **PWABuilder**
1. Go to https://www.pwabuilder.com and enter `https://tallypay.co.ke`.
2. It scores the PWA and lets you **Package for Android** (choose "Trusted Web
   Activity"). Download the `.aab` and the generated signing key (`.keystore`) —
   **keep the keystore safe; you need the same one for every future update.**

Or with the CLI (**Bubblewrap**):
```bash
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://tallypay.co.ke/manifest.webmanifest
#   package id suggestion: ke.co.tallypay.app  (must match assetlinks.json)
bubblewrap build      # produces app-release-bundle.aab + a signing key
```

## Step 3 — Link the app to the domain (removes the URL bar)

1. Get your app's **SHA‑256 signing fingerprint**:
   - PWABuilder/Bubblewrap prints it, or
   - after upload, from Play Console → *Release → Setup → App signing* (use the
     **App signing key** fingerprint, since Play re‑signs your bundle).
2. Set two **Worker variables** (no code change / redeploy of code needed):
   ```bash
   cd billing
   npx wrangler secret put ASSETLINKS_SHA256   # paste the SHA-256 fingerprint
   #   (comma-separate to list more than one)
   npx wrangler secret put TWA_PACKAGE_NAME     # e.g. ke.co.tallypay.app
   ```
   Or add them under the Worker's *Settings → Variables* in the Cloudflare
   dashboard.
3. Confirm `https://tallypay.co.ke/.well-known/assetlinks.json` now shows the
   real fingerprint (it's served by the app, so it always resolves).

## Step 4 — Create the Play listing & submit

In the Play Console:
- **Create app** → name "TallyPay", language, app (not game), free.
- **Store listing**: short & full description, app icon (use `icon-512.png`), a
  feature graphic (1024×500), and phone **screenshots** (reuse the marketing
  images or capture real screens).
- **Privacy policy URL**: `https://tallypay.co.ke/privacy`.
- **Data safety** form: declare what you collect (account info, financial info
  for invoicing, app activity) and that it's encrypted in transit — mirror
  `/privacy`.
- **Content rating** questionnaire, **target audience** (18+), and country
  availability (Kenya + wherever you want).
- **Production → Create release** → upload the `.aab` → roll out.

Google review is usually **1–3 days**. After approval it's live; every time you
deploy the website, the app content updates automatically — you only re‑upload a
new `.aab` if you change the manifest, icons, or Android wrapper itself.

## iPhone bonus

The same PWA is installable on iOS via Safari → Share → **Add to Home Screen**
(Apple doesn't allow TWAs in the App Store, so that's the iOS route).
