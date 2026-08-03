# Push notifications (FCM)

TallyPay can send **"Payment received 🎉"** alerts to a vendor's phone when money
lands (e.g. an M‑Pesa payment confirms). It's built on **Firebase Cloud
Messaging (FCM)** and ships **dormant** — everything is wired, but nothing sends
until you connect a Firebase project. No code changes are needed to turn it on.

## What's already built (done)

- **Device registration** — the app asks for notification permission and stores
  its FCM token (`src/components/push-registration.tsx` → `savePushTokenAction`).
- **Token storage** — a `push_token` table (one row per device), applied by the
  D1 migration `drizzle/0012_push_token.sql`.
- **Sender** — `src/server/push.ts` sends via the FCM HTTP v1 API (signs a JWT
  with your service account, in-Worker). No-op until configured.
- **Trigger** — `settleIntent()` calls `notifyPaymentReceived()` when a payment
  settles, so a confirmed M‑Pesa payment pushes an alert.
- **Android plugin** — `@capacitor/push-notifications` in `mobile/`.

## Turn it on — one‑time Firebase setup

### 1. Create the Firebase project + Android app
1. Go to <https://console.firebase.google.com> → **Add project** → name it
   "TallyPay" (Analytics optional).
2. **Add app → Android**. Package name **`ke.co.tallypay.app`** (exact). Register.
3. Download the real **`google-services.json`**.

### 2. Put the config in the app (receiving)
Replace the placeholder file with the real one:
`mobile/android/app/google-services.json`
Commit it, then rebuild the APK (**Actions → Build mobile app (Android)**) and
reinstall — this build can actually receive pushes. *(The committed placeholder
only exists so the app keeps building before you do this.)*

### 3. Give the server permission to send
1. Firebase console → **Project settings → Service accounts → Generate new
   private key** → downloads a JSON file.
2. Add it as a Worker secret (the whole JSON, one line):
   ```bash
   cd billing
   npx wrangler secret put FCM_SERVICE_ACCOUNT
   #   paste the entire service-account JSON when prompted
   ```
   That's it — `src/server/push.ts` picks it up automatically and starts sending.

## Test it
Install the rebuilt app, open it once (accept the notification prompt), then have
a client pay an invoice by M‑Pesa (or record a settlement). The phone should get
a **"Payment received 🎉"** notification.

## Notes
- Until both steps 2 and 3 are done, push is inert — the app builds and runs
  normally, and payments work exactly as before.
- Invalid/expired device tokens are pruned automatically when FCM reports them.
- iOS later: add an iOS app in Firebase + APNs key, then `npx cap add ios`.
