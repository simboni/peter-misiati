# TallyPay — Android app

This is the native Android wrapper for TallyPay. It's a **Trusted Web Activity
(TWA)**: a thin shell that opens `https://tallypay.co.ke` full-screen with no
browser bar, and **auto-updates every time the website deploys**. There is no
separate mobile codebase to maintain — the app *is* the website.

## How to get the app file

You don't build this locally. **GitHub Actions builds it for you** and hands
back the installable file as a downloadable artifact:

1. Go to the repo's **Actions** tab → **Build Android app** → **Run workflow**.
2. When it finishes, open the run and download from **Artifacts**:
   - **`tallypay-debug-apk`** — an `app-debug.apk` you can install on any phone
     right now (no signing setup needed). Copy it to your phone and tap it
     (you'll be asked to allow "install from unknown apps").
   - **`tallypay-release`** — the Play-ready signed `.aab` + `.apk`. Only built
     once you've added the signing secrets (below).

## Play-ready signed build (one-time signing setup)

Google Play needs a signed `.aab`. Create an **upload keystore** once and keep
it forever (the same key must sign every future update):

```bash
keytool -genkeypair -v -keystore tallypay-upload.keystore \
  -alias tallypay -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 tallypay-upload.keystore   # copy the output
```

Add four **repository secrets** (Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | the base64 string printed above |
| `ANDROID_KEYSTORE_PASSWORD` | the store password you chose |
| `ANDROID_KEY_ALIAS` | `tallypay` |
| `ANDROID_KEY_PASSWORD` | the key password you chose |

Re-run the workflow — it now also produces the signed `tallypay-release` bundle.

## Link the app to the domain (drops the URL bar)

The TWA only hides the browser chrome once the site proves it owns the app via
Digital Asset Links. The site already serves that file at
`https://tallypay.co.ke/.well-known/assetlinks.json`; set your app's signing
**SHA-256 fingerprint** into the Worker var `ASSETLINKS_SHA256` (see
`../billing/docs/play-store.md`, step 3). The fingerprint is printed by the
signing step / shown in Play Console → *App signing*.

## Project layout

- `app/build.gradle` — module config (package `ke.co.tallypay.app`, SDK levels,
  env-driven release signing).
- `app/src/main/AndroidManifest.xml` — the TWA `LauncherActivity`, the
  `asset_statements`, and the `https://tallypay.co.ke` intent filter.
- `app/src/main/res/values/strings.xml` — launch URL, host, asset statements.
- `app/src/main/res/mipmap-*` — launcher icons (generated from the brand mark).
- Gradle wrapper is pinned to 8.7 (AGP 8.5.2).

## Change the launch URL, name or version

Edit `res/values/strings.xml` (`launch_url`, `app_name`) and the `versionCode` /
`versionName` in `app/build.gradle`. Bump `versionCode` for every Play upload.
