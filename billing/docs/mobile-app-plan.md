# TallyPay — Mobile App Plan (App Store & Google Play)

The complete plan to ship TallyPay as a real native app on **both** stores —
what to build, what it costs, everything needed, and the order to do it in.

> Rendered version: a formatted copy of this plan is published as an Artifact
> (shareable link) — ask if you need it again.

---

## Three ways to be "an app"

| Approach | What it actually is | Stores | Effort | Verdict |
| --- | --- | --- | --- | --- |
| **TWA** *(built)* | Thin Android shell around the live site (today's debug APK). | Google Play only | Done | ✓ Android now — Apple rejects pure web wrappers |
| **Capacitor** | Native iOS **and** Android apps running your existing TallyPay, plus real device features (push, Face ID, camera, share). | Both | ~2–4 weeks | ★ **Recommended** |
| **Full native rewrite** (React Native / Flutter) | Rebuild every screen in native code — a second product to maintain. | Both | 3–6+ months | Overkill here |

### Recommendation: Capacitor

You already have a polished web product. Capacitor wraps **that exact app** in
genuine native iOS + Android projects and lets us add the native features that
make it feel like an app — not a rewrite, not a second codebase. Apple approves
Capacitor apps (real native binaries with native capabilities) where they reject
bare web wrappers. Web content keeps auto-updating on every deploy; we only
re-release the store build when the native shell itself changes.

---

## Architecture

1. **TallyPay web app** *(exists)* — Next.js on Cloudflare. Unchanged.
2. **Capacitor native shell** — real iOS + Android projects rendering the app
   full-screen and brokering device access.
3. **Native capability plugins** — push, biometric unlock, camera, share sheet,
   deep links, haptics, native splash.
4. **Output** — a signed `.aab` (Play) and a signed `.ipa` (App Store).

Content updates the instant we deploy the website; a new store build is only
needed for native-feature changes.

---

## Native features to add

- **Push notifications** — payment received, invoice viewed, overdue reminders (FCM + APNs).
- **Biometric unlock** — Face ID / fingerprint.
- **Native share sheet** — send an invoice link/PDF to WhatsApp, email, SMS.
- **Camera & photos** — capture a logo or an expense receipt.
- **Deep links** — `tallypay.co.ke/d/…` opens inside the app.
- **Native polish** — branded splash, themed status bar, haptics, offline screen.

---

## Accounts, tools & fees

| Requirement | For | Who | Cost |
| --- | --- | --- | --- |
| Google Play Developer | Publishing on Play | You | **$25 once** |
| Apple Developer Program | App Store + push; yearly | You | **$99 / yr** |
| Mac for iOS builds | Apple requires macOS to build/sign iOS — own Mac or cloud Mac | Decision | $0–$1/hr |
| Firebase project | Push delivery (FCM) | I set up | Free |
| Build CI (Codemagic / GitHub Actions) | Auto-build both apps | I set up | Free tier |
| Signing keys / certificates | App identity | You keep, I guide | Free |

**The only real fork is the Mac.** Android needs none. iOS must be built on
macOS — your Mac, or a free-tier cloud-Mac CI (Codemagic) so you never open Xcode.

---

## Store assets

**Graphics:** app icon 1024×1024, adaptive/round icons *(done)*, splash screens,
Play feature graphic 1024×500, phone screenshots (Android + iPhone sets),
optional preview video.

**Copy/metadata:** app name + subtitle (30 char, Apple), short + full description
(≤4000), keywords (100 char, Apple), category Finance/Business, support email +
marketing URL, age rating 18+.

Most are generated from your brand/screens; keywords and subtitle are your call.

---

## Legal & compliance

- **Privacy policy** — live at `/privacy`. ✅
- **Terms of Service** — needed for listings; I'll draft.
- **In-app account deletion + public deletion URL** — both stores now require it;
  new feature, I'll build it.
- **Data Safety (Play) + Privacy Nutrition Labels (Apple)** — declare
  account/financial data, encrypted in transit; I fill from `/privacy`.
- **Payments note for Apple review** — M-Pesa here is your merchants collecting
  from *their* clients (a real-world B2B service), not in-app digital goods, so no
  store commission applies. We state this so review doesn't flag it.

---

## Roadmap

| Phase | Duration | Work |
| --- | --- | --- |
| **0 — Groundwork** | Done | PWA manifest, icons, service worker, asset links, privacy, Android TWA building in CI. |
| **1 — Native shell** | 2–4 days | Add Capacitor; iOS + Android projects; load live app; splash, status bar, deep links. Both apps build & run. |
| **2 — Native features** | 3–5 days | Push (FCM+APNs), biometric unlock, share sheet, camera. |
| **3 — Compliance & assets** | 2–3 days | Account deletion + URL, ToS, screenshots, feature graphic, listing copy, data safety/nutrition. |
| **4 — Beta** | Few days + review | Play Internal Testing + Apple TestFlight; fix feedback. |
| **5 — Launch** | Review ~1–3 days each | Submit to production; go live. |
| **6 — Marketing** | Ongoing | ASO, launch announcement, store badges on the website. |

---

## What I need from you to start

1. **Enroll in both developer programs** — Google Play ($25 once) + Apple ($99/yr).
   These take a day or two to verify, so start them early.
2. **Decide the iOS build machine** — your Mac, or approve free cloud-Mac CI.
3. **Confirm listing basics** — app name + subtitle, category, support email, keywords.
4. **Generate signing keys (guided)** — you run two commands and keep the outputs.

Everything else — code, config, CI, assets from your logo — is on me.

**Fastest start:** kick off the two account enrollments today (slowest external
step); I begin Phase 1 (add Capacitor, get both apps building) in parallel.
