# 64THEATRE Ticketing Platform — Development Plan & Technical Proposal

**Version 1.0 — For Client Review Before Development Begins**

| | |
|---|---|
| **Client** | 64 Theatre Limited (Eldoret, Kenya) |
| **Project** | In-house ticketing platform, architected to extend into a multi-vendor marketplace |
| **Status** | Draft for review — development starts on written approval of Section 12 |
| **Date** | 7 July 2026 |

---

## 1. Executive Summary

64 Theatre Limited will get a **ticketing platform for its own productions first** — selling tickets online via M-Pesa, delivering them by SMS/email with QR codes, and validating them at the gate with an offline-capable scanner. The system will be **built multi-tenant from day one at the database and permissions level**, so that opening it up to other organisers later (the marketplace phase) is a configuration-and-features exercise, not a rewrite.

The recommended path is a **modular monolith** on a proven, locally maintainable stack (Laravel + PostgreSQL + Redis), M-Pesa via **Safaricom Daraja STK Push**, SMS via **Africa's Talking**, and a **PWA scanner** for gate check-in. MVP is deliverable in **8–10 weeks** from kickoff.

---

## 2. What We Know About the Client

From the client's own documents (company invoice SFT/INV/009) and public record:

| Fact | Implication for the build |
|---|---|
| Registered as **64 THEATRE LIMITED** | Can contract directly with Safaricom for a Paybill/Till and with payment aggregators |
| **KRA PIN: P052260951X** | eTIMS onboarding possible; tax-compliant receipts are achievable |
| Bank account: **I&M Bank, Eldoret branch** (KES business current) | Settlement destination exists; no blocker on payouts |
| Invoices institutional clients (festivals) for performances | Platform needs **invoice-based/corporate booking** alongside consumer M-Pesa sales |
| Based in Eldoret; performs at festivals, street carnivals, schools; Kalenjin/Luo/English productions | Offline-tolerant check-in, group/school bookings, SMS-first delivery, vernacular-friendly content |
| Signatory: Steve Agushoma | Likely admin/finance stakeholder — include in UAT and training |

**Client directive (7 July 2026):** *build in-house first; extend to multi-vendor later — keep this in mind for scalability.* This plan is structured around exactly that.

**Note:** the full requirements form (v1.0) has not yet been returned. The open items that still need client answers are listed in Section 11 — none of them block Phase 1 start, but all must be answered before Phase 1 ends.

---

## 3. Scope

### 3.1 Phase 1 — MVP (in-house platform)

**Public site (buyers)**
- Event listing + rich event pages (production info, cast, gallery, venue map link, dates/times as separate performances of one production)
- Checkout as **guest with phone number** (no forced account creation)
- **M-Pesa STK Push** payment with automatic confirmation, retry prompt on failure
- Ticket delivery: **SMS (code + link)** and **email (PDF with QR)**
- Ticket types: Regular, VIP, Student, Group, Early Bird, Complimentary; per-type quantity caps; per-buyer caps
- Promo/discount codes (percentage + fixed)
- Free/RSVP events
- Mobile-first responsive web; installable PWA

**Box office & gate**
- Box-office sale screen (cash / M-Pesa recorded, ticket issued instantly)
- **Scanner PWA**: QR scan via phone camera, one-scan-only enforcement, duplicate alarm, **offline mode with sync**, multiple simultaneous gates, per-event gate-staff logins
- Manual fallback: code entry and name/phone lookup

**Admin**
- Event/performance/ticket-type management
- Real-time sales dashboard; revenue by type/channel; attendance vs sold
- M-Pesa reconciliation view (transactions ↔ orders)
- Exports (CSV/Excel/PDF)
- Roles: Super Admin, Finance, Event Manager, Gate Staff
- Full audit log on money-touching actions
- Customer list (consent-tracked) with export

**Corporate/institutional bookings**
- Invoice-type orders (reserve block, mark paid on bank transfer, issue tickets) — mirrors how 64 Theatre already works with festivals

### 3.2 Phase 2 — Revenue & reach (post-launch, ~4–6 weeks)
- Card payments (diaspora) via aggregator; KES+USD display
- Season passes / multi-show bundles; zoned seating (VIP/Regular sections)
- Bulk SMS/email campaigns to past buyers; automated show reminders; post-show surveys
- Affiliate/referral tracking (cast & influencer links)
- KRA **eTIMS** receipt integration
- Kiswahili interface; Kalenjin key pages/SMS templates

