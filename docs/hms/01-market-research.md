# Hospital Management Systems — Market Research & Gap Analysis

**Prepared for:** SMP Developers
**Date:** 14 September 2026
**Market:** Kenya (primary), East Africa (expansion)

---

## 1. Why now — the market has a deadline

Kenya's health sector is in a forced digitisation window. This is not a "nice to have" upgrade cycle; it is a regulatory cliff.

| Fact | Implication |
|---|---|
| SHA has made a **DHA-certified HMIS mandatory** for any provider wanting to participate in the 2026/28 contracting cycle | Every facility that bills SHA must buy or replace software |
| Compliance deadline extended to **30 September 2026** | 16 days from today — expect a large "missed it" cohort in Q4 |
| Facilities that fail risk **de-contracting** from SHA-funded schemes | Non-compliance = loss of the majority of revenue for most facilities |
| **5,078 facilities** on SHA HMIS, but only **2,978 actively submitting claims electronically** | ~2,100 registered-but-not-transacting facilities = a warm, identified lead list |
| **~20% of claim value** is rejected, returned for correction, or awaiting documents | The pain is not "we need software", it is "we are not getting paid" |
| Hospitals reporting **six months without payment**, closing pharmacies and labs | Willingness to pay for anything that fixes cashflow is unusually high |

**Strategic read:** the compliance deadline sells the *first* purchase. Claim acceptance rate is what sells the *renewal*. Build for the second one and the first comes free.

---

## 2. The competitive landscape

### 2.1 Kenyan / regional commercial vendors

| Vendor | Position | Observed weaknesses |
|---|---|---|
| **AfyaPro** | Established, strong on NHIF/SHA e-claims, verification and preauthorisation | No full offline capability; requires manual data sync |
| **Slade360 (Savannah Informatics)** | Large, insurer-adjacent, strong payer network | No full offline or partial offline mode; limited maternity-package support |
| **Medbook / AphiaOne** | Aggressive marketing, clinic-to-hospital range | Feature breadth advertised over clinical depth; heavy sales-led motion |
| **Hanmak** | Positions on DHA certification and eTIMS compliance | Compliance-first positioning; thin on clinical workflow |
| **Smart Applications Intl.** | Long-standing, card/biometric heritage | Legacy architecture; historically hardware-coupled |
| **Techsphere E-Afya, Vikass 2.0, iDeveloper** | Mid-market ERP-style suites | Generic ERP retrofitted to health; weak on Kenyan clinical reporting |

**Pricing reality (2026):**

| Segment | Typical monthly |
|---|---|
| Small clinic / dispensary | KES 5,000 – 10,000 |
| Health centre with maternity | ~KES 35,000 |
| Full clinical hospital / health centre | KES 27,000 – 40,000 |
| Multi-branch hospital network | KES 60,000+ |

Most of the market sits in the **KES 5,000–40,000/month** band. Some vendors offer a pay-once lifetime licence — which correlates with abandoned products and no compliance updates. That is an exploitable weakness: *regulation changes quarterly now; a lifetime licence with no update obligation is a liability, not a saving.*

### 2.2 Open-source platforms

| System | Strength | Weakness |
|---|---|---|
| **OpenMRS** | Functionally rich, technically mature, huge Kenyan footprint via KenyaEMR | Developer-heavy; configuration is a specialist skill; billing/revenue is an afterthought |
| **Bahmni** | Functionally rich, mature (OpenMRS + OpenELIS + Odoo) | Integration-of-three-systems fragility; heavy infrastructure; slow UI |
| **OpenEMR** | Mature, stage-5 capable, huge module library | US-centric workflows; dated UX; poor fit for SHA/eTIMS |
| **HospitalRun** | Offline-first design intent | Fails ~50% of ED documentation capability; no discharge summaries; no imaging support |
| **KenyaEMR (TaifaCare)** | MOH-aligned, actively released, free | Programme/public-facility oriented; weak for private revenue cycle and multi-payer billing |

**The gap:** the open-source stack is strong on *clinical records* and weak on *money*. The commercial stack is strong on *money* and weak on *clinical depth and offline resilience*. Nobody is doing both well at the SME price point.

### 2.3 Global enterprise (Epic, Cerner/Oracle Health)

