# TallyPay — Investor Funding Proposal

**Confidential — prepared for prospective investors**

| | |
|---|---|
| **Company** | TallyPay (product of Simboni Peter Misiati, Kenya) |
| **Product** | Multi-tenant SaaS billing & payments platform for Kenyan SMEs and freelancers |
| **Web** | https://tallypay.co.ke · Android: `ke.co.tallypay.app` (closed testing, Google Play) |
| **Stage** | Pre-seed (pre-revenue, product live, Android app in closed testing) |
| **Raising** | **KES 26,000,000 (~US$ 200,000)** via post-money SAFE |
| **Runway** | 21–24 months to seed-ready metrics |
| **Contact** | misiatipeter@gmail.com |

> **Note on figures:** All market figures are best-available public estimates (KNBS, CBK, Safaricom
> published results) and all projections are assumptions to be validated in diligence. Exchange
> rate assumed at **KES 130 = US$ 1** throughout.

---

## 1. Executive Summary

Kenyan small businesses run their money on M-Pesa but run their *paperwork* on WhatsApp,
notebooks and spreadsheets. Quotes get lost, invoices go unpaid, VAT is guessed at, and no
one knows what's outstanding. TallyPay closes that gap: a single platform where a business
runs its entire money cycle — **quotation → invoice (deposit + balance + 16% VAT) → receipt** —
with M-Pesa collection built in, automatic receipting, shareable A4 PDFs, and a money
dashboard that shows exactly what is owed and what has been paid.

TallyPay is **built and live**, not a concept:

- Multi-tenant SaaS — every business gets an isolated, white-labelable workspace.
- M-Pesa STK Push collection (via Kopo Kopo aggregation) with automatic receipting.
- Correct-by-design accounting: money stored as integer KES cents, VAT in basis points, unit-tested.
- Free / Pro subscription split, cross-tenant admin console with KPIs and audit log.
- Android app approved by Google Play review and in closed testing (July 2026).

We are raising **KES 26M (~US$200k)** to (1) move from founder-grade to production-grade
infrastructure and payments compliance, (2) make our first engineering and growth hires, and
(3) acquire our first 1,500+ active businesses in Kenya — the metrics that unlock a seed round.

**The one-line pitch:** *QuickBooks-simple invoicing, born on M-Pesa, priced for the 7 million
Kenyan micro and small businesses that will never buy QuickBooks.*

---

## 2. Product & App Assessment (honest, diligence-grade)

Investors will diligence the product; this section pre-empts that with a frank assessment.

### 2.1 What exists today

| Area | Status | Evidence |
|---|---|---|
| Core money cycle (quote → invoice → receipt) | **Live** | Web app at tallypay.co.ke |
| M-Pesa STK collection + auto-receipting | **Live** | Kopo Kopo integration, per-vendor payout accounts encrypted at rest |
| Multi-tenancy & auth | **Live** | better-auth orgs; every query scoped by `requireOrg()` |
| PDF share links (A4 quotes/invoices/receipts) | **Live** | Cloudflare Browser Rendering |
| Email delivery | **Live** | Resend |
| Free/Pro white-label tiers | **Live** | Subscription split implemented |
| Admin console (KPIs, audit log) | **Live** | Cross-tenant |
| Android app | **Approved, closed testing** | Google Play, `ke.co.tallypay.app`, July 2026 |
| Paying customers | **Not yet** | Pre-revenue — the purpose of this raise |

### 2.2 Technical strengths (what de-risks the investment)

1. **Unit economics of the stack.** Next.js 16 on Cloudflare Workers + D1 via OpenNext means
   near-zero marginal hosting cost per tenant and no servers to babysit. Gross margin on
   subscriptions is structurally >90%.
2. **Accounting correctness.** Integer-cents money, basis-point VAT, unit-tested. This is the
   category's hardest trust problem, solved at the foundation rather than patched later.
3. **Payments already integrated.** M-Pesa STK with automatic receipting is the wedge feature;
   it already works through a licensed aggregator (Kopo Kopo), which defers the need for our
   own CBK Payment Service Provider licence.
4. **Security posture.** Per-vendor credentials encrypted at rest; tenant isolation enforced at
   the query layer; audit log in the admin console.

### 2.3 Known gaps (what this raise fixes)

1. **Infrastructure resilience.** Single-region, founder-managed deployment; no formal SLA,
   on-call, staging/production separation, disaster-recovery drills, or independent security
   audit. *This is the primary use of funds.*
