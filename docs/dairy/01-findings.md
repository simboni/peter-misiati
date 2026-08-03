# 1. Findings — the market, its failures, and our wedge

## 1.1 The segment nobody serves

Kenyan dairy is described almost entirely in terms of **1.8 million smallholders
with 1–5 cows averaging 7–9 L/cow/day, producing ~80% of national milk**. The
software market has organised itself around the two ends of that distribution
and left the middle empty.

| Tier | Products | Assumptions that exclude our client |
| ---- | -------- | ----------------------------------- |
| Global / enterprise | DairyComp 305, Afimilk AfiFarm, DeLaval DelPro, Uniform-Agri, Lely Horizon, CowManager, PCDART | Windows desktop; a milking parlour or robot; sensors at €150/cow; a national DHIA milk-recording body; quote-only pricing in USD/EUR |
| Cloud mid-market | BoviSync, Farmbrite, Herdwatch, DairyLive | Priced and designed for US/EU/Irish farms; no Kenyan quality standards, no co-op check-off, no M-Pesa, no Swahili |
| Kenyan smallholder | DigiCow, iCow, SmartCow, Jaguza | Built for 1–5 cows. No payroll, no feed inventory, no per-cow cost of production, no multi-worker roles |
| What farms actually use | Excel, QuickBooks, Tally, WhatsApp, paper | See §1.4 |

**The gap is the 20–300 head commercial farm** — large enough to have payroll,
feed invoices, a farm manager and a bank relationship, and therefore a real
ability to pay; too small for a parlour-tied enterprise system; too complex for
an SMS advisory service.