Irrelevant as direct competitors at this price point, but instructive as a **catalogue of mistakes to avoid**:

- Poor EHR usability is **strongly associated with clinician burnout**; EHRs rank as the 4th most common cause of physician burnout in a 14,000-physician survey.
- EHR work consumes **nearly 50% of clinic time** and spills outside clinic hours.
- Notorious click-load — "a dozen clicks to order a single drug" — and alert fatigue to the point clinicians ignore all alerts.
- Fragmented information forces workarounds: duplicate documentation, external tools, shadow paper records.

---

## 3. Weak points — the specific things everyone gets wrong

These are the design targets. Each one is a feature decision later in the spec.

### W1 — Offline is faked, not built
Kenyan facilities have unreliable power and connectivity. Market leaders offer "manual sync" or no offline mode at all. When the link drops, the clinic reverts to paper and back-keys later — which is precisely where claim-rejecting data errors are born.
> **Design answer:** offline-first by architecture (local-write, queue, conflict-resolved sync), not an add-on.

### W2 — Claims are submitted hopefully, not validated
20% of claim value is rejected or returned. Documented causes: missing signatures, wrong codes, date errors, missing pre-authorisation, and **late submission beyond 7 days**. Resubmission takes another two months and is often rejected again.
> **Design answer:** a pre-submission claim scrubber that blocks a claim from leaving the building until it will pass. Treat SHA's rejection rules as validation rules enforced at the point of care.

### W3 — The clinician is treated as a data-entry clerk
Systems are built for the billing office and the reporting officer; the doctor pays the cost in clicks. Burnout, workarounds and shadow records follow — and bad clinical data means bad claims.
> **Design answer:** a hard budget — a complete standard outpatient consultation in **under 90 seconds and under 15 clicks**. Structured data captured as a by-product of clinical work, not as an extra form.

### W4 — Compliance is a one-off project, not a living subscription
Kenya's rules are moving fast: SHA HMIS replacing the Provider Portal, DHA certification, eTIMS, Digital Health Act, Data Protection Act. Lifetime-licence vendors and abandoned deployments cannot keep up.
> **Design answer:** sell compliance as a *maintained service*. Regulatory changes ship as updates inside the subscription, with a published compliance changelog.

### W5 — Pre-authorisation and verification are dead ends
When SHA's preauth system failed nationwide in March 2026, facilities had no fallback. Systems assume the payer is always reachable.
> **Design answer:** degrade gracefully — queue verification, record the emergency/OTP-exception path SHA itself supports (ECCIF emergency claims, OTP-only for identified emergency patients, unidentified-emergency reason codes), and reconcile when the payer returns.

### W6 — No single patient identity
Patients hold a file number at one facility, an SHA number, a national ID, and a phone number, with no reliable linkage. Duplicates corrupt both the clinical record and the claim.
> **Design answer:** a Master Patient Index with deterministic + probabilistic matching, SHA/ID/biometric verification, and an explicit merge workflow with full audit.

### W7 — Money and medicine live in different systems
Bahmni bolts Odoo onto OpenMRS; many vendors treat pharmacy stock and billing as separate ledgers. Result: dispensed-but-unbilled drugs, stockouts, and unreconcilable revenue leakage.
> **Design answer:** one transactional spine. A dispense event *is* a stock movement *is* a billable line *is* a claim item *is* an eTIMS invoice line.

### W8 — Reporting is a second data-entry job
Staff re-key MOH returns into KHIS/DHIS2 because the HMIS cannot produce them.
> **Design answer:** MOH 705/717 and programme reports generated from transactional data, pushed to DHIS2/KHIS automatically.

### W9 — Weak data protection posture
Health data is **sensitive personal data** under the Data Protection Act 2019. Most SME-targeted systems ship with shared logins, no audit trail, and no consent record.
> **Design answer:** per-user identity, mandatory audit log, consent capture, encryption, data residency, and a documented DPIA — as product features, not policy documents.

### W10 — Implementation failure, not software failure
Documented EMR implementation failure factors: poor project management (62%), low user acceptance (55%), slow systems (45%), lack of training and follow-up (38%), no power/data backup.
> **Design answer:** productise the rollout. A fixed 10-day implementation playbook, super-user training, a go-live "war room" week, and performance SLAs written into the contract.

