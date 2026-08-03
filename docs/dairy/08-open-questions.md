# 8. Open questions

Two lists. The first needs the client. The second needs a primary source before
any number is hard-coded.

---

## 8.1 For the client

### About the farm

1. **How many animals, by class?** The whole design assumes 20–300 head. A
   50-cow farm and a 300-cow farm want different milk-entry screens.
2. **Zero-grazing, semi-intensive, or open grazing?** This changes feed
   modelling, the cost structure, and the ECF risk profile (2.5%/month stall-fed
   vs 6.9% herded).
3. **Two or three milkings a day?**
4. **Who buys the milk?** A co-operative, a processor direct, or mixed with
   hawking? If a co-op — which one, and can we see a real monthly statement?
   **The statement layout drives the reconciliation screen**, which is one of our
   three differentiating features.
5. **Is the farm registered with KDB? A co-op member? Which member number?**
6. **What records exist today?** Photograph the actual notebooks. We mirror the
   layout deliberately, so the paper and digital records stay reconcilable.

### About the people

7. **How many staff, in which roles?** Manager, herdsmen, feeders, casuals.
8. **Do the herdsmen have Android phones? Do they own them or share?** Only
   53.7% of Kenyans personally own the handset they use. This validates or
   invalidates the person-picker + PIN design.
9. **What is the actual literacy and language mix?** The evidence says the
   manager and owner will expect English and the herdsmen may prefer Swahili —
   but that rests on essentially one study. Test it on the real staff.
10. **Is payroll currently run formally?** Are NSSF, SHIF and the Housing Levy
    being remitted? This determines whether payroll is a feature or a confronting
    change.

### About scope and money

11. **"Steady cow"** — the brief lists it as a class but it isn't in Kenyan
    extension literature. What does the client mean?
12. **Does the farm sell breeding stock?** If in-calf heifer sales are a real
    revenue line, the animal passport and KLBA registration matter much more.
13. **Is there a vet on retainer, or per-call?** And is vet cost paid in cash or
    through co-op check-off?