> One caveat worth acting on: **DairyVibes** ([dairyvibes.com](https://dairyvibes.com/))
> claims almost exactly this positioning — Kenyan, offline-first, Swahili, free
> perpetual tier, 500+ farms across five countries. None of those claims could be
> independently verified and no third-party reviews exist. Get a trial account and
> a customer reference before committing.

## 1.2 The fifteen recurring failures

Ranked by how often they appear across independent sources and how much pain
they cause. Each is the design brief for a counter-measure.

### 1. Data entry friction is the abandonment mechanism

> "Forms requiring 14 fields to be completed before a harvest can be recorded
> will be abandoned or faked."

Herdwatch users report that recording weight-based drug doses means entering
cattle in batches by weight band, and that multiple drugs cannot be applied to
one animal at once. A UK vet reported spending three to four days a month
entering data for supermarket contracts.

**We do instead:** a hard entry-time budget — **≤10 seconds per cow, ≤3 taps** —
treated as a defect if missed. Any screen over five fields is a defect.

### 2. Fragmentation, silos and lock-in

> "Proprietary data systems often retain information in silos, prioritizing
> vendor control over data portability."

Farmbrite users report an inability to export to Excel. BoviSync cannot
interface with DHIA or DairyComp, forcing manual re-entry.

**We do instead:** full CSV/Excel export as a headline feature, ICAR animal-ID
conventions (which KLBA already follows), and a documented API. In this market
"you can leave whenever you want" is a differentiator competitors structurally
cannot copy.

### 3. Price escalation and predatory renewals

> "Renewal more than doubled from last year — it went from €155 to €320 for a
> small farm of 50–70 cattle per year. Tried to cancel renewal but money was
> taken and no one to speak to."

> "They took £200 out of my account after I cancelled … told me their system
> doesn't allow it."

30% of surveyed farmers cite unclear ROI as a significant adoption barrier.

**We do instead:** published KES pricing, no auto-escalation, cancel in two taps,
and an in-product ROI statement — *"this month: 4 heats caught that would have
been missed."*

### 4. Systems demand connectivity the farm doesn't have

The Uniform-Agri mobile app "constantly displays 'no server' errors" and "can
only sync data once every few months, resulting in outdated data." Amtech's
Kenyan product advertises that it "requires only a reliable internet connection"
— which is the tell. Rural internet use in Kenya runs **21–28%**, and county
penetration ranges from Nairobi's 64.7% down to West Pokot's 9.1%.

**We do instead:** offline-first, not offline-tolerant. Saving never touches the
network. See [06-architecture.md](06-architecture.md#offline).

### 5. Built for the wrong user

> "Platforms designed for agronomists in offices fail in the hands of field
> agents and smallholder farmers operating in low-literacy, low-connectivity,
> multilingual environments."

DigiCow reports farmers "struggling to navigate even basic USSD codes."

**We do instead:** two distinct surfaces in one system. A **capture surface** for
herdsmen (icon-led, near-wordless, Swahili available, works on a KES 6,000
Android) and an **analysis surface** for the owner (English, dense, financial).
The milker never sees a report; the owner never types a milk weight.

### 6. The business model dies before the product does

> "App after app is launched with considerable donor backing, only to vanish
> once initial funding dries up."

Jaguza Livestock: thirteen years, ITU and Commonwealth awards, **62 farms**.
DigiFarm: 1,038,817 registered farmers, **30% active**. One Kenyan agritech
claiming a million farmers had ~30,000 who ever transacted — 3%.

**We do instead:** charge from day one, to a segment with genuine ability to pay.
No free-smallholder-app-monetise-later play; that graveyard is full.

### 7. The platform model itself is the problem

> Shortcomings "are not primarily due to infrastructural or users' deficits, but
> reflect deeper limitations in the platform model itself, which prioritizes
> scalability and control over adaptability and farmer agency." — *Journal of
> Rural Studies*, June 2026

**We do instead:** the software conforms to the farm's existing routine, not the
reverse. Mirror the milking record book, the AI card, the daily muster. Let
farms rename fields, define herd groups, add event types.

### 8. Steep learning curves and legacy interfaces

DairyComp 305 has "the steepest learning curve — a command-line-style interface
that requires training," with reviewers complaining they had to learn "that a
cow who is dry is `rc=6`."

**We do instead:** zero-training target on the capture surface. "Dry", never
`rc=6`. If a new milker cannot record a full milking unaided within 60 seconds of
first seeing the app, it will not survive staff turnover.

### 9. Reliability defects and data loss

DigiCow's store reviews: "the app keeps closing prematurely"; "a problem while
adding production records, showing an HTTP 404 error and app crashes"; "phone
verification isn't working." A review of digital tools for health workers across
Africa names the actual killers as *application crashes, screen freezing, login
restrictions, submission errors*.

**We do instead:** local-first persistence, so a crash never costs an entry.
Losing a record is the one failure that permanently ends trust.

### 10. Support collapses after the sale

> "They are really helpful when trying to sell it to you but aftercare is zero."

Meanwhile "available technical support" ranks among the most important adoption
criteria, and every well-reviewed product is praised for support.

**We do instead:** in-country, in-language support on WhatsApp and phone with
published response times. This is the moat against foreign SaaS — none of them
can service a farm in Nyandarua.

### 11. No per-cow, per-litre financial truth

> "Most dairies have 10–15% of their herd losing money, and without per-cow
> financial analysis, farmers keep feeding and milking cows that cost them
> $5–$10/day."

Feed is **55–65% of production cost** in Kenyan intensive systems. Herdwatch
"lacks extensive financial modules." QuickBooks and Tally cannot represent
raised livestock at all — "the basic design of QuickBooks assumes all inventory
is purchased."

**We do instead:** **margin over feed cost per cow per day is the home screen.**
In a market where the whole margin is KES 8–20/litre, this single number is the
value proposition, and almost nobody delivers it.

### 12. Alerts nobody acts on

> "Alert fatigue is a real failure mode since the value is entirely contingent
> on someone acting on the alerts."

Herdwatch's watchboard has a logic bug leaving repeat-served cows stuck on the
board indefinitely.

**We do instead:** every alert names **one person, one animal, one action, one
deadline**, and is dismissed with an outcome that feeds back. Daily alert cap.
We report *action completion rate*, not alert volume.

### 13. Missing the modules dairy farmers actually ask for

Herdwatch users requested milk recording in Spring 2020; it "did not make the
cut" for the 2.0 release. A dairy app without milk recording.

**We do instead:** the dairy core ships complete before any breadth — milk
recording per cow per session, the heat→AI→PD→calving chain, treatments with
withdrawal periods, dry-off, feed, and full disposal records.

### 14. No connection to collection, quality and payment

> "Delayed milk payments and cash flow challenges within cooperative systems
> continue to push farmers toward informal sales channels."

The working Kenyan models are all payment-anchored: Sky Dairy's per-delivery SMS
with a running monthly total, KDPL's eReceipting, Stellapps' mooPay in India.

**We do instead:** the milk ledger is a financial instrument — deliveries,
quality grades, check-off deductions, and money in and out. This is what turns a
record-keeping app into infrastructure the farm cannot switch away from.

### 15. Imported software does not fit Kenyan rules

The decisive evidence, from Kenyan co-ops evaluating Indian milk-payment tech:

> "The difference in milk quality standards between India and Kenya. While India
> typically uses only fat and SNF for quality-based pricing, Kenya's system is
> more comprehensive, demanding further customisation of software and reporting."

**We do instead:** model Kenyan quality parameters, KDB reporting, KLBA grade
progression, KES, eTIMS/VAT, county cess, and the actual AI-provider and vet
ecosystem. Being *natively Kenyan* is the position DairyComp and Herdwatch
structurally cannot occupy.

## 1.3 What users praise — do not rebuild these worse

1. **Time saved, quantified.** Herdwatch users "save 3 hours per week on
   paperwork on average." Publish a number and make the product prove it.
2. **Recording at the point of work, on a phone, in the barn.** Uniform users
   love field access *even while hating the sync*. The demand is proven; the
   execution is where everyone fails.
3. **Compliance and withdrawal-period reminders** — Herdwatch's most-praised
   feature cluster.
4. **Breeding alerts and calving forecasts** — what Kenyan farmers actually cite
   about DigiCow.
5. **Automated capture that removes typing** — PCDART's test-day import.
6. **Customisable reports** — DairyComp's genuine core strength.
7. **Simple, transparent, per-animal pricing** — BoviSync and Farmbrite are both
   praised for it; every quote-only vendor is criticised for the opposite.
8. **Free, responsive support that ships requested features.**
9. **Working in the user's language** — DigiCow's vernacular voice notes are its
   most-praised feature.
10. **Offline access as an advertised feature.**
11. **SMS confirmation of value received** — cheap to build, disproportionately
    valued in the Kenyan co-operative context.

## 1.4 The real incumbent is Excel and a notebook

> "The biggest risks are version conflicts, missing treatment or breeding
> entries, delayed updates, weak audit trails, and manual formula errors."
>
> "If people log events later, not at the point of work, entries get missed or
> approximated, and a delayed entry is often a delayed action in dairy
> operations."

Our competition is not DairyComp. It is a notebook in the milking shed and a
WhatsApp photo of it sent to the owner. That sets the bar: **anything slower or
less reliable than the notebook loses.**

Corollary, and it matters: **do not abolish the notebook on day one.** M-Pesa —
the most trusted money system in Kenya — requires every agent to keep a
Safaricom-branded paper log book alongside the digital record, because the SMS
alone was "elusive proof in the minds of many customers." We mirror the
notebook; we don't fight it. See the printable daily sheet in
[03-modules.md](03-modules.md#m10--reports--insights).

## 1.5 The framing correction that shapes everything

Nearly all published adoption research studies *smallholders voluntarily
adopting a consumer product*. Our situation is different: **a commercial farm
where an employer mandates use by paid staff.**

That changes the risk. "Will they download it" is not our problem. Our problems
are **data quality**, **silent abandonment** (entering plausible garbage to
satisfy the boss), and **the app reading as surveillance of staff**. A mandated
system that is painful produces fake data rather than no data, which is worse.

Two consequences run through the whole design:

- **Warn, never block.** Rigid required fields don't produce complete data, they
  produce fabricated data. One study attributed **80% of all errors** to
  non-mandatory variables plus open-ended questions; the published "Validation
  Relaxation" strategy exists precisely because required fields force field staff
  to invent values to escape a form.
- **Frame it as protecting staff, not catching them.** The herdsman's record is
  his proof that he delivered the milk and his proof that he was paid.

## 1.6 The wedge, stated plainly

Three capabilities, each mapping to a documented market failure, none of which
any incumbent available in Kenya does well:

| Capability | Failure it answers | Why it's defensible |
| ---------- | ------------------ | ------------------- |
| **Margin over feed cost, per cow, per day** | #11 no per-litre financial truth | Requires feed inventory *and* milk records *and* Kenyan prices in one model. Herdwatch has no financials; QuickBooks cannot represent a raised heifer |
| **Enforced antibiotic withdrawal periods** | #13 missing dairy core | 15–19% of Kenyan milk samples test residue-positive. One rejected bulk load can exceed a month's profit. This is the single highest-value safety feature available |
| **Co-op statement reconciliation** | #14 no link to payment | "Why is my cheque smaller than I expected" is the #1 dairy co-op grievance. Nobody reconciles farm-side delivery records against the co-op statement |

Everything else in the system — herd, breeding, health, payroll, expenses — is
table stakes we must do well. These three are why the farm keeps paying.

## Sources

Competitor and pricing data: [G2](https://www.g2.com/products/dairycomp-305/reviews) ·
[BoviSync pricing](https://bovisync.com/pricing/) ·
[Farmbrite pricing](https://www.farmbrite.com/pricing) ·
[Herdwatch Trustpilot](https://www.trustpilot.com/review/herdwatch.com) ·
[Herdwatch Capterra](https://www.capterra.com/p/171787/Herdwatch/reviews/) ·
[Uniform-Agri on Google Play](https://play.google.com/store/apps/details?id=com.uniformagri.UNIFORM) ·
[DigiCow](https://digicow.co.ke/) ·
[DigiCow on Google Play](https://play.google.com/store/apps/details?id=info.digicow.com) ·
[iCow](https://icow.co.ke/) ·
[Jaguza](https://jaguzafarm.com/pricing/) ·
[DairyVibes](https://dairyvibes.com/) ·
[Stellapps](https://www.stellapps.com/about/)

Adoption and failure evidence: [CGIAR on DigiFarm](https://bigdata.cgiar.org/digital-intervention/safaricom-digifarm/) ·
[Disrupt Africa](https://disruptafrica.com/2026/06/18/why-african-agri-tech-keeps-failing-and-what-open-source-changes/) ·
[Frontiers in Digital Health](https://www.frontiersin.org/journals/digital-health/articles/10.3389/fdgth.2022.876957/full) ·
[Journal of Rural Studies 2026](https://www.sciencedirect.com/science/article/pii/S0743016726002123) ·
[Mercy Corps AgriFin](https://mercycorpsagrifin.org/program-overview/) ·
[Validation Relaxation](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5581386/) ·
[ILRI on iCow impact](https://www.ilri.org/knowledge/publications/impact-ict-based-extension-services-dairy-production-and-household-welfare) ·
[World Bank on M-PESA](https://documents1.worldbank.org/curated/en/638851468048259219/pdf/543380WP0M1PES1BOX0349405B01PUBLIC1.pdf)

Farm-software critique: [Ag Proud on QuickBooks for ranchers](https://www.agproud.com/articles/60862-advantages-and-disadvantages-of-using-quickbooks-inventory-for-ranch-operations) ·
[Farmers Weekly](https://www.fwi.co.uk/livestock/dairy/dairy-software-systems-holding-back-business-progress) ·
[Agriterra on Kenyan co-ops and Indian tech](https://www.agriterra.org/news/kenyan-dairy-co-ops-tap-indian-tech-for-fair-milk-payments)