### 3.3 Phase 3 — Multi-vendor marketplace
- Organiser self-registration with admin approval workflow
- Per-organiser dashboards scoped to their own data
- **Fees engine** (commission % / fixed fee per ticket, buyer-pays or organiser-absorbs)
- **Payout ledger + settlement** to organiser M-Pesa/bank, manual approval first, automation later
- Organiser agreement, KYC document capture
- Platform-owner console: approve events, monitor all sales, manage fees

### 3.4 Explicitly out of scope until demand proves them
Native iOS/Android apps (the PWA covers this), USSD, full interactive seat maps, livestream ticketing, loyalty programme. Architecture leaves room for each.

---

## 4. Architecture (the scalability answer)

### 4.1 Shape: modular monolith, multi-tenant data model

One deployable Laravel application, internally split into modules with clean boundaries:

```
Catalog (events, performances, venues)
Ticketing (ticket types, inventory, holds, issuance)
Orders & Payments (checkout, M-Pesa, ledger, refunds)
Check-In (scanner API, offline sync, attendance)
CRM & Messaging (customers, consent, SMS/email campaigns)
Reporting (dashboards, exports, reconciliation)
Organisers & Payouts (dormant in Phase 1 — activated in Phase 3)
```

**Why not microservices:** at 64 Theatre's scale (thousands, not millions, of tickets), microservices add cost and failure modes with zero benefit. A modular monolith on a single VPS with Redis queues comfortably handles a 3,000-seat on-sale rush; the module boundaries mean any hot module can be split out later if the marketplace grows.

### 4.2 Multi-tenancy from day one — the key design decision

Every domain table carries an `organiser_id` from the first migration. In Phase 1 there is exactly one organiser row ("64 Theatre Limited") and the concept is invisible in the UI. In Phase 3, enabling multi-vendor means adding onboarding screens and the fees/payout modules — **not migrating data or rewriting queries.** Authorization is policy-based and organiser-scoped from day one for the same reason.

### 4.3 Core data model

```
organisers ─┬─ users (roles: super_admin, finance, event_manager, gate_staff, organiser_*)
            ├─ venues
            ├─ events ── performances (date/time instances)
            │              └─ ticket_types (price, caps, sale window)
            ├─ orders ── order_items ── tickets (UUID + signed QR token, status)
            ├─ payments (mpesa_stk / cash / bank / card; gateway refs)
            ├─ ledger_entries (double-entry: sales, fees, refunds, payouts)
            ├─ checkins (ticket, gate, staff, timestamp, device, synced_at)
            ├─ customers (phone-keyed, consent flags)
            └─ promo_codes / campaigns / audit_logs
```

The **double-entry ledger exists from Phase 1** even though 64 Theatre is the only payee — this is what makes marketplace settlement trustworthy later, and it gives Finance clean reconciliation immediately.

### 4.4 Ticket integrity
- Each ticket: UUID + **HMAC-signed QR payload** (ticket id, performance id, expiry) — forgery-proof without a database call
- Redemption is an atomic single-row update → one-scan-only guaranteed even with several gates scanning at once
- Scanner PWA pre-downloads the performance manifest (hashed ticket list) → **validates offline**, queues redemptions locally (IndexedDB), syncs when connectivity returns; conflict rule: first sync wins, later duplicates flag loudly

### 4.5 On-sale rush handling
Inventory decrements are atomic with row-level locking; ticket issuance, SMS, email, and PDF generation all run on **Redis queues** so checkout stays fast under load. Cloudflare in front absorbs traffic spikes and caches the public pages. This comfortably covers "hundreds buying in the same hour" without a waiting-room system.

---

## 5. Recommended Technology Stack

