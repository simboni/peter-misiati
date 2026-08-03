# Publishing TallyPay to Google Play

TallyPay ships to Play as a **Capacitor** Android app that opens the real,
always‑current site (`tallypay.co.ke/dashboard`) full‑screen with native chrome,
splash and push. Because it loads the live site, **deploying the website updates
the app instantly** — you only re‑upload a new bundle when the native shell
itself changes (icons, version, plugins). No separate mobile codebase to keep in
sync.

The app project lives in **`mobile/`**; CI builds the installable files for you.

---

## Compliance — done in the code ✅

Google will reject a data‑collecting app that is missing these. All are built:

- **In‑app account deletion** — Settings → **Delete account** (typed
  confirmation) erases the user and, for a workspace owner, all workspace data.
- **Public account‑deletion URL** — `https://tallypay.co.ke/delete-account`
  (this is the URL Play's Data Safety form asks for).
- **Privacy policy** — `https://tallypay.co.ke/privacy`.

After a deploy, confirm all three resolve.

---

## What you (the human) still need to do

Four things only you can do — everything else is in the repo:

1. **Play Developer account** — one‑time ~USD 25: https://play.google.com/console/signup
2. **Signing keystore + 4 repo secrets** (so CI can emit a Play‑ready `.aab`).
3. **Upload the `.aab`** to a Play release.
4. **Fill the store listing** (copy below) + Data Safety + content rating.

---

## Step 1 — Generate the upload keystore, add signing secrets

Create the key once (keep the file + passwords safe — you reuse them for every
future update):

```bash
keytool -genkeypair -v -keystore tallypay-upload.keystore \
  -alias tallypay -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 tallypay-upload.keystore     # copy this whole string
```

Add these repo **Settings → Secrets and variables → Actions** secrets:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | the base64 string above |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password you chose |
| `ANDROID_KEY_ALIAS` | `tallypay` |
| `ANDROID_KEY_PASSWORD` | key password you chose |

## Step 2 — Build the bundle

Repo **Actions → Build mobile app (Android) → Run workflow**. When it finishes,
download the artifacts from that run:

- **`tallypay-debug-apk`** → `app-debug.apk` — installs on any phone for testing,
  no signing needed.
- **`tallypay-release`** → the signed **`.aab`** (and `.apk`) — appears once the
  Step 1 secrets are set. This is what you upload to Play.

Package id is **`ke.co.tallypay.app`**. Bump `versionCode`/`versionName` in
`mobile/android/app/build.gradle` for each new store update.

## Step 3 — Create the app & release in Play Console

1. **Create app** → name **TallyPay**, default language English (Kenya), type
   **App**, **Free**.
2. **Production → Create release** → upload the `.aab` → save.
3. Play manages re‑signing (App Signing) automatically — accept the default.

## Step 4 — Store listing (copy‑paste ready)

- **App name:** `TallyPay`
- **Short description (≤80 chars):**
  `Invoices, receipts & M-Pesa payments for Kenyan businesses.`
- **Full description:**

  ```
  TallyPay is the simple way for Kenyan businesses to invoice clients and get
  paid. Create professional quotations, invoices, receipts, delivery notes and
  credit notes with your logo and KRA PIN, add 16% VAT and deposits, and share
  them by link or WhatsApp in seconds.

  • Quotations that convert to invoices in one tap
  • Deposits, partial payments and running balances tracked for you
  • Get paid by M-Pesa — clients pay the invoice, you get a receipt
  • Clean, print-ready documents branded to your business
  • Clients, items and expenses in one place
  • A dashboard that shows what you're owed, what's paid and your top clients
  • Recurring invoices for retainers

  Built for Kenya: KRA PIN and VAT on every document, prices in KES.

  Start free. Your books, your rules.
  ```

- **App icon:** the 512×512 icon in `mobile/` (or `public/icons/icon-512.png`).
- **Feature graphic (1024×500):** required — see “Assets to generate” below.
- **Phone screenshots (2–8, min 1080px):** capture real screens (dashboard,
  invoice, payment, receipt) from the installed debug APK, or ask me to
  generate a polished set.
- **App category:** Business. **Tags:** invoicing, finance.
- **Contact email:** `support@tallypay.co.ke`.

## Step 5 — Data Safety, privacy & rating

- **Privacy policy URL:** `https://tallypay.co.ke/privacy`
- **Account deletion URL:** `https://tallypay.co.ke/delete-account`
- **Data Safety form** — declare and mark **encrypted in transit** + **deletion
  available**:
  - *Personal info* — name, email address (account).
  - *Financial info* — your business/customer billing details and payment info
    (you enter these to make invoices).
  - *App activity / app info & performance* — basic logs to run and secure it.
  - Data **is** used to run the service, **not** sold, **not** shared for ads.
- **Content rating** questionnaire → answer honestly (no objectionable content →
  rated **Everyone**).
- **Target audience:** 18+.
- **Countries:** Kenya (add others if you want).

## Step 6 — Submit

Send for review. Google typically takes **1–3 days**. After approval it's live;
every website deploy updates the app content automatically. Re‑upload a new
`.aab` only when you change the native shell (icons, version, plugins) — bump
`versionCode` first.

---

## Assets to generate

You still need two visual assets for the listing. I can produce both on request:

- **Feature graphic** — 1024×500 PNG, TallyPay brand.
- **Phone screenshots** — a polished set (device frame + captions) of the
  dashboard, invoice, M‑Pesa payment and receipt.

Ask and I’ll generate them.

## iPhone (later)

The Capacitor project can target iOS too (`npx cap add ios`), or the PWA installs
via Safari → Share → **Add to Home Screen**. Deferred until Android is live.
