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
- **Android app project** — `android/` (Trusted Web Activity) plus a
  **Build Android app** GitHub Actions workflow that emits the installable
  `.apk`/`.aab` — see `android/README.md`.

After deploying, confirm these resolve:
`https://tallypay.co.ke/manifest.webmanifest`, `/sw.js`,
`/.well-known/assetlinks.json`, `/privacy`.

## Step 1 — One‑time setup

- Create a **Google Play Developer account** (~USD 25 one‑time):
  https://play.google.com/console/signup
- Install Node (already have it) and a JDK 17+ for the packaging tool.

## Step 2 — Generate the Android app bundle (.aab)

The Android app lives in this repo at **`android/`** (a Trusted Web Activity)
and is built for you by **GitHub Actions** — no local Android tooling required.

1. Repo **Actions** tab → **Build Android app** → **Run workflow**.
2. Open the finished run and download the **Artifacts**:
   - **`tallypay-debug-apk`** → `app-debug.apk`, installable on any phone right
     now (great for testing before you ever touch Play).
   - **`tallypay-release`** → the Play-ready signed `.aab` + `.apk` (appears once
     the signing secrets from step 3 are set).

The package id is **`ke.co.tallypay.app`** (matches `assetlinks.json`). To change
the app name/version, edit `android/app/src/main/res/values/strings.xml` and the
`versionCode`/`versionName` in `android/app/build.gradle`.

> Prefer a one-click web tool instead? **PWABuilder** (https://www.pwabuilder.com,
> enter `https://tallypay.co.ke` → Package For Android) also produces a `.aab`.
> The in-repo workflow is the maintained path and keeps everything in one place.

## Step 3 — Sign the release + link the app to the domain

**Signing** (so the workflow can emit a Play‑ready `.aab`): create an upload
keystore once and add it to the repo as secrets — full commands in
`android/README.md`. In short:
```bash
keytool -genkeypair -v -keystore tallypay-upload.keystore \
  -alias tallypay -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 tallypay-upload.keystore
```
then add repo secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` and re‑run the workflow.

**Linking the domain** (removes the URL bar):

1. Get your app's **SHA‑256 signing fingerprint**:
   - `keytool -list -v -keystore tallypay-upload.keystore -alias tallypay`, or
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