---

## 4. Positioning

> **"The HMIS that gets you paid. Certified, offline-proof, and it tells you a claim will be rejected *before* you submit it."**

Three defensible wedges, in order of sales power:

1. **Claim acceptance rate** — the only number the owner actually cares about. Publish it in the product.
2. **Offline-first** — the one thing the two market leaders demonstrably do not have.
3. **Certified and maintained** — DHA-certified, eTIMS-integrated, and kept that way by subscription.

---

## 5. Target segments

| Tier | Facility | Volume in Kenya | Fit | Priority |
|---|---|---|---|---|
| A | Private clinics & dispensaries (Level 2) | Very high | MVP fits day one | **First** |
| B | Nursing/maternity homes & health centres (Level 3) | High | Needs maternity + inpatient | Second |
| C | Private & mission hospitals (Level 4) | Medium | Full suite, theatre, lab, radiology | Third |
| D | County/public facilities | Medium | Procurement-heavy, long cycle | Later |
| E | Clinic chains / SACCO & corporate health schemes | Growing | Multi-branch, scheme billing | Opportunistic |

Start at Tier A: shortest sales cycle, the segment most exposed to the compliance deadline, and the segment the enterprise vendors serve worst.

---

## Sources

- [SHA extends HMIS compliance deadline to 30 Sept 2026 — Kenyans.co.ke](https://www.kenyans.co.ke/news/126681-sha-extends-deadline-healthcare-providers-comply-hmis)
- [SHA makes accredited HMIS mandatory for all healthcare providers — Kenyans.co.ke](https://www.kenyans.co.ke/news/124812-sha-makes-accredited-hmis-mandatory-all-healthcare-providers)
- [SHA gives hospitals one more month to meet digital health rules — Capital FM](https://capitalfm.africa/sha-gives-hospitals-one-more-month-to-meet-digital-health-rules/)
- [SHA gives hospitals 90 days for HMIS digital integration — Streamlinefeed](https://streamlinefeed.co.ke/news/sha-gives-hospitals-90-days-for-hmis-digital-integration)
- [SHA rejects one in five claims from hospitals — The Star](https://www.the-star.co.ke/news/2026-07-04-sha-rejects-one-in-five-claims-from-hospitals)
- [Six months without pay: hospitals shut pharmacies and labs as SHA delays bite — Daily Nation](https://nation.africa/kenya/health/six-months-without-pay-hospitals-shut-pharmacies-and-labs-as-sha-delays-bite-5333112)
- [System failure at SHA halts critical healthcare approvals nationwide — allAfrica](https://allafrica.com/stories/202603020651.html)
- [Why SHA claims get rejected in Kenya: 8 reasons & fixes — MyCyber](https://mycyber.co.ke/why-sha-claims-get-rejected-in-kenya-8-reasons-fixes/)
- [SHA shifts claims processing for Level 4 hospitals to Taifa Care HMIS — allAfrica](https://allafrica.com/stories/202607010094.html)
- [TaifaCare — KenyaEMR 19.4.4 release notes](https://github.com/Palladium-hub/kenyaemr-releases/releases/tag/19.4.4)
- [Hospital management system cost in Kenya — 2026 pricing guide](https://www.afyaconnect.africa/resources/hospital-management-system-cost-kenya)
- [20 best hospital management software in Kenya — SoftwareSuggest](https://www.softwaresuggest.com/hospital-management-software/kenya)
- [Open-source electronic health record systems: a systematic review — Health Informatics Journal](https://journals.sagepub.com/doi/full/10.1177/14604582221099828)
- [Usability challenges in electronic health records — scoping review](https://onlinelibrary.wiley.com/doi/full/10.1111/jep.70189)
- [Measurement of clinical documentation burden — JAMIA](https://academic.oup.com/jamia/article/28/5/998/6090156)
- [Cerner's John Glaser: how to finally fix the EHR usability problem — Healthcare IT News](https://www.healthcareitnews.com/blog/cerners-john-glaser-how-finally-fix-ehr-usability-problem)
- [Implementation challenges of electronic medical records — PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12327674/)