2. **Key-person risk.** One founder-engineer. First hires (backend + support/success) are in
   the budget.
3. **Zero installed audience.** Play listing shows 0 installs — closed testing only began
   July 2026. Distribution, not product, is the current constraint.
4. **Compliance formalisation.** Data Protection Act 2019 registration (ODPC), terms of
   service, KYC flow hardening, and a legal opinion on the aggregator model are budgeted.
5. **No revenue history.** Projections below are assumption-driven; the raise is sized to
   produce 12+ months of real cohort data before a seed round.

---

## 3. Problem & Solution

### 3.1 The problem

- Kenya has an estimated **7.4 million MSMEs** (KNBS MSME survey), the vast majority informal
  or semi-formal. They transact digitally — M-Pesa moves the equivalent of well over half of
  Kenya's GDP annually — but **document nothing digitally**.
- Consequences: unpaid invoices with no follow-up trail, VAT (16%) computed by hand or ignored
  (a growing risk as KRA's eTIMS e-invoicing enforcement expands), no separation between
  personal and business money, and no records with which to access credit.
- Existing tools fail them: QuickBooks/Xero are priced in dollars for accountants;
  Wave has no M-Pesa; local ERP is sold to mid-size firms. The gap is the **KES 500–1,500/month,
  M-Pesa-first, phone-first** tier.

### 3.2 The solution

TallyPay is the money-cycle system for that tier:

- **Quote → Invoice → Receipt** in minutes, with deposits, balances and 16% VAT handled correctly.
- **Get paid inside the invoice** — client taps, STK push fires, receipt generates itself.
- **Know what's outstanding** — a live money dashboard per business.
- **Look professional** — branded A4 PDFs, share links, white-label on Pro.
- **Phone-first** — Android app + responsive web; built for the device the market actually uses.

---

## 4. Market Analysis

### 4.1 Market sizing (Kenya first)

| Layer | Definition | Size | Annual value to TallyPay |
|---|---|---|---|
| **TAM** | Kenyan MSMEs + freelancers who invoice or should invoice | ~7.4M MSMEs; ~1.56M licensed | KES 50B+ (at KES 6,000/yr blended) |
| **SAM** | Smartphone-owning, M-Pesa-transacting businesses that issue quotes/invoices (services, trades, agencies, suppliers, clinics, schools' vendors) | ~1.0–1.5M | KES 7–10B |
| **SOM (36 months)** | Realistically winnable share via digital + partner channels | 25,000 active businesses, ~3,500 paying | ~KES 55–65M ARR |

*Method: top-down from KNBS MSME counts cross-checked bottom-up against smartphone penetration
(~60%+ of connections) and M-Pesa business tills (Lipa na M-Pesa merchants exceed 600k). Figures
to be refreshed with current CBK/CA data during diligence.*

### 4.2 Tailwinds

1. **eTIMS enforcement.** KRA now requires electronic invoicing for tax-deductible expenses —
   every year more SMEs *must* produce compliant invoices. Compliance is a forcing function
   for exactly our product.
2. **M-Pesa ubiquity.** >96% of Kenyan households use mobile money; STK push is a universally
   understood payment gesture.
3. **Credit rails need records.** Digital lenders and banks increasingly underwrite on
   transaction history — TallyPay's ledger becomes the SME's bankable record (a future
   revenue line, not in current projections).
4. **Regional replication.** The same playbook ports to Tanzania (M-Pesa TZ), Uganda (MTN MoMo),
   and Rwanda with aggregator swaps, not rewrites.

### 4.3 Competitive landscape

| Competitor | Positioning | Why TallyPay wins the segment |
|---|---|---|
| QuickBooks / Zoho Books / Xero | Global accounting suites, USD pricing | Too complex, too costly; no native M-Pesa STK collection |
| Wave (free invoicing) | Free global invoicing | No M-Pesa, no VAT-Kenya logic, payments US-centric |
| Local ERPs / POS vendors | Mid-market, sold with hardware | Wrong price point; not self-serve |
| Kopo Kopo / Pesapal / DPO tools | Payments-first with basic invoicing add-ons | Payments companies, not workflow companies — we own the document trail and partner for rails |
| WhatsApp + Excel (status quo) | Free, familiar | Our real competitor; we win on unpaid-invoice pain + professional PDFs + auto-receipts |

**Moat trajectory:** correctness + workflow lock-in (a business's entire document and payment
history) → data network (receivables ledger) → distribution partnerships (SACCOs, banks,
accountant networks).

---

## 5. Business Model

| Stream | Mechanics | Assumptions |
|---|---|---|
| **Pro subscriptions** (core) | Free tier (limited docs/branding) → Pro at **KES 1,000/mo or KES 10,000/yr** (white-label, unlimited docs, team seats) | 10–15% free→paid conversion at maturity |
| **Payment margin** | Share of aggregator fee on M-Pesa collections (~0.25–0.5% of volume net to TallyPay) | Only Pro-tier volume modelled |
| **Future (not modelled)** | eTIMS filing add-on, receivables financing referrals, API access | Upside, not in projections |

Unit economics targets: CAC < KES 1,500 blended (digital + referral), payback < 3 months,
gross margin > 85%, monthly churn < 4% at maturity.

---

## 6. Traction & Milestones to Date

- **2026 Q2–Q3:** Platform built and deployed (web live at tallypay.co.ke); Android app passed
  Google Play review; closed testing underway (Play requirement: 12 testers × 14 days before
  production access — in progress).
- Built by a founder with shipped, production M-Pesa systems for real clients (ticketing
  platform with double-entry ledger for 64 Theatre, Eldoret; multiple business platforms) —
  see portfolio: the founder has repeatedly delivered fintech-grade work solo.
- Existing lead channel: the founder's agency client base and marketing pipeline (documented
  marketing plan, outreach templates, lead CSV in-house) seeds the first cohort.

---

## 7. Go-to-Market & Market Entry Strategy

### Phase 0 — Closed beta (Months 0–3)
- Complete Play closed-testing requirement; recruit 50–100 beta businesses from the founder's
  existing client/lead network (agencies, gyms, clinics, theatres, contractors).
- Instrument activation funnel: signup → first invoice → first M-Pesa collection ("aha" moment).
- Success gate: 40% of signups send a real invoice in week one; NPS > 40.

### Phase 1 — Nairobi + Western Kenya launch (Months 3–9)
- **Channels:** WhatsApp/Facebook SME communities, Google Play + ASO, targeted Meta ads
  (KES-priced, vernacular creative), founder-led demos to trade associations.
- **Partnerships:** accountants and bookkeepers (revenue share on referred Pro accounts);
  Kopo Kopo merchant base co-marketing.
- Target: 1,500 registered businesses, 150 paying.

### Phase 2 — Kenya scale + compliance wedge (Months 9–18)
- eTIMS-compliance marketing ("be KRA-ready in 10 minutes"); SACCO and bank SME-desk
  partnerships; referral program inside the product (every invoice/PDF is a viral surface —
  the recipient sees "Powered by TallyPay").
- Target: 6,000–8,000 registered, 800–1,000 paying.

### Phase 3 — East Africa entry (Months 18–36, seed-funded)
- Tanzania and Uganda via aggregator integrations (M-Pesa TZ, MTN MoMo) and local pricing;
  Rwanda opportunistically. Entry mode: remote-first digital acquisition + one country
  partner-manager per market; no offices.
- Target: 25,000 registered, 3,500 paying across the region.

---

## 8. Infrastructure & Technology Plan (why we're raising)

The explicit purpose of this round is to make TallyPay boringly reliable:

1. **Production hardening (KES 4.5M):** staging/prod separation, automated backups and
   point-in-time recovery for D1, multi-region failover posture, uptime monitoring and
   on-call, load testing, 99.9% internal SLO.
2. **Security & compliance (KES 3.5M):** independent penetration test, ODPC data-protection
   registration and DPIA, SOC2-lite controls documentation, legal opinion on payments model,
   standard contracts (ToS, DPA).
3. **Payments resilience (KES 2.0M):** second aggregator integration (e.g. Pesapal or direct
   Daraja for tills) so no single point of failure on collections; reconciliation tooling.
4. **Product completion (KES 3.0M):** offline-tolerant Android release to production, eTIMS
   integration, team seats/roles, statements & aging reports.

---

## 9. Financial Projections (3 years, KES)

**Key assumptions:** Pro price KES 1,000/mo; free→paid conversion ramping 8%→14%; monthly
churn 6% falling to 3.5%; payment margin 0.35% on Pro-tier M-Pesa volume (avg KES 150k
collected /paying business/mo by Y3); costs include team ramp to 6 FTE by Y3.

| | Y1 (2027) | Y2 (2028) | Y3 (2029) |
|---|---:|---:|---:|
| Registered businesses (cum.) | 1,500 | 8,000 | 25,000 |
| Paying businesses (avg) | 100 | 850 | 3,200 |
| Subscription revenue | 1,200,000 | 10,200,000 | 38,400,000 |
| Payment margin revenue | 300,000 | 3,600,000 | 20,200,000 |
| **Total revenue** | **1,500,000** | **13,800,000** | **58,600,000** |
| COGS (infra, aggregator, support) | 600,000 | 2,800,000 | 8,800,000 |
| **Gross profit (margin)** | 900,000 (60%) | 11,000,000 (80%) | 49,800,000 (85%) |
| Opex (team, GTM, compliance) | 14,500,000 | 22,000,000 | 34,000,000 |
| **EBITDA** | (13,600,000) | (11,000,000) | 15,800,000 |

- **Break-even:** month ~30 at ~2,400 paying businesses.
- **This raise (KES 26M) funds:** all of Y1 and most of Y2 opex net of revenue → 21–24 months
  runway; seed round (~US$0.75–1.5M) targeted at Month 18–21 on the back of Y2 cohort data.
- Sensitivity: at half the paying-customer ramp, runway still exceeds 18 months (GTM spend is
  the flexible line); at KES 1,500 Pro pricing (to be A/B tested), Y3 revenue exceeds KES 75M.

---

## 10. The Ask & Use of Funds

**Raising KES 26,000,000 (~US$200,000) on a post-money SAFE, valuation cap US$1.5–2.0M,
20% discount** (YC-standard instrument; fast, no board mechanics at pre-seed).
Minimum ticket KES 1.3M (~US$10k); anchor ticket sought: KES 6.5M+ (~US$50k).

| Use | KES | % |
|---|---:|---:|
| Infrastructure, security & compliance (Section 8) | 8,000,000 | 31% |
| Engineering hires (1 senior full-stack, 1 support/success) | 7,500,000 | 29% |
| Go-to-market (performance ads, partnerships, content, referral incentives) | 6,000,000 | 23% |
| Founder salary (below-market) + ops/legal/accounting | 3,500,000 | 13% |
| Contingency | 1,000,000 | 4% |

**Milestones this money buys (seed-readiness criteria):**
1. 99.9% uptime over 6 consecutive months, pen-test passed, ODPC registered.
2. ≥1,500 registered businesses; ≥150 paying; ≥KES 250k MRR run-rate by Month 18.
3. Cohort data proving <4% monthly churn and <3-month CAC payback.
4. Android app in public production on Google Play; eTIMS integration live.

---

## 11. Funding Sources & Investor Targeting Strategy

Ranked by fit for a Kenyan pre-seed fintech-SaaS: *(verify each fund's current status/mandate
before outreach — mandates change.)*

### Tier 1 — Africa-focused pre-seed/seed venture funds
- **Launch Africa Ventures** — pan-African pre-seed/seed specialist, $25–150k tickets.
- **The Baobab Network** (Nairobi) — accelerator + $50–100k investments, Nairobi-based.
- **Antler East Africa** (Nairobi) — residency + pre-seed cheques for solo founders seeking co-founders/first hires.
- **54 Collective / Founders Factory Africa** — venture studio capital + build support.
- **Renew Capital** — Africa-wide early-stage, founder-friendly process.
- **Village Capital Africa** — fintech/SME-economy programs, peer-selected investment.
- **Norrsken (Nairobi house)** — East-Africa early-stage ecosystem + fund.

### Tier 2 — Angels & syndicates
- Kenyan/diaspora angel networks: **Viktoria Ventures / ViKtoria Business Angels Network (VBAN)**,
  **Kenya's KEPSA-linked angels**, Lagos–Nairobi syndicates on **AngelList/Flashpoint-style SPVs**.
- Strategic angels: senior operators from Safaricom/M-Pesa, Kopo Kopo, Cellulant, Pesapal —
  they bring distribution knowledge, not just money. Target 4–6 angels at KES 1.3–3.9M each.

### Tier 3 — Grants & non-dilutive (parallel track, no equity cost)
- **GSMA Innovation Fund** rounds (mobile-money SME tooling fits historically).
- **Mastercard Foundation / partner programs** (Kenya SME digitisation).
- **Google for Startups** programs (Black Founders Fund Africa historically; equity-free).
- **KIEP / World Bank-financed Kenyan innovation grants** via Ministry of ICT windows.
- **Westerwelle Foundation, Orange Corners, GIZ Make-IT in Africa** — grants + networks.

### Tier 4 — Strategic/corporate
- **Safaricom Spark / corporate venture** and **bank SME innovation arms** (Equity, KCB, NCBA) —
  better as Phase-2/seed partners than pre-seed leads; open relationships now, raise from them later.

### Outreach plan (90 days)
1. **Weeks 1–2:** Data room assembled (see checklist below); 3-minute demo video; 12-slide deck
   distilled from this proposal.
2. **Weeks 2–6:** Warm-intro mapping (LinkedIn 2nd-degree to each Tier-1 fund), apply to Antler
   EA + Baobab + Village Capital cohorts, 20 angel conversations from strategic list.
3. **Weeks 6–12:** Term negotiation; aim to anchor with one Tier-1 fund + fill with angels;
   parallel grant applications (Tier 3) regardless of round progress.

**Data-room checklist:** cap table, SAFE template, incorporation + IP assignment docs, product
demo access, architecture note, security summary, this proposal + financial model (editable),
Play Console screenshots, pipeline/lead evidence, founder CV, references.

---

## 12. Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Slow SME willingness-to-pay | Medium | High | Free tier + payment-margin monetisation; eTIMS compliance as forcing function; annual-plan discounts |
| Single-founder execution risk | High (today) | High | First two hires in budget; advisor bench; documented codebase |
| Aggregator dependency (Kopo Kopo) | Medium | High | Second aggregator integration funded in this round |
| Regulatory change (CBK PSP rules, ODPC) | Medium | Medium | Legal opinion + ODPC registration budgeted; aggregator model keeps us outside licence perimeter initially |
| Big-player entry (Safaricom, banks) | Medium | Medium | Speed + workflow depth; position as partner/acquisition target for exactly these players |
| Churn among micro-SMEs | High | Medium | Annual plans, document-history lock-in, accountant channel (sticky intermediary) |
| FX/macro (KES volatility) | Medium | Low | Costs and revenue both in KES; raise partially in USD |

---

## 13. Team

**Peter Misiati — Founder & CEO/CTO.** Full-stack engineer with a track record of shipping
production fintech solo: TallyPay itself; an M-Pesa ticketing platform with a double-entry
ledger and offline QR gate scanning (64 Theatre, Eldoret); multiple production business
platforms for Kenyan clients. Runs an active client agency — meaning proven ability to sell
to exactly the SME persona TallyPay serves.

**Planned hires (this round):** senior full-stack engineer (Month 2), customer
support/success (Month 4). **Advisors sought:** payments-regulatory counsel; a former
mobile-money operator executive (offer 0.25–0.5% advisor equity each).

---

## 14. Exit & Return Potential

- **Comparable outcomes:** African SME-fintech has exits and markups via strategic
  acquisition — payments companies and banks acquiring workflow layers (regional precedent:
  aggregators and SME-tool acquisitions by Cellulant-class players, bank digital arms, and
  global SaaS entering Africa).
- **Plausible paths:** (1) acquisition by a payments company or bank wanting the SME
  document/data layer; (2) regional SaaS consolidation; (3) long-hold profitable SaaS
  (break-even Month ~30) with dividend capacity — downside protection unusual at this stage.
- A US$2M-cap SAFE returning through a seed at US$8–10M and a Series A at US$25M+ offers
  early investors a credible 10–15× marked path inside 4 years, with the strategic-acquirer
  landscape (telcos, banks, PSPs) providing multiple realistic buyers at each stage.

---

## 15. Closing & Next Steps

TallyPay is past the riskiest phase of any startup — *"can it be built?"* — with a live,
architecturally serious product and an approved Android app. This round converts a working
product into a durable company: hardened infrastructure, first hires, and a repeatable
acquisition engine, in a market where 7 million businesses already pay each other on their
phones but still invoice on paper.

**To proceed:**
1. 30-minute product demo (live workspace, real STK push, admin console).
2. Data-room access under mutual NDA.
3. SAFE docs ready for signature — target close within 6 weeks of first meeting.

**Peter Misiati** · misiatipeter@gmail.com · https://tallypay.co.ke

*This document contains forward-looking statements based on assumptions believed reasonable as
of July 2026; actual results may differ materially. It is an invitation to discuss investment,
not an offer of securities.*
