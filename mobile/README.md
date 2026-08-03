# TallyPay — mobile app (Capacitor)

The native app shell for TallyPay, built with **Capacitor**. It wraps the live
site `https://tallypay.co.ke` in a real native app and is the base we add native
features onto (push notifications, biometric unlock, camera, share sheet). Web
content auto-updates on every website deploy; we only re-release the store build
when the native shell changes.

This is the **go-forward** app and supersedes the interim TWA in `../android/`.

## How to get the app file

GitHub Actions builds it — you don't need Android tooling locally:

1. Repo **Actions** tab → **Build mobile app (Android)** → **Run workflow**.
2. Open the finished run → **Artifacts**:
   - **`tallypay-debug-apk`** → `app-debug.apk`, installable on any phone now.
   - **`tallypay-release`** → Play-ready signed `.aab` + `.apk` (once signing
     secrets are set — see below).

## Signing (for the Play-ready build)

Create an upload keystore once and keep it forever (same key signs every update):

```bash
keytool -genkeypair -v -keystore tallypay-upload.keystore \
  -alias tallypay -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 tallypay-upload.keystore
```

Add repo secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS` (`tallypay`), `ANDROID_KEY_PASSWORD`; re-run the workflow.

## Local development

```bash
cd mobile
npm ci
npx cap sync android      # regenerates native config + plugin refs
npx cap open android      # opens Android Studio (needs the Android SDK)
```

`node_modules` and Capacitor's generated native files are gitignored; CI restores
them with `npm ci` + `npx cap sync android` before building, so the committed
`android/` project always builds from a clean checkout.

## Config

- **`capacitor.config.json`** — app id `ke.co.tallypay.app`, name TallyPay,
  `server.url` → `https://tallypay.co.ke`, emerald splash + status bar.
- **`www/index.html`** — a branded fallback shown only if the live site is
  unreachable; normally the remote app loads immediately.
- Launcher icons + splash are branded from the TallyPay mark.

## Version / name

Bump `versionCode` (and `versionName`) in `android/app/build.gradle` for every
Play upload. Change the display name in
`android/app/src/main/res/values/strings.xml`.

## Roadmap (next)

- **iOS**: `npx cap add ios` + a macOS/cloud-Mac build (deferred — Android first).
- **Native features**: `@capacitor/push-notifications`, biometric unlock,
  `@capacitor/share`, `@capacitor/camera`.