14. **What does the client expect to pay, and who pays for hosting long-term?**
    You chose free tiers, which is workable — but note the Vercel Hobby
    commercial-use restriction in
    [06-architecture.md §6.3](06-architecture.md#63-hosting-under-a-zero-budget).
    The go-live plan is Oracle Cloud Always Free in Johannesburg at $0/month.
15. **Is reselling this to other farms a real intention or a maybe?** It's built
    multi-tenant either way, but it changes how much we invest in onboarding
    self-service.
16. **Who owns the code and the data?** Worth settling in writing before Phase 0,
    especially if resale is intended.

---

## 8.2 Numbers that must be verified before they are hard-coded

Everything here is flagged `[?]` in
[02-domain-model.md](02-domain-model.md). Research-session network access was
restricted, so these come from search-result summaries rather than primary
documents.

| # | Item | Problem | Source to pull |
| - | ---- | ------- | -------------- |
| 1 | **Agricultural minimum wage, 2026** | The monthly and daily columns are mutually inconsistent — KES 449.81/day × 26 ≈ 11,695, not the stated 20,621. A competing source gives 10,621.15, which *is* consistent. Likely transcription corruption | [Grant Thornton Kenya Wage Guide 2026](https://www.grantthornton.co.ke/globalassets/1.-member-firms/kenya/insights/pdf/wages-guide-2026.pdf) and the Gazette (Supp. 128, LN 95 & 96) |
| 2 | **SHIF employer contribution** | Sources conflict on whether employers owe an additional 1.375% or merely withhold the employee's 2.75% | SHA / KRA directly |
| 3 | **Drug withdrawal periods** | **No Kenyan national table exists.** The legally operative number is on the PCPB-approved product label. This is why we store it per product | Product labels, entered at setup. Do not build a drug lookup table |
| 4 | **Dairy meal bag size** | KES 3,100–3,500 is for **70 kg**; the KES 2,000–2,300 figure is probably 50 kg or stale. Never store a feed price without a unit weight | Local agrovet quotes |
| 5 | **Hay bale weight** | Ranges 12–25 kg for conventional bales, 300–500 kg for round. The single biggest inventory-modelling trap | The farm's actual supplier |
| 6 | **Ayrshire and Guernsey lactation yields** | Search summaries returned figures ~4× too high (20,000 L and 15,000 L per lactation). Use 4,000–6,500 | KLBA / DRSK records |
| 7 | **Concentrate feeding rule** | NAFIS says 1 kg per 1.5 kg of milk above 8 L; farmers also quote 1 kg per 2 L and per 3 L. Ship as a configurable rule | [NAFIS](http://www.nafis.go.ke/livestock/dairy-cattle-management/), and ask the farm's own practice |
| 8 | **Feed share of production cost** | NAFIS says 50–70%; KDB says 37–55% by system. Compute it, don't assume it | — |
| 9 | **Co-op payment date** | No standard convention confirmed. Make it per-co-op configurable | The client's own co-op |
| 10 | **EAS 67 microbiological grades** | Total plate count thresholds not confirmed | [EAS 67 full text](https://law.resource.org/pub/eac/ibr/eas.67.2006.pdf), then the 2019 revision on the KEBS webstore |
| 11 | **KDB licence fees** | Secondary sources only | [kdb.go.ke permit fees](https://www.kdb.go.ke/index.php/permit-categories-and-fees/) |
| 12 | **In-calf heifer price band** | Two Kenyan listing sites disagree (140k–260k vs 130k–180k). Keep configurable, never hard-code | Local market |
| 13 | **Milk chilling window** | "Within 2–3 hours to ≤4 °C" is commonly quoted but the legal window wasn't confirmed | Dairy Produce Safety Regulations 2021 |
| 14 | **Para-vet visit charges** | KES 500–2,000 is an estimate | Local practice |

---

## 8.3 Primary sources worth pulling on an unrestricted connection

The research agents were blocked from fetching most of these. They are the
highest-value documents for the build.

**Record formats — this is the forms gold:**
- [Livestock Africa / SNV Module 8, Herd Record Keeping](https://livestock.africa/wp-content/uploads/2024/02/8.-Herd-Record-keeping.pdf)
- [Module 2, Nutrition and Feeding](https://livestock.africa/wp-content/uploads/2024/02/2.-Nutrition-and-feeding.pdf)
- [Module 6, Healthcare](https://livestock.africa/wp-content/uploads/2024/02/6.-Healthcare.pdf)
- [Module 7, Breeding and Fertility](https://livestock.africa/wp-content/uploads/2024/02/7.-Breeding-and-Fertility.pdf)
- [ILRI/KARI Smallholder Dairy Project training guide](https://cgspace.cgiar.org/bitstreams/e81dc5ec-03a3-4c1a-a4ed-858e9c873896/download)
- [e-Dairy vaccination schedule and planning](https://e-dairytrainingmodules.africa/wp-content/uploads/2020/08/20230110T9L3-Vaccination-schedule-and-planning-2.pdf)

**Regulation:**
- [Dairy Industry (Registration, Licensing, Cess and Levy) Regulations 2021](https://kilimo.go.ke/wp-content/uploads/2024/08/1-Dairy-Industry-Registration-Licencing-Cess-and-Levy-Regulations-2020-3.pdf)
- [Dairy Industry (Dairy Produce Safety) Regulations](https://kilimo.go.ke/wp-content/uploads/2024/08/8-Dairy-Industry-Dairy-Produce-Safety-Regulations-2020-3.pdf)
- [Dairy Industry Act Cap 336](https://new.kenyalaw.org/akn/ke/act/1958/34/eng@2026-07-10)
- [EAS 67 Raw cow milk specification](https://law.resource.org/pub/eac/ibr/eas.67.2006.pdf)
- [Regulation of Wages (Agricultural Industry) Order](https://new.kenyalaw.org/akn/ke/act/ln/1982/121/eng@2026-06-26)
- [Veterinary Surgeons and Vet Para-Professionals Act Cap 366](https://infotradekenya.go.ke/media/Cap%20366%20Vet%20Surgeons%20Act.pdf)

**Directly relevant prior work:**
- [Strathmore thesis: M-Agriculture Recording System for Milk Producers in Kenya](https://su-plus.strathmore.edu/server/api/core/bitstreams/50db215a-0c91-46cf-8e08-1b92a4387257/content)
  — likely the single most relevant document to this project, and it could not be
  retrieved.
- [A review of on-farm recording tools for smallholder dairy farming in developing countries](https://pmc.ncbi.nlm.nih.gov/articles/PMC11106116/)
- [ICAR: Dairy Recording in Kenya (Mukisira)](https://www.icar.org/Documents/technical_series/ICAR-Technical-Series-no-1-Anand/Mukisira.pdf)

**Competitor to investigate first:**
- [DairyVibes](https://dairyvibes.com/) — claims almost exactly our positioning.
  Get a trial account and a customer reference before committing to the wedge.

---

## 8.4 Known gaps in the evidence

Flagged honestly rather than papered over.

1. **No published time-per-record figures for on-farm livestock data entry.** The
   10 s/cow target is triangulated, not measured. Measuring it in week one would
   be a genuinely novel data point.
2. **Almost no retention data on employee-facing farm software in Africa.**
   Everything published studies voluntary smallholder adoption. Our context —
   mandated use by paid staff — is under-studied. The framing correction in
   [01-findings.md §1.5](01-findings.md#15-the-framing-correction-that-shapes-everything)
   is analysis, not a sourced finding.
3. **The Swahili-versus-English conclusion rests on essentially one study** of the
   M-Pesa app. Treat it as a hypothesis to test on the actual staff, not settled
   fact.
4. **The "20–300 head segment is underserved" claim has partial evidence.** The
   literature returns results on smallholders and on large commercial farms, with
   little on the band between. Validate with primary interviews rather than
   treating it as established.