| Layer | Choice | Why (senior-dev reasoning) |
|---|---|---|
| Backend | **Laravel 11 (PHP 8.3)** | Batteries included (auth, queues, notifications, scheduling); the **largest hiring pool in Kenya** — 64 Theatre will never struggle to find a maintainer; mature M-Pesa packages |
| Admin panel | **Filament 3** | Production-grade admin CRUD, roles, tables and charts in a fraction of the build time — weeks saved on the dashboard |
| Public frontend | **Blade + Livewire + Tailwind CSS**, shipped as a **PWA** | One codebase, server-rendered (fast on low-end Android + 3G), SEO-friendly event pages, installable; no separate SPA to maintain |
| Scanner | Same PWA (camera QR via web API) + IndexedDB offline store | No app-store friction; any Android phone becomes a gate scanner |
| Database | **PostgreSQL 16** | Rock-solid concurrency for inventory locking; JSONB for flexible event metadata |
| Cache/queues | **Redis 7** | Sessions, cache, queues, rate limiting |
| M-Pesa | **Safaricom Daraja — Lipa na M-Pesa Online (STK Push)** direct | 64 Theatre Ltd + KRA PIN + I&M account qualifies for its own Paybill/Till; direct = no aggregator's ~3% on every ticket; money lands in their own shortcode |
| Cards (Phase 2) | **Pesapal or IntaSend** bolted on beside Daraja | Card volume will be small (diaspora); pay aggregator fees only on that slice |
| SMS | **Africa's Talking** | Kenyan standard, ~KES 0.8/SMS, reliable delivery reports, sender-ID support |
| Email | **Amazon SES** (or Zoho Mail SMTP at low volume) | Cheap, deliverable |
| PDF tickets | Browsershot/dompdf on the queue | Branded PDF with QR |
| Hosting | **VPS (Hetzner or DigitalOcean, 4 GB) + Cloudflare** | ~USD 20–30/month total; Cloudflare gives CDN, TLS, DDoS protection and Nairobi edge caching; Laravel Forge (USD 12/mo) for zero-drama server management |
| CI/CD & repo | **GitHub + GitHub Actions** (tests, deploy on tag) | Already the client-side toolchain |
| Errors/uptime | Sentry (free tier) + UptimeRobot | Know about failures before the client does |
| Backups | Nightly encrypted DB dumps to S3-compatible storage, 30-day retention, restore drill before launch | Non-negotiable |

**Alternatives considered and why not:**
- *Next.js + Node/NestJS + Prisma*: perfectly viable, but splits the system into two apps (API + front), doubles DevOps surface, and Kenya's Laravel maintainer pool is deeper. Choose this only if your own team is JS-first.
- *Django*: excellent framework, smaller local ecosystem for M-Pesa/admin tooling than Laravel's.
- *WordPress + ticketing plugins*: fastest to stand up, but collapses exactly where this project is going — custom M-Pesa flows, offline check-in, and multi-vendor payouts. Rules itself out.
- *SaaS white-label (e.g., riding on an existing platform)*: contradicts the brief — the client wants to **own** a tier-1 platform and its data.

---

## 6. Payments Design (Kenya-critical detail)

1. **Onboarding (starts week 1 — longest external lead time):** register 64 Theatre's own **M-Pesa Paybill or Till** (Safaricom business onboarding; they have the Ltd registration, KRA PIN and I&M account required), then Daraja app credentials for STK Push + C2B confirmation URLs.
2. **Checkout flow:** buyer enters phone → STK Push → PIN on handset → Daraja callback confirms → order flips to *paid* → ticket issued on the queue → SMS + email out. Median end-to-end: under 30 seconds.
3. **Resilience:** callback missed? A reconciliation job polls transaction status; a "Paid but no ticket?" self-service lookup (phone + M-Pesa code) resolves the top support complaint in Kenyan ticketing without a human.
4. **Refunds:** admin-approved, executed via B2C or recorded manual reversal — always through the ledger, always audit-logged.
5. **Interim option if Paybill onboarding drags:** launch on IntaSend/Pesapal STK (aggregator) behind the same `PaymentGateway` interface, swap to direct Daraja when the shortcode lands. The interface makes the gateway a config change, not a refactor. This same interface is what Phase 3 uses to route marketplace money.

---

## 7. Security & Compliance

- **Kenya Data Protection Act 2019:** ODPC data-controller registration guidance in Phase 0; consent capture at checkout; privacy policy; data minimisation (phone + name is enough to sell a ticket); right-to-erasure honoured via customer anonymisation routine
- **KRA:** eTIMS receipt integration in Phase 2; ledger designed so every sale maps to a receipt
- Enforced HTTPS; encrypted backups; secrets in server env only
- **2FA for Super Admin and Finance roles**
- Rate limiting on checkout and STK endpoints; signed QR prevents ticket forgery; duplicate-scan alarms at the gate
- Immutable audit log on refunds, payouts, price changes, comp issuance
- Legal pack drafted with counsel: buyer T&Cs, refund policy, privacy policy (organiser agreement deferred to Phase 3)

