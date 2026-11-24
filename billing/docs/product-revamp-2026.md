# TallyPay — Product Revamp Blueprint

**Research + design plan · November 2026**

> Research sources are web searches run on 2026-11-24 and a direct inventory of
> this codebase. Where a figure comes from a vendor's own marketing it is
> labelled as such — much of the "AI accounting" literature is written by
> people selling AI accounting.

---

## 1. Where TallyPay actually stands

Taking stock honestly matters, because the gap between TallyPay and a tier-one
tool is **not** the feature count. The feature list is already strong:

| Already built | |
|---|---|
| Documents | quotations, invoices (deposit + balance + 16% VAT), receipts, credit notes, delivery notes, recurring invoices |
| Records | clients, item catalogue, expenses, client statements, reports |
| Money | M-Pesa STK via Kopo Kopo, manual payment recording, per-vendor payout accounts |
| Sharing | public share links, 5 A4 PDF templates, email delivery, WhatsApp share |
| Platform | multi-tenant orgs, free/Pro white-label, cross-tenant admin console with audit log |
| Client | PWA, push notifications, pull-to-refresh, dark mode, Android app (Capacitor) |

That is a *lot*. Around 40 routes. Most invoicing startups do not get this far.

**So the revamp is not "add more features." It is four specific gaps**, found by
grepping the codebase rather than guessing:

1. **No payment chasing of any kind.** `grep -rE "reminder|dunning|overdue.*notif"` across
   `src/server` and `src/app` returns nothing. The product can create an invoice
   beautifully and then does nothing whatsoever to get it paid. For an invoicing
   tool this is the single largest omission — it is the core job.
2. **No eTIMS integration.** Since 1 January 2026 KRA reconciles declared income
   and expenses against eTIMS records. Every Kenyan business using TallyPay for
   real invoicing is non-compliant by default.
3. **No command palette, no keyboard shortcuts, no global search.**
   `grep -rE "cmdk|command.?palette|useHotkeys"` returns nothing. This is most of
   what separates software that *feels* expensive from software that doesn't.
4. **No AI, though it is already sold.** `PRO_FEATURES` in `src/lib/plan.ts`
   advertises "AI invoice creation — describe the job, get a ready invoice" as
   *coming soon*. It has been coming soon since July.

Everything below is sequenced against those four.

---

## 2. The strategic read

### 2.1 eTIMS is the wedge, not a chore

This is the most important finding of the research, and it is specific to
TallyPay's market.

