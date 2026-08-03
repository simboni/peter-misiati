# Security posture & hardening

A pre-launch security review of the TallyPay billing app (auth, multi-tenancy,
payments, crypto, injection, dependencies). This documents what was fixed in
code and what remains an **operational** responsibility before/at launch.

## Fixed in code

### Critical
- **Fail-closed app secret.** `BETTER_AUTH_SECRET` no longer falls back to a
  hardcoded constant. It backs both session-cookie signing *and* the AES-GCM key
  that encrypts vendors' M-Pesa credentials — a missing value would have made
  sessions forgeable and stored secrets trivially decryptable. `appSecret()`
  (`src/server/config.ts`) and `getAuth()` (`src/server/auth.ts`) now throw if it
  is unset or shorter than 32 chars. **You must set it in production** (see
  Operational, below).

### High
- **Stored-XSS via the logo route.** `/d/[token]/logo` used to echo the stored
  data-URL's own MIME, so a vendor could store `data:text/html,…` and serve an
  executable document from our origin. The route now allowlists raster image
  types only (png/jpeg/gif/webp/avif), sends `nosniff` +
  `Content-Security-Policy: default-src 'none'; sandbox`, and only follows
  `https:` hosted URLs. `logoUrl`/`signatureUrl` are also validated server-side
  on save (`src/server/actions/settings.ts`).
- **Cross-tenant child-row deletion.** `deleteRecurringAction` and
  `deleteDeliveryNoteAction` deleted line items by an unscoped id before the
  org-ownership check. Both now confirm the parent belongs to the caller's org
  first.
- **Duplicate-receipt settlement race.** `settleIntent` used a check-then-act
  guard that the webhook and the status poller could both pass concurrently,
  creating two receipts for one payment. Settlement now claims the intent with a
  single atomic conditional `UPDATE … WHERE status='pending'`; the loser rolls
  back and returns the winner's receipt.

### Medium
- **Disabled users are now locked out.** `requireOrg()` redirects a user an
  admin has marked `disabled` (previously the flag only hid the admin link).
- **Account-deletion blast radius.** Deleting your account refuses to proceed if
  you own a workspace that still has other members — preventing "delete my
  account" from silently destroying co-owners'/members' data.
- **Sign-up enumeration.** Duplicate-registration no longer echoes the auth
  library's "User already exists"; a uniform message is returned instead.
- **Encrypted secrets no longer serialized to the browser.** The settings page
  strips `kopokopo*Enc` ciphertext before passing the profile to the client form.
- **Auth rate limiting + trusted origins** configured on better-auth (note the
  in-memory limiter is per-isolate on Workers — see Operational).

### Low / hardening
- Global **security headers** (CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`,
  `Referrer-Policy`, `Permissions-Policy`, COOP) in `next.config.ts`.
- **Support email obfuscated** on public pages (`ObfuscatedEmail`) so it isn't
  harvestable from server-rendered HTML.
- `accentColor` validated to a hex pattern; negative amounts/quantities clamped
  to zero; invoice-line `itemId` validated against the caller's org.
- `.gitignore` now covers `.env*`.

## Verified sound (no change needed)
- Kopo Kopo **webhook signature** is HMAC-SHA256 verified (constant-time) with
  the org's key *before* any state change — forged "payment success" is rejected.
- **AES-GCM** uses a fresh random IV per encryption with the GCM auth tag; tokens
  are `crypto.randomUUID()`; **FCM JWT** RS256 signing reads the key only from
  env. No `console.*` secret logging; no `NEXT_PUBLIC_` secret leakage.
- **Tenant isolation** is otherwise thorough: every action/loader starts at
  `requireOrg()` and scopes queries by `organizationId`; admin routes require the
  platform-admin flag; public share routes key only on unguessable UUID tokens.
- No SQL injection (Drizzle is parameterized); no open redirects; committed
  `google-services.json` is a placeholder.

## Operational — do these before/at launch
1. **Set the Worker secret:** `cd billing && npx wrangler secret put BETTER_AUTH_SECRET`
   (≥32 random chars) and `BETTER_AUTH_URL=https://tallypay.co.ke`. Without the
   secret the app now refuses to start (by design).
2. **Rate limiting at the edge:** add Cloudflare WAF rate-limiting rules on
   `/api/auth/*`, `/api/mpesa/kopokopo`, and `/api/payments/status`. The
   in-app limiter is per-isolate on Workers and is not a substitute.
3. **Dependencies:** run `npm audit` in CI and enable Dependabot/Renovate; keep
   `better-auth` and `next` on the latest patch.
4. **Rotate** any credential that was ever shared in plaintext, and confirm the
   production `BETTER_AUTH_SECRET` differs from the local `.dev.vars` value.

## Known follow-ups (low risk, not blockers)
- Credit provider-**confirmed** amount (not the payer-requested amount) in
  `settleIntent`; the M-Pesa pay flow is currently disabled by a feature flag.
- Wrap the multi-table account/org purge in a D1 batch/transaction.
- Consider a password-reset flow and shared-storage auth rate limiting.