---

## 8. Delivery Plan & Timeline

Assumes a lean senior-led team (1 senior full-stack lead — you, 1 mid developer, part-time designer/QA). Weeks are calendar weeks from kickoff.

| Weeks | Milestone | Key deliverables |
|---|---|---|
| 0–2 | **Phase 0 — Foundations** | Signed-off scope (this doc), Safaricom/Daraja onboarding started, ODPC guidance, domain + hosting + CI live, design system & brand application, DB schema reviewed |
| 2–5 | **M1 — Sell a ticket** | Catalog + checkout + STK Push (sandbox→production), SMS/email ticket issuance, order lookup |
| 5–7 | **M2 — Run an event** | Scanner PWA with offline sync, box office, gate roles, attendance dashboard |
| 7–9 | **M3 — Operate the business** | Admin dashboards, reconciliation, exports, promo codes, corporate/invoice bookings, audit log, backups + restore drill |
| 9–10 | **M4 — Launch** | UAT with 64 Theatre staff, training (admin + gate), **pilot on one real performance**, go-live checklist, hypercare |
| +4–6 wks | **Phase 2** | Cards/diaspora, season passes, zoned seating, campaigns, eTIMS, Kiswahili |
| on trigger | **Phase 3 — Marketplace** | Organiser onboarding, fees engine, payout settlement — triggered when 64 Theatre signs its first 2–3 partner organisers |

**Pilot-first launch is deliberate:** the first real show (ideally a mid-size performance, not the biggest of the season) shakes out gate logistics, SMS delivery and reconciliation with limited blast radius.

---

## 9. Running Costs (client-facing, monthly)

| Item | Est. cost |
|---|---|
| VPS hosting + managed via Forge | ~KES 4,500–6,500 |
| Cloudflare | Free tier |
| Domain (.co.ke) | ~KES 1,200/yr |
| SMS (Africa's Talking) | ~KES 0.8 × tickets sold (e.g., 2,000 tickets ≈ KES 1,600) |
| Email (SES) | Negligible at this volume |
| Sentry/monitoring | Free tiers |
| **Payment cost** | Direct Daraja: Safaricom business tariffs only. Aggregator route: ~3–3.5% of card/mobile turnover |

Build cost is quoted separately per phase against this scope; the phase gates in Section 8 are the payment milestones.

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Safaricom Paybill/Daraja onboarding delays (external, common) | Start week 1; aggregator fallback behind the gateway interface |
| Poor venue connectivity breaks check-in | Offline-first scanner is a Phase 1 requirement, not an afterthought; tested in airplane mode during UAT |
| "Paid but no ticket" support storms | Reconciliation poller + self-service lookup + box-office override |
| Scope creep toward marketplace features early | Phase gates; `organiser_id` architecture makes deferral safe |
| Single-maintainer risk after handover | Boring, well-documented stack with Kenya's deepest talent pool; runbooks + training included |
| Client data obligations (DPA) missed | ODPC registration in Phase 0, consent by design |

---

## 11. Open Questions for 64 Theatre (from the unanswered form)

None block kickoff; all must be answered by end of Phase 0:

1. Seating at launch — pure general admission, or VIP/Regular **zones**? (full seat maps stay Phase 2+)
2. Refund policy choice (we recommend: refunds only on cancellation/postponement, clearly stated)
3. Who absorbs M-Pesa charges — buyer surcharge or absorbed in price?
4. Domain preference (e.g., `tickets.64theatre.co.ke` vs a standalone brand)
5. Existing customer lists to import (with consent status)?
6. Launch production/date to target for the pilot
7. Paybill vs Till preference, and who at 64 Theatre owns the Safaricom relationship (suggest: Steve Agushoma/Finance)
8. Brand assets — vector logo, colours

---

## 12. Approval

Development starts on written confirmation of: (a) Phase 1 scope as per Section 3.1, (b) stack as per Section 5, (c) timeline as per Section 8.

| | Client — 64 Theatre Limited | Development Lead |
|---|---|---|
| Name | ____________________ | ____________________ |
| Role | ____________________ | ____________________ |
| Signature | ____________________ | ____________________ |
| Date | ____________________ | ____________________ |