KRA's position is that **all persons carrying on business — including the
informal sector and small businesses — must electronically generate and
transmit their invoices** ([KRA press release](https://www.kra.go.ke/news-center/press-release/2093-simplified-etims-solutions-for-informal-sector-and-small-businesses)).
From 1 January 2026, KRA checks declared income and expenses against eTIMS
records, and the Finance Act 2026 tightened penalties for failing to issue
invoices through eTIMS ([eTIMS 2026 guide](https://leadafrik.com/guides/etims-explained-kenya),
[compliance guide](https://dddinvoices.com/learn/kenya-e-invoicing-a-complete-guide-to-etims-compliance)).

The free government options — USSD `*222#` and eTIMS Lite — are deliberately
minimal. They are not an invoicing product; they are a tax filing obligation.

> **The positioning writes itself: every invoice you send is already a valid KRA
> tax invoice.** That turns a compliance burden into the reason to use TallyPay
> rather than a notebook — and it is a reason no global competitor
> (FreshBooks, Wave, Stripe) will ever serve, because the market is too small
> for them and too specific.

This also makes the free tier defensible. Compliance is the hook; AI and
white-label are the upsell.

### 2.2 What the global tools are actually competing on

From the 2026 roundups ([Rho](https://www.rho.co/blog/best-invoicing-software-for-small-businesses),
[Zapier](https://zapier.com/blog/best-free-invoice-software/),
[Forbes](https://www.forbes.com/advisor/business/software/best-invoicing-software/)):

- **Free tiers are table stakes and heavily capped.** Zoho Invoice caps at 2
  users / 500 invoices a year. Wave gives unlimited invoices but monetises
  payment processing. TallyPay's uncapped free tier is genuinely differentiated
  — keep it, and monetise elsewhere.
- **Nobody wins on "can create an invoice."** They compete on getting paid
  faster, on reducing data entry, and on integrations.
- **Stripe Invoicing charges 0.4–0.5% per paid invoice** on top of processing.
  That is the model TallyPay already mirrors via Kopo Kopo margin.

### 2.3 The AI layer, and how to charge for it

The 2026 consensus is hybrid pricing: a familiar base plan plus a metered usage
layer, with credits as the meter ([Metronome's catalogue of 50+ AI pricing models](https://metronome.com/blog/2026-trends-from-cataloging-50-ai-pricing-models),
[Schematic](https://schematichq.com/blog/ai-credit-system)). Freemium with
tiered subscriptions and usage constraints is the most common consumer-facing
pattern. GitHub Copilot moved monthly plans to metered credits in June 2026.

Three practices recur, and all three should be built in from day one:

- **Show the cost before the action runs.** Never surprise someone with a
  balance drop.
- **Hard caps and rate limits**, so a runaway automation cannot drain a vendor's
  balance or your margin.
- **Treat credits as a measuring instrument, not the final model.** They exist
  so you learn what people actually value before you commit to pricing it.

On capability, the useful pattern from the market is **draft-then-approve**:
agents prepare, humans post. Ramp's accounting agent codes transactions then
reviews policy before syncing; BILL's reconciliation agent codes expense
transactions; the better products "flag the document for review instead of
making up a figure" ([Ramp](https://next.ramp.com/blog/ai-accounting-software),
[BILL](https://www.bill.com/blog/best-invoice-automation-software),
[DualEntry](https://www.dualentry.com/blog/best-ai-accounting-software)).
Vendor auto-match claims of 95%+ are marketing, not benchmarks — treat them as
a target to measure against, not a promise to repeat.

**For a money product this matters more than usual: an AI that silently invents
a VAT figure is worse than no AI.** Every AI write path must land in a draft a
human confirms.

### 2.4 What "expensive" feels like

From the UX research ([SaaS UX benchmark](https://cybertizeweb.com/blog/ui-ux/saas-ux-benchmark-report-2026-27/),
[SaaS UI trends](https://www.saasui.design/blog/7-saas-ui-design-trends-2026),
[design trends](https://www.tenscope.com/ui-ux-guide/saas-design-trends-2026-moving-from-complexity-to-confidence)):

- **⌘K is now a baseline expectation in B2B SaaS**, not a power-user extra — and
  it should augment navigation, not replace it.
- **Linear is the reference** everyone cites, and what they cite is *speed*:
  optimistic UI, local-first architecture, aggressive caching.
- **Density is back.** "Design for the user's twentieth session, not their
  first." An invoicing tool is used daily by the same person; it should reward
  familiarity, not re-explain itself.
- **Accessibility is table stakes**: contrast, keyboard navigation, focus
  states, screen-reader support.

One caveat I'd flag: a widely-repeated "25% task completion improvement from
command palettes" statistic appears in these articles with no underlying study.
Don't put it in a pitch deck.

### 2.5 The open-source field

Searching the current landscape ([GitHub invoicing topic](https://github.com/topics/invoicing)):
**InvoiceShelf** (AGPL, v2.4.8 Nov 2026), **SolidInvoice** (PHP/Symfony, MIT),
**InvoicePlane** (PHP/CodeIgniter), **FOSSBilling** (Apache-2.0), and
**[Inkvoice](https://github.com/pigontech/inkvoice)** — Bun + Hono + React on a
single SQLite file, ~50 MB RAM, with German and French e-invoicing formats.

Two things worth stealing:

- **Inkvoice's shape is TallyPay's shape.** Single SQLite file, tiny footprint —
  exactly where the migration just landed you. That architecture is current, not
  a compromise.
- **Nobody in this field does African mobile money or KRA compliance.** The
  open-source competition is European/US e-invoicing. The moat is real.

---

## 3. The blueprint

### 3.1 Information architecture

The current sidebar is a flat list of 12 document types. That is a filing
cabinet, not a workflow. Reorganise around **what the user is trying to do**:

```
GET PAID            Invoices · Quotations · Recurring · Reminders ← new
MONEY IN/OUT        Payments · Receipts · Expenses · Credit notes
WHO & WHAT          Clients · Items · Delivery notes
KNOW                Dashboard · Reports · eTIMS ← new
```

Four groups, each a sentence a business owner would say. "Reminders" and
"eTIMS" are new top-level objects because they are new *jobs*, not new forms.

### 3.2 The money cycle, completed

Today the cycle stops at "invoice sent." The revamp closes the loop:

```
quote → invoice → SEND → [ chase ] → pay → receipt → [ file to KRA ]
                           ↑ new                        ↑ new
```

**Reminders engine** — the highest-ROI thing in this document:

- Per-org schedule: e.g. 3 days before due, on due date, +3, +7, +14
- Channel ladder: **WhatsApp first** (it is how Kenyan business actually
  communicates), then SMS, then email
- Every reminder carries the pay link; one tap to STK push
- Auto-stop on payment, manual snooze, per-client opt-out
- A "Needs chasing" queue on the dashboard — the first thing you see each morning
- Tone presets: *friendly → firm → final*. Getting paid is a relationship.

This is mostly scheduling and messaging on top of data you already have.

### 3.3 Speed and the interaction model

This is what makes it feel like a million-dollar tool, and it is the cheapest
part of the whole plan.

- **⌘K command palette** (`cmdk`): jump to any client, invoice number or action.
  "INV-0042", "new invoice for Zippy", "unpaid over 30 days".
- **Keyboard-first document editor**: `Tab` through lines, `⌘Enter` to save,
  `⌘D` duplicate line, `/` to search items inline. A user invoicing daily should
  never need the mouse.
- **Optimistic UI everywhere.** Saving an invoice should feel instant; the
  network is confirmation, not permission. Pair with the atomic `db.batch()`
  writes already in place so a rollback is honest.
- **Global search** across invoice numbers, client names, amounts, line text.
- **Command-line-grade empty states** that teach the shortcut, not just the button.

### 3.4 PWA — the web *is* the app

**Decision (Nov 2026): web only. No native Android work.** The PWA carries the
whole mobile story, which means the offline work below stops being a nice
finishing touch and becomes the thing that decides whether TallyPay is usable
at a client site, in a market, or on a construction yard where signal is not a
given.

#### What a PWA can and cannot do, checked rather than assumed

Android/Chromium is permissive. **iOS is the constraint that shapes the
architecture**, and the sources are consistent on these points
([openpwa](https://openpwa.net/news/pwas-on-iphone-what-works-and-what-does-not-october-2026/),
[iOS web push 2026](https://relaybell.com/blog/ios-web-push-2026),
[iOS PWA limitations](https://tappwa.com/blog/ios-pwa-limitations-2026)):

| Capability | Android / Chromium | iOS Safari |
|---|---|---|
| Install | Automatic prompt (`beforeinstallprompt`) | **Share sheet only — no prompt** |
| Web Push | Yes, from a tab | **Only after Add to Home Screen** (iOS 16.4+) |
| Badging (count on icon) | Yes | Yes, Home Screen apps, numeric only |
| **Background Sync** | Yes | **No. Also no Periodic Sync, no Background Fetch** |
| Web Share Target | Yes | No |
| Camera (`getUserMedia`) | Yes | Yes |

Three consequences, each of which is a design decision rather than a detail:

1. **Background Sync cannot be the sync mechanism.** It is Chromium-only — not
   Safari, not Firefox. A **sync-on-focus fallback is mandatory**, firing on
   `visibilitychange`, `online`, and app launch. Background Sync becomes an
   optimisation where it happens to exist, never the contract.
2. **On iOS, push requires installation first.** So the order is: earn the
   install, *then* ask for notification permission. Asking first simply fails.
   And Safari revokes push permission if you send a push without showing a
   notification — so no silent pushes, ever.
3. **Installation needs teaching on iOS.** No prompt exists. A dismissible,
   once-only coach mark showing the share-sheet route, triggered on second or
   third visit from an iOS browser — not on first load, which people reflexively
   dismiss.

#### The offline architecture

The field has converged on three layers
([LogRocket](https://blog.logrocket.com/offline-first-frontend-apps-2025-indexeddb-sqlite/),
[production patterns](https://letsbuildsolutions.com/blog/web-engineering/building-offline-first-web-applications-service-workers-indexeddb-and-sync-strategies-in-production/),
[conflict algorithms](https://www.browser-storage.com/offline-sync-strategies-background-workflows/conflict-resolution-algorithms/)):

**1. Local store** — IndexedDB (Dexie or `idb`) holding the app shell plus the
user's working set: their clients, items, and recent invoices. Not the whole
database; the working set.

**2. Durable mutation queue** — writes are recorded locally and replayed in
order on reconnect, with exponential backoff and a dead-letter path for
anything that fails repeatedly. Order matters here more than in most apps: an
invoice must exist before its payment.

> **An IndexedDB gotcha worth knowing before it bites:** a transaction stays
> alive only while it has pending requests. The moment the event loop yields
> with none outstanding, it commits and closes. So resolve a merge in memory
> first, then open a *fresh* readwrite transaction for the read-verify-write.
> Doing the merge inside the transaction silently loses the write.

**3. Conflict policy** — add `updated_at` to every synced row, return **409** on
conflict, and have the client mark the record as conflicted rather than
guessing. Start with **last-write-wins**; add anything cleverer only if real
data loss actually shows up. The consensus advice is explicit about not
reaching for CRDTs prematurely.

For TallyPay specifically, LWW is wrong in one place and right everywhere else:

- **Invoice numbering is server-authoritative, always.** Two people offline must
  never mint `INV-0042`. Offline drafts carry a local id and receive their real
  number at sync.
- **Money rows never silently merge.** A conflicted payment surfaces for a
  human. Getting this wrong means quietly losing a receipt, which is worse than
  any amount of downtime.
- Content fields (descriptions, client details) can take last-write-wins.

**4. Honest sync state** — a persistent, visible indicator: *"3 invoices waiting
to sync."* Never a spinner that implies saved when it means queued. For money,
ambiguity is worse than being offline.

#### Other PWA wins worth taking

- **Badging API** — overdue invoice count on the home-screen icon. Works on both
  platforms, costs almost nothing, and puts "you are owed money" in the user's
  peripheral vision every day.
- **Camera capture** for receipts, feeding the AI expense path below. No native
  code needed.
- **Web Share** for sending invoice links — already in use via the WhatsApp
  button.

#### The existing Android app

One operational note, then I'll leave it alone as asked: there is a published
Play app wrapping `tallypay.co.ke`, and real users are on it. Deprioritising
Android does not make them disappear — it means **`tallypay.co.ke` must keep
resolving to a working deployment** until they are migrated to the PWA, or they
simply lose the product. Worth a deliberate decision later, not a drift.

### 3.5 The AI layer

Build in this order — cheapest and most valuable first.

| Feature | What it does | Credits |
|---|---|---|
| **Invoice from a sentence** | "website + 1yr hosting for Acme, 50% deposit" → a complete draft with lines, VAT, totals | 1 |
| **Receipt → expense** | photograph a receipt, get a categorised expense with VAT split | 1 |
| **Smart reminder copy** | drafts the chase message in the right tone, in English or Kiswahili | 1 |
| **Quote → invoice narration** | turns rough site notes into client-ready line descriptions | 1 |
| **Ask your books** | "who owes me most?", "what did I spend on fuel last quarter?" | 2 |
| **Monthly summary** | a written month-end: what came in, what's owed, who's slow | 5 |

Rules, non-negotiable:

1. **Everything lands as a draft.** No AI output posts money without a human tap.
2. **Show the credit cost before the run**, and the balance after.
3. **Hard monthly cap per org**, default on, overridable.
4. **Log every AI action in the audit log** with its input and output. When an
   AI gets a VAT figure wrong — and it will — you need to find every invoice it
   touched.
5. **Kiswahili and Sheng tolerance on input.** Real users will not type formal
   English. This is a genuine moat a US tool will not build.

**Pricing:** free tier gets a small monthly allowance (say 20 credits) so people
feel it work. Pro includes a larger bundle. Top-ups sold in packs via M-Pesa —
the same rails the product already runs on, which is a real advantage over
competitors billing in dollars.

### 3.6 eTIMS compliance

The feature that makes TallyPay legally necessary rather than merely useful.

- OSCU/VSCU integration so an issued invoice is transmitted and returns its
  KRA control code and QR
- The control code and QR printed on the PDF — that is what makes it a valid tax
  invoice
- A compliance panel: what's filed, what failed, what needs attention
- Buyer-initiated / reverse invoicing for suppliers who cannot issue their own
  (KRA is actively pushing this for farmers)
- Graceful degradation: if KRA's endpoint is down, queue and retry — never block
  the user from invoicing

**Caveat before building:** the exact turnover exemption thresholds and the
current Finance Act 2026 penalty wording were not confirmable from primary
sources in my research — the guides cite them without figures. Confirm directly
with KRA or a tax advisor before you put compliance claims in marketing.

### 3.7 Visual language

Keep the existing emerald identity; sharpen the execution.

- **Numbers are the product.** Tabular figures, right-aligned, consistent
  decimals, currency never ambiguous. A money app that misaligns a column looks
  untrustworthy.
- **One accent colour, used sparingly.** Emerald means "money moved." If
  everything is emerald, nothing is.
- **Status as colour + shape + text**, never colour alone — both for
  accessibility and for printing in black and white.
- **Documents should look like documents.** The 5 PDF templates are an asset;
  the in-app preview should match the PDF exactly, so there is no surprise.
- **Dark mode already exists** — hold it to the same standard, especially the
  PDF preview surfaces.
- Density setting: comfortable / compact. Power users will choose compact.

---

## 4. Sequencing

Ordered by value per unit of work, not by excitement.

**Phase 1 — Close the loop (2–3 weeks).** Reminders engine with WhatsApp/SMS/email
ladder, "needs chasing" queue, payment links in every message. *This is the one
that makes users money, and it is mostly scheduling on top of existing data.*

**Phase 2 — Make it feel expensive (1–2 weeks).** ⌘K palette, global search,
keyboard editor, optimistic saves, density setting. Small, highly visible,
disproportionate effect on perception.

**Phase 3 — eTIMS (3–4 weeks, plus KRA onboarding time).** The compliance wedge.
Start the KRA paperwork early; integration is rarely the slow part.

**Phase 4 — PWA offline-first (3–4 weeks).** Promoted from last place by the
web-only decision: with no native app, this *is* the mobile product. Local
store, mutation queue, sync-on-focus, honest sync state, install coaching,
badging. Hardest phase, and no longer optional.

**Phase 5 — AI layer + credits (3–4 weeks).** Invoice-from-a-sentence and
receipt capture first; the ledger, caps and audit logging alongside. Ship the
feature already advertised. Deliberately after offline, because an AI that only
works with signal is a demo, not a tool.

---

## 5. What I'd push back on

Three honest notes, since the brief said not to be limited by it:

**You do not have a feature problem.** The instinct to "revamp" usually means
adding; here the evidence says the opposite. Forty routes already exist and
nobody is being chased for payment. Resist building a sixth document type before
the first reminder goes out.

**Free + AI credits is a good model, but the free tier has to stay genuinely
free.** The research shows competitors capping free tiers hard (Zoho: 500
invoices/year). Your uncapped free tier plus compliance is a sharper wedge than
any feature. Monetise AI, white-label and payment margin — never the invoice
itself.

**Going web-only raises the bar on the PWA rather than lowering it.** Dropping
native Android removes a build pipeline and a review queue, which is a real
saving. But it also removes the fallback: if the PWA is slow or useless
offline, there is no second mobile experience to hide behind. Phase 4 is now
load-bearing, and the iOS limits above mean it cannot be done by installing a
service-worker library and hoping.

---

## 6. Open questions

1. Has anyone on TallyPay asked for eTIMS, or is this inferred from the
   regulation? Worth asking five of the 27 vendors before committing 4 weeks.
2. What is the actual WhatsApp channel — Business API (costly, reliable) or
   click-to-chat links (free, manual)? This decides the reminders architecture.
3. Does the AI run on-device, via API, or hybrid? Cost per credit depends
   entirely on this, and so does the price.
4. Who are the 27 organisations? Their usage patterns should rank this roadmap
   ahead of any research I can do from outside.
