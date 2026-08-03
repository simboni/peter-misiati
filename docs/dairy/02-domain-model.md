# 2. Domain model — the dairy facts the software must encode

Written for a developer who is not a dairy expert. Every rule here has a
consequence for the schema or the forms.

**Confidence tags:** `[KE]` sourced to a Kenyan/East African source ·
`[STD]` standard dairy science, high confidence, not Kenya-specific ·
`[?]` sources disagree or the figure looks wrong — see
[08-open-questions.md](08-open-questions.md) before hard-coding.

---

## 2.1 Animal classes

The client listed: *dairy animals, in-calf, in-calf heifers, milkers, lactating,
bulling heifer, calves.* Here is the full, precise set as Kenyan extension
services and livestock markets use it.

| Code | Kenyan term (Swahili) | Sex | Definition | Age | Weight |
| ---- | --------------------- | --- | ---------- | --- | ------ |
| `CALF` | Calf (*ndama*) | F/M | Birth to weaning, still on milk | 0–3 mo | 25–40 kg at birth, 70–100 kg at weaning |
| `WEANER` | Weaner | F/M | Off milk, on solids | 3–9 mo | 90–200 kg |
| `HEIFER` | Heifer (*mtamba*) | F | Weaned female, below breeding size | 9–14 mo | 200–280 kg |
| `BULLING_HEIFER` | Bulling / breeding heifer | F | At breeding weight and cycling | 14–18 mo | ≥280 kg (≈60% of mature weight) |
| `SERVED_HEIFER` | Served heifer | F | Inseminated, pregnancy unconfirmed | 14–20 mo | 280–330 kg |
| `INCALF_HEIFER` | In-calf heifer | F | Pregnancy confirmed, not yet calved | 15–27 mo | 300–420 kg |
| `SPRINGER` | Springer | F | Last 4–8 weeks before calving, udder developing | — | — |
| `FIRST_CALVER` | First calver / heifer-in-milk | F | First calving through first lactation | 24–33 mo at calving | 400–450 kg |
| `LACTATING_COW` | Milking cow (*ng'ombe wa maziwa*) | F | In lactation, 2nd+ | 3 yr+ | 450–600 kg Friesian, 400–500 Ayrshire, 350–420 Jersey |
| `DRY_COW` | Dry cow / steaming cow | F | Pregnant, not milking | — | — |
| `MATURE_COW` | Mature cow | F | 3rd lactation onward, at mature weight | 5–8 yr | mature |
| `CULL_COW` | Cull cow | F | Flagged for disposal | any | often thin |
| `BULL` | Bull (*fahali*) | M | Intact male used for service | 18 mo+ | 500–900 kg |
| `BULL_CALF` | Bull calf | M | Intact male calf, usually sold early | 0–6 mo | — |
| `STEER` | Steer / bullock (*maksai*) | M | Castrated male | 6 mo+ | 200–500 kg |

Breed timing varies `[KE]`: heifers reach maturity at roughly Jersey 12–16 mo,
Friesian 18–22 mo, Sahiwal 24–26 mo.

> **"Steady cow"** appears in the client's brief but not in Kenyan extension
> literature. Treat it as a farm-local synonym for a mature multiparous cow and
> map it to `MATURE_COW`. Confirm with the client. `[?]`

### The class is derived, never typed

This is the single most important schema decision in the system. Store the
*events*; compute the class on read.

```
CALF ──weaning: age ≥ ~3 mo OR eating ≥1.0–1.5 kg concentrate/day for 3 days──▶ WEANER
WEANER ──age ~9 mo──▶ HEIFER
HEIFER ──weight ≥ ~280 kg AND/OR age ≥ 14 mo AND heat observed──▶ BULLING_HEIFER
BULLING_HEIFER ──service recorded (AI or bull)──▶ SERVED_HEIFER
SERVED_HEIFER ──PD positive──▶ INCALF_HEIFER
SERVED_HEIFER ──returns to heat / PD negative──▶ BULLING_HEIFER      (repeat service)
INCALF_HEIFER ──EDD − 60 d, steaming-up begins──▶ SPRINGER
SPRINGER ──calving──▶ FIRST_CALVER                                  (+ creates a CALF)
FIRST_CALVER / LACTATING_COW ──dry-off, ~60 d before EDD──▶ DRY_COW
DRY_COW ──EDD − 4–8 wk──▶ SPRINGER ──calving──▶ LACTATING_COW
LACTATING_COW ──3rd lactation──▶ MATURE_COW
any female ──cull decision──▶ CULL_COW ──sale/slaughter──▶ DISPOSED
BULL_CALF ──castration──▶ STEER   |   ──kept intact, ≥18 mo──▶ BULL
any ──death / abortion / sale / theft──▶ DISPOSED
```

Two flags are **orthogonal to class** and must not be folded into the enum,
because a cow is normally both at once:

- **Parity / lactation number** — 0 for a heifer, then 1, 2, 3…
- **Reproductive status** — `OPEN`, `SERVED`, `PREGNANT`, `FRESH`, `DRY`

Animals **bought in** with unknown history need a manual class override.

### What is traded, and what drives price

| Class | Liquidity | 2026 band (KES) | Confidence |
| ----- | --------- | --------------- | ---------- |
| In-calf heifer | The flagship transaction | 140,000–260,000, or 130,000–180,000 for Friesian 14 mo+ | `[KE]` — two sources disagree `[?]` |
| Bulling heifer (10–14 mo) | Common | 76,000–106,000 (Holstein-Friesian) | `[KE]` |
| Lactating cow | Common | 120,000–300,000+, priced off current daily litres | `[KE]` `[?]` |
| Weaner heifer | Common | ~40,000–80,000 | inferred `[?]` |
| Bull calf | Common, sold days-old | ~2,000–15,000 | inferred `[?]` |
| Breeding bull | Less common (AI dominates) | 100,000–400,000+ pedigree | `[?]` |
| Cull cow / steer | Common | by liveweight, for beef | `[KE]` |

Price drivers, in order: **stage of pregnancy** (a 7-month in-calf heifer
commands a large premium); **current daily yield in litres** — farmers literally
price a milking cow per litre; breed and grade; a vet-documented pregnancy
diagnosis; body condition, udder conformation and brucellosis-free status;
**records** — a KLBA/DRSK-registered animal with milk records and a known sire
fetches materially more; region and season.

**Schema consequence:** an animal sale needs `class_at_sale`, `price_kes`,
`weight_kg` (beef sales), `days_in_milk` and `current_daily_yield_l` (cows in
milk), `months_pregnant` (in-calf), counterparty and counterparty type
(farmer / broker / co-op / butchery / KMC).

---

## 2.2 Breeding and reproduction

### Heat

| Parameter | Value |
| --------- | ----- |
| Oestrus cycle | **21 days** (18–24) `[STD]` |
| Standing heat duration | classically ~12 h, modern research ~8 h, often shorter in the tropics |
| Only definitive sign | **standing to be mounted** when free to move |
| Secondary signs | restlessness, bellowing, mounting others, clear stringy mucus, swollen vulva, reduced yield and appetite, chin-resting |
| Voluntary waiting period after calving | **40–60 days** `[STD]` |
| Detection method in Kenya | visual observation, 2–3× daily — early morning, midday, evening `[KE]` |

**AM/PM rule:** heat seen in the morning → inseminate that evening; heat seen in
the evening → inseminate next morning.

### Service

`service_type` ∈ `AI` | `NATURAL` | `ET` · `semen_type` ∈ `CONVENTIONAL` | `SEXED`

Repeat-service intervals carry diagnostic meaning and the software should
interpret them rather than just store them:

| Return interval | Meaning |
| --------------- | ------- |
| 18–24 days | Normal return — one missed cycle |
| 3–17 days | Wrong-timing insemination or early embryonic loss |
| ~42 days | A *missed heat* — detection failure, not a fertility failure |
| >25 d, not a multiple of 21 | Suspect record error or cystic/irregular cycling |

**AI costs `[KE]`, 2026:** conventional straw **KES 700–1,000**; full private AI
service including technician and travel **~KES 3,000**; county-subsidised
conventional **KES 700**; **sexed semen KES 4,000–6,000**, up to 10,000, with
subsidised schemes charging the farmer KES 2,500.

### Pregnancy diagnosis

| Method | Earliest reliable | Kenyan availability |
| ------ | ----------------- | ------------------- |
| Non-return to heat | 21 d | Universal, unreliable alone |
| **Rectal palpation** | **~60 d** (some vets from 45 d) | **The default in Kenya** |
| Ultrasound | 28–35 d | Commercial farms, some urban vets |
| Milk/blood progesterone | 21–24 d | Research/pilot |
| PAG | 28 d+ | Rare |

Allow multiple PDs per service: `{service_id, pd_date, method, result ∈
POSITIVE|NEGATIVE|INCONCLUSIVE, estimated_months_pregnant, performed_by}`.

### Gestation and expected calving date

| Breed | Mean gestation (days) |
| ----- | --------------------- |
| Holstein-Friesian | 279–282 |
| Ayrshire | 278–280 |
| Jersey | 279–280 |
| Guernsey | 283–284 |
| Sahiwal / Zebu crosses | 285–292 (*Bos indicus* is longer) |
| Kenyan extension generic | **283** (≈9 months 9 days) `[KE]` |

`expected_calving_date = last_service_date + gestation_days(breed_of_dam)`

Default to **283** where the breed is unknown or the dam is a cross. Make
gestation a per-breed configurable constant with a per-animal override. Ignore
the bull-calf +1–2 days and twins −3–6 days adjustments; that's noise.

Derived dates that drive the whole alerting engine:

```
steaming_up_start = EDD − 60 d
dry_off_due       = EDD − 60 d
springer_flag     = EDD − 21 d
calving_alert     = EDD − 7 d
```

### Dry-off and steaming up

- **Dry period ~60 days** (8 weeks) before calving `[KE]`. Minimum 45; under 40
  costs next-lactation yield.
- **Dry-off method:** abrupt cessation preferred — stop milking, reduce
  concentrates and water for 2–3 days first — plus **dry cow therapy**
  (intramammary antibiotic in all four quarters) and teat sealant where used.
- **Steaming up:** extra concentrate in the last ~2 months, for udder tissue
  growth, foetal growth and body reserves for the first two months post-calving.
  Guidance ranges **2–3 kg/day**; typical practice starts at 1 kg and builds to
  3–4 kg by calving. `[?] sources disagree`
- **Close-up (last 3 weeks):** introduce the lactation ration gradually, restrict
  calcium to reduce milk fever risk, high-phosphorus mineral.

### Calving event

Fields: `calving_date`, `dam_id`, `sire_id`/`straw_code`,
`calving_ease` ∈ 1 `UNASSISTED` | 2 `EASY_PULL` | 3 `HARD_PULL` |
4 `VET_ASSISTED` | 5 `CAESAREAN` (the standard 1–5 dystocia score),
`calf_outcome` ∈ `LIVE` | `STILLBIRTH` | `DIED_UNDER_24H` | `ABORTION`,
`calf_sex`, `birth_weight_kg`, `number_born`, `retained_placenta`,
`milk_fever`, `assisted_by`.

Flag retained placenta if not expelled within **6–12 hours** — a common Kenyan
post-partum problem.

**Abortion** = loss before ~260 days with a non-viable foetus. **Stillbirth** =
born dead at or after ~260 days.

> **An abortion must trigger a brucellosis workflow.** Brucellosis is endemic in
> Kenya, zoonotic, and notifiable. The app should prompt: isolate the dam, do
> not handle membranes without gloves, do not feed them to dogs, test the dam.

### The KPIs experts actually track

| KPI | Target (commercial KE) | Observed in Kenya |
| --- | ---------------------- | ----------------- |
| Age at first service | 14–16 mo | often 20–30+ mo |
| **Age at first calving** | **23–24 mo** | **~34.8 mo** (crossbred smallholder study) |
| **Calving interval** | **365–380 d** ("a calf a year") | **430 d** mean across 400 Western Kenya farms; studies range 344–432 |
| Days open | 85–110 d | commonly 150–250 d |
| Days to first service | 50–70 d | often >120 d |
| Services per conception | ≤1.6 | 2.0–2.5+ |
| First-service conception rate | ≥50–60% | 35–50% |
| Heat detection rate | ≥70% | often <50% — **the biggest smallholder loss** |
| Pregnancy rate per 21-d cycle | ≥20% | — |
| Abortion rate | ≤3–5% | elevated where brucellosis is endemic |
| Calf mortality 0–3 mo | ≤5% | 10–20% common |

**All of these derive from three event tables** — `service`, `pregnancy_check`,
`calving` — plus date of birth. Build them as computed views. Store events, not
KPIs.

**Show the economics, not the metric.** Each day of calving interval beyond ~380
costs roughly the value of 3–5 litres plus a pro-rated fraction of a calf. Each
straw beyond 1.6 services costs KES 700–3,000.

---

## 2.3 Milk production and records

### Sessions

Two-times-daily is the Kenyan norm — morning ~05:00–06:30 and evening
~16:00–18:00. Three-times is used on commercial farms and for very high yielders,
adding ~10–15% yield for more labour `[STD]`.

`milking_session` ∈ `MORNING` | `NOON` | `EVENING`. The number of sessions per
day must be **per-farm configurable and changeable over time**. One row per
`(animal, date, session)`.

### Yield by breed in Kenya

| Breed | Daily (L) | 305-day lactation | Butterfat |
| ----- | --------- | ----------------- | --------- |
| Holstein-Friesian | 15–30, up to 40 on top farms | 3,000–8,000 L `[KE]` | 3.4–3.6% |
| Ayrshire | 12–25 | ~4,000–5,500 L | 3.9–4.1% |
| Guernsey | 12–20 | ~5,000–6,500 L | 4.5–5.0% |
| Jersey | 15–25 `[KE]` | ~3,000–4,500 L | **5.0–5.5%** |
| Sahiwal and crosses | 7–14 `[KE]` | ~2,100–4,300 L | 4.5–5.0% |

**National smallholder average is ~7.6 L/cow/day** (7–9 typical); well-managed
intensive systems reach 15–25. National output ~5.2 billion litres/year, >80%
from smallholders with 1–3 cows. `[KE]`

> Search results returned Ayrshire at "20,000 L per lactation" and Guernsey at
> "15,000 L". Both are wrong by roughly 4×. Use the table above. `[?]`

### Lactation curve

| Concept | Value |
| ------- | ----- |
| Standard lactation length | **305 days** — the ICAR/KLBA basis `[STD]` `[KE]` |
| Actual in Kenya | often 250–330 d, stretched by long calving intervals |
| Peak yield | **weeks 4–8** post-calving; heifers peak later (~wk 6–10) and flatter |
| Peak-to-total rule | 305-d yield ≈ peak daily × 200–220 |
| Persistency | 92–95% of peak retained per month is good |
| Dry-off trigger | yield below ~5 L/day **or** 60 days before EDD, whichever first |
| **Colostrum** | **first 4–5 days post-calving — NOT saleable**, must not enter the bulk tank |

Compute per cow: days in milk, peak yield, days to peak, cumulative lactation
yield, projected 305-day yield, persistency. **Auto-flag DIM 0–4 as
`NOT_SALEABLE`.**

### Quality tests

| Test | Measures | Kenyan practice | Spec |
| ---- | -------- | --------------- | ---- |
| Lactometer | density → added water | every co-op reception point | 1.028–1.036 g/ml at 20 °C `[KE, EAS 67]` |
| **Alcohol test** ("gun test") | acidity, keeping quality | **the most common reject test in Kenya** | no coagulation = pass |
| Organoleptic | smell, colour | first screen | — |
| **CMT** (California Mastitis Test) | somatic cells, per quarter | farm-level subclinical screening | `N`, `T`, `1`, `2`, `3` — 1+ = subclinical mastitis |
| Resazurin / methylene blue | bacterial load | co-ops and processors | referenced in EAS 67 |
| Butterfat | — | increasingly drives payment | **≥3.25%** `[KE, EAS 67]` |
| SNF | solids-not-fat | — | **≥8.50%** `[KE, EAS 67]` |
| Protein | — | added under the new payment system | ~3.2% typical |
| **Antibiotic residue** | Delvotest, beta-lactam kits | patchy enforcement | zero tolerance |
| Freezing point | added water | processor labs | 0.525–0.550 °C `[KE, EAS 67]` |

**Kenyan residue prevalence `[KE]`:** studies found **14.9%** of samples with
penicillin-G-type residues; **15.5% of farmer samples** and 18.4% of vendor
samples positive for antimicrobials. This is exactly why withdrawal tracking
(§2.5) is the highest-value feature in the system.

**January 2026 `[KE]`:** Kenya launched a **Quality-Based Milk Payment System** —
milk tested at collection for butterfat, protein and safety, with premiums for
higher quality. Milk deliveries must therefore support per-delivery quality
results and quality-adjusted pricing, not litres × a flat rate.

### Milk disposal — every litre must be accounted for

| Channel | Revenue | Payment mechanics |
| ------- | ------- | ----------------- |
| `COOP` — co-operative / Collection & Bulking Enterprise | Yes | **Monthly, less check-off deductions.** Lowest price, guaranteed offtake |
| `PROCESSOR` — Brookside, New KCC, Githunguri, Meru, Daima, Bio Foods | Yes | Monthly, quality-adjusted |
| `INSTITUTION` — schools, hospitals, hotels, restaurants, colleges | Yes | **Credit terms, invoiced.** Delivery note per drop, often against an LPO. Seasonal — schools stop in the holidays |
| `HOUSEHOLD` — neighbours, doorstep delivery | Yes | **Running tab settled weekly or monthly.** Highest price per litre, and the farm carries the debt risk |
| `SHOP` / `MILK_ATM` — milk bars, dispensers, retailers | Yes | Cash or short credit; bulk-ish volumes at a middle price |
| `HOME_CONSUMPTION` | No | Value at market price, or the profitability figure is wrong |
| `CALF_FEEDING` | No | A real cost of rearing — roughly 465 litres per heifer reared |
| `STAFF_RATION` | No | A labour cost in kind |
| `SPOILAGE` | Loss | |
| `REJECTED` — failed alcohol/lactometer/organoleptic at reception | Loss | |
| `WITHHELD_TREATMENT` | Loss | **Track separately as a KPI** |
| `WITHHELD_COLOSTRUM` | Not a loss | Fed to the calf |

**The three sales channels are three different businesses.** The co-operative is
low-price, reliable, and comes with access to check-off credit. Institutions pay
better but on terms, need paperwork per delivery, and go quiet during school
holidays. Households pay best of all, in small daily volumes, on a running tab —
which makes direct sales a **receivables problem** as much as a sales one. The
channel mix is a decision the owner should manage deliberately, using the blended
price per litre against bad debt written off.

**Daily reconciliation constraint:** `Σ(session yields per cow) = Σ(disposals)`.
Surface the discrepancy — unexplained shrinkage between parlour and can is the
classic milk-theft signal, and the farm will want to see it.

### How farmers get paid `[KE]`

| Source | Price |
| ------ | ----- |
| Government farm-gate price, from **1 Aug 2026** | **KES 52/litre** |
| New KCC (2025) | KES 50/litre |
| Other processors (2025–26) | KES 42–48, by quality and volume |
| Direct / hawked to consumers | **KES 60–100** — highest margin, tiny volumes |
| Historical low (2020, Brookside) | KES 28 — the volatility the model must tolerate |

**Monthly payment cycle.** Deliveries are recorded per member number twice daily;
payment lands once a month, typically mid-to-late in the following month. The
exact day is **per-co-op configurable** — no standard convention was confirmed.
`[?]`

**Check-off deductions are the defining feature of Kenyan co-op dairy** — the
co-op advances goods and services and recovers them from the milk cheque: AI
services, feeds and agrovet supplies, veterinary services, cash advances, SACCO
loan repayments and shares, transport levy, membership fees, and **county cess
not exceeding 0.5% of the farm-gate price**, remitted within 20 days of month
end.

**The milk statement is a first-class object:**

```
milk_statement {
  member_no, coop_id, period_start, period_end,
  total_litres, rate_per_litre (or quality-tiered rates),
  quality_bonus_kes, gross_pay_kes,
  deductions[] { type, description, amount_kes, balance_remaining },
  cess_kes, net_pay_kes, paid_date, payment_method
}
```

The **deductions array is what farmers care most about.** "Why is my cheque
smaller than I expected" is the #1 co-op grievance, and reconciling farm-side
delivery records against the co-op's statement is the killer feature.

---

## 2.4 Feeding

The client asked for fodder, concentrates and salts. Here is what those actually
contain in Kenya.

### A. Fodder / forage — the bulk of the diet

| Feed | Notes | DM% | CP% |
| ---- | ----- | --- | --- |
| **Napier grass** (Bana, Kakamega I/II, French Cameroon) | **33% of all fodder used in Kenyan zero-grazing.** Cut at 1–1.5 m / 6–8 weeks | 18–22 | 7–10 (drops sharply if cut late) |
| **Boma Rhodes** (*Chloris gayana*) | 21% of zero-graze fodder. The standard baled hay | 88–90 as hay | 7–10 |
| **Lucerne / alfalfa** | 8% of zero-graze fodder. Premium protein | 88–90 as hay | 18–22 |
| **Desmodium** | Legume, intercropped with Napier to raise protein | 20–25 | 16–20 |
| **Maize silage** | "The gold standard — high starch drives milk volume" | 30–35 | 7–9 |
| Hay (Boma Rhodes, barley, Columbus, oat straw) | Dry-season buffer, bought in bales | 88–90 | 6–10 |
| Sweet potato vines | Common supplement, must be wilted | 12–18 | 14–18 |
| **Brachiaria** (Mulato II, Cayman, Xaraes) | KALRO/ILRI-promoted, drought-tolerant, gaining fast | 22–25 | 8–12 |
| Fodder trees — Calliandra, Sesbania, Leucaena, Mulberry | Protein banks, measurable milk response | 25–30 | 20–24 |
| Maize stover, banana pseudostem, sugarcane tops | Dry-season fillers | — | 3–5 |

### B. Concentrates

**Dairy meal** — the generic compounded concentrate, sold in **70 kg bags** (also
50 kg). Brands: Unga, Fugo, Sigma, Pembe, Belfast, Chania, Kenblest, Jubilee.
Then: maize germ (the home-mix energy base), wheat bran, wheat pollard,
**cotton seed cake** (~30–35% CP, the classic Kenyan protein — watch gossypol in
young stock), sunflower cake (~28–30% CP), soya meal, fishmeal (*omena*, taints
milk if overfed), molasses, calf pellets/starter/pencils, dairy cubes,
heifer/growers' meal (14–16% CP).

### C. Minerals and salts

**Maclik Super** (CKL Africa), often written "Macklick" — 20.36% Ca, 11.0% P plus
trace elements. Label dose: **minimum 200 g/day** for cows producing up to 5 kg
milk, **+60 g per additional 5 kg of milk** `[KE]`. Also: Maclik mineral bricks,
high-phosphorus mineral (lactating), high-calcium (growing stock and dry cows,
but restrict Ca in the last 3 weeks pre-calving to reduce milk fever), plain and
rock salt, salt lick blocks.

### D. Water — never omit it

A lactating cow needs **60–100 L/day** in Kenya `[KE]`; rule of thumb **4–5
litres of water per litre of milk** plus maintenance. Water restriction is one of
the most common and cheapest-to-fix causes of low yield on Kenyan smallholdings.

### Daily dry-matter intake by class

| Class | DM intake | Fresh Napier equivalent |
| ----- | --------- | ----------------------- |
| Lactating cow, 500 kg | **~3% of bodyweight = 15 kg DM** `[KE]` | **60–70 kg/day** `[KE]` |
| Lactating cow, 400 kg | 11–13 kg | 45–55 kg |
| Lactating cow, 600 kg high yielder | 18–22 kg | 75–90 kg |
| Dry / steaming cow | 1.8–2.2% BW ≈ 9–12 kg | 40–50 kg |
| In-calf heifer | 2.0–2.5% BW ≈ 7–9 kg | 30–40 kg |
| Growing heifer 200–300 kg | 2.5% BW ≈ 5–7 kg | 20–30 kg |
| Weaner 100–200 kg | 2.5–3% BW ≈ 3–5 kg | 12–20 kg + concentrate |
| Calf, pre-weaning | milk + up to 1.5–2.5 kg starter/day, ad-lib hay from wk 2 | — |
| Mature bull | 2–2.5% BW ≈ 12–18 kg | 50–70 kg |

### Feeding rules farmers actually use

| Rule | Statement |
| ---- | --------- |
| Forage : concentrate | **70 : 30** on a DM basis `[KE, NAFIS]` |
| **Challenge feeding** | **1 kg dairy meal per extra 1.5 kg (~1.5 L) of milk above 8 litres** `[KE, NAFIS]` |
| Competing versions | Farmers also quote 1 kg per 2 L and 1 kg per 3 L. **Make it a configurable rule with a default.** `[?]` |
| Concentrate threshold | give concentrates during milking to cows producing **over 10 kg/day** `[KE, NAFIS]` |
| Steaming up | extra **2–3 kg/day** in the last 60 days |
| Concentrate maximum | never over ~50–55% of DM (acidosis); split into ≥2 feeds; never >4 kg in one feed `[STD]` |
| Mineral | ~100–200 g/day for a lactating cow |
| Calf milk | **10% of birth weight/day ≈ 4 L** in ≥2 feeds; colostrum for the first 4–5 days `[KE]` |
| Heifer rearing total | ≈ **87.5 kg concentrate + 465 litres of milk** to rear one heifer `[KE, NAFIS]` |
| Protein spec by age | weaning→1 yr **16% CP**; 1 yr→16 mo **14% CP** `[KE, NAFIS]` |
| Stocking rate | zero-graze **4–5 cows per acre** of fodder; open grazing 1–2 `[KE]` |
| Warning | "over-conditioned heifers produce less milk later in life" `[KE, NAFIS]` |

### Body condition scoring

The **1–5 scale in 0.25 increments** `[STD]`. Store as a dated observation with a
constrained decimal, not a static attribute.

| Stage | Target BCS |
| ----- | ---------- |
| At calving | 3.25–3.5 |
| Peak lactation (30–60 DIM) | 2.5–3.0 — some loss is normal, >1 point is trouble |
| Mid lactation | 2.75–3.25 |
| At dry-off | 3.0–3.5 |
| Bulling heifer at service | 2.75–3.25 |

### Feed cost share — compute it, don't assume it

| Source | Figure |
| ------ | ------ |
| NAFIS (government extension) | feed is **50–70%** of total milk production cost `[KE]` |
| Kenya Dairy Board, 2026 | **55%** intensive, **44%** open grazing, **37%** semi-intensive `[KE]` |

Default to 55–65% intensive / 40–50% semi-intensive / 35–45% open grazing, but
make it a **computed output**.

### Prices and inventory units

| Item | Unit | 2026 price (KES) |
| ---- | ---- | ---------------- |
| **Dairy meal** | **70 kg bag** | **3,100–3,500** (~44–50/kg) `[KE, Jun 2026]` |
| Dairy meal, other source | bag | 2,000–2,300 — **probably 50 kg or older data** `[?]` |
| Home-mixed ration | 50 kg | saves **KES 160–400/bag** vs commercial `[KE]` |
| Boma Rhodes hay | bale | 200–400 retail, 150–300 bulk `[KE]` |
| Barley hay | bale | 250–400 |
| Lucerne hay | bale | ~260 — **looks low, verify** `[?]` |

> **Bale weight is the biggest inventory trap in the system.** A Kenyan "bale" of
> Boma Rhodes is a conventional small square bale, commonly 15–20 kg, but sellers
> quote 12–25 kg, and round bales run 300–500 kg. **Never store hay in bales
> alone — always store `quantity`, `unit`, and `unit_weight_kg`.**

Units to support: `BAG_70KG`, `BAG_50KG`, `BAG_25KG`, `BALE` (+ weight), `KG`,
`TONNE`, `LITRE`, `BLOCK`, and the informal-but-real `HEADLOAD`, `WHEELBARROW`,
`PICKUP_LOAD` with a farm-set conversion factor.

Feed flows `purchase → store → issue to ration → consumption`, with opening
balance / purchases / issues / closing balance per feed per period, and a derived
**cost per kg DM** so we can compute **feed cost per litre** and **margin over
feed cost** — the single most useful daily number in dairy.

---

## 2.5 Health and veterinary

### Kenyan disease priority

**Tick-borne disease is the number one killer.** ECF, babesiosis and
anaplasmosis "constitute the largest component of all animal diseases that
impact negatively on the dairy industry in Kenya."

| Disease | Kenyan notes | Prevalence | Notifiable |
| ------- | ------------ | ---------- | ---------- |
| **East Coast Fever** (*Theileria parva*) | *ndigana kali*, tick-borne, kills improved stock | monthly incidence **2.5% stall-fed vs 6.9% herded-grazing** in animals ≤18 mo `[KE]` | Reportable |
| Anaplasmosis | gall sickness, tick-borne | widespread in peri-urban herds | |
| Babesiosis | *ndigana baridi*, redwater | endemic | |
| **Mastitis** | clinical + subclinical | **80% overall** in an Embu & Kajiado study — **6.8% clinical, 73.1% subclinical** `[KE]` | No |
| **FMD** | production crash, mastitis and culling spikes | endemic, outbreaks trigger movement bans | **Yes** |
| Lumpy Skin Disease | poxvirus, insect-borne | endemic | **Yes** |
| **Brucellosis** | **zoonotic**, abortion, retained placenta, infertility | endemic | **Yes** |
| Anthrax | sudden death | focal | **Yes** |
| Blackquarter | clostridial, young cattle | endemic | |
| CBPP | pastoral areas | | **Yes** |
| Rift Valley Fever | zoonotic, epidemic after heavy rain | epidemic | **Yes** |
| Trypanosomiasis | *nagana*, tsetse belts | regional | |
| Milk fever | metabolic, at calving, high yielders, 3rd+ lactation | common | No |
| Ketosis | negative energy balance, 2–6 wk post-calving | common | No |
| Bloat | frothy, on lush legumes or wet Napier | very common, fast killer | No |
| Retained placenta | not passed within 6–12 h | common | No |
| Worms | GI nematodes, liver fluke in wet areas | universal | No |
| Foot rot / lameness | wet, muddy zero-graze floors | common | No |
| Calf scours | leading cause of calf mortality | very common | No |
| Calf pneumonia | prevalent in Kenyan herds `[KE]` | | No |

### Routine calendar

| Routine | Kenyan frequency |
| ------- | ---------------- |
| **Tick control** — dipping or spraying | **Weekly** in ECF areas `[KE]`, fortnightly in low challenge. Amitraz, cypermethrin, deltamethrin — **rotate actives**. Record date, product, active, dilution, method |
| **Deworming** | **Every 3 months**; calves monthly to 6-weekly in year one; strategic around rains. Rotate drug classes. **Deworm calves 1 week before vaccination** `[KE]` |
| Hoof trimming | every 6–12 months; 2×/year on concrete |
| Disbudding | **best at 2–8 weeks**, hot iron or caustic paste |
| Body condition scoring | monthly, or at calving / 60 DIM / dry-off |
| Weighing / heart-girth taping | monthly for growing stock — essential for the "serve at 280 kg" rule |
| CMT screening | monthly on all lactating cows, at dry-off, on any yield drop |
| Brucellosis testing | annually, and on any abortion |

### Vaccination calendar (Kenya)

| Vaccine | First dose | Repeat |
| ------- | ---------- | ------ |
| **FMD** (KEVEVAPI polyvalent) | 4–6 mo | **every 6 months** (4 for better cover); often in government mass campaigns |
| LSD | 6 mo | annually |
| Anthrax | 6 mo | annually in endemic areas; often as **Blanthrax** with blackquarter |
| Blackquarter | **6 mo** | annually |
| **Brucella abortus S19** | **females aged 4–8 months, ONCE for life** `[KE]` | never in adults — interferes with testing |
| **ECF "Muguga cocktail" ITM** | calves 3 mo+ | **once in a lifetime** `[KE]`. Live sporozoites + long-acting oxytetracycline together. **Vaccinated animals become carriers.** Needs liquid-nitrogen cold chain |
| CBPP | pastoral areas | annually |
| Rift Valley Fever | outbreak-driven | |

Model as templates: `{vaccine, first_dose_min_age_days, first_dose_max_age_days,
booster_interval_days, sex_restriction, once_in_lifetime}`. The S19 window
(females only, 4–8 months, once) and ECF-ITM (once for life) need hard
validation.

### ⚠ Withdrawal periods — the highest-stakes feature in the system

Why it matters in Kenya:

1. **Legal.** Selling milk with antibiotic residues breaches the Dairy Industry
   (Dairy Produce Safety) Regulations 2021 and EAS 67. KDB can suspend a licence.
2. **Financial.** One farmer's residual-antibiotic milk can cause **a whole
   chilling-plant load to be rejected**. Co-ops charge the offending farmer for
   the destroyed load — this can wipe out a month's income and get a member
   expelled.
3. **Processing.** Antibiotics kill starter cultures; a residue load ruins a
   yoghurt or cheese batch. That's why processors test.
4. **Public health.** Antimicrobial resistance. 15–19% of Kenyan milk samples
   test residue-positive.

Indicative periods — **use the label on the specific product, never a generic
table:**

| Drug / class | Milk | Meat |
| ------------ | ---- | ---- |
| Procaine penicillin G | 3 d (72 h), residues can sit near MRL at 69 h | 10–14 d |
| Amoxicillin | 3 d | 14–21 d |
| Ampicillin | 2 d | ~14 d |
| **Oxytetracycline, short-acting** | **3 d** | 21–28 d |
| **Oxytetracycline, long-acting** | **4–7 d** | **28–35 d** |
| Sulphonamides | 3–7 d | 10–28 d |
| Fluoroquinolones | 6 d | 28+ d |
| Lactating-cow intramammary tube | **2–4 d (48–96 h)** | 7–28 d |
| **Dry cow intramammary therapy** | **≥30 days after infusion AND ≥96 h after calving**, whichever is later | — |
| Ivermectin injectable | **not licensed for lactating dairy cattle** in most jurisdictions | 28–49 d |
| Albendazole | 3–5 d | 14–27 d |
| Levamisole | 2–3 d | 3–7 d |
| Amitraz (topical) | 0–1 d | 1–7 d |
| Flunixin / NSAIDs | 1–3 d | 4–10 d |
| ECF-ITM (with long-acting oxytet) | follow the oxytetracycline LA period | as above |

> **No single published Kenyan national withdrawal table was found.** The legally
> operative number is the one printed on the product's PCPB/VMD-approved label.
> **Store the withdrawal period per product, entered by the user or held in a
> product master — never derived from a hard-coded drug list.** `[?]`

**Non-negotiable behaviour.** On recording a treatment, compute
`milk_clear_at = treatment_end + milk_withdrawal_days` and
`meat_clear_at = treatment_end + meat_withdrawal_days`, then:

- **Hard-block** that animal's milk from `COOP_DELIVERY`, `PROCESSOR_DIRECT` and
  `DIRECT_SALE` until `milk_clear_at`, forcing disposal to `WITHHELD_TREATMENT`.
- Put a persistent visual flag on the animal **and on the milking sheet**.
- Block sale-for-slaughter until `meat_clear_at`.
- Track **litres discarded due to withdrawal** as a reported KPI — a real cost
  farmers systematically underestimate.

This is the one place in the system where blocking beats warning, because the
downside is a destroyed bulk load and a suspended licence.

### Who may treat, and how it's charged

| Who | Status | Scope | Typical charge |
| --- | ------ | ----- | -------------- |
| Farm hand / herdsman | Not licensed | Spraying, dipping, OTC dewormers, observation, first aid | Wages |
| Farm manager | Not licensed | The above + records; decides when to call a vet | Salary |
| AI technician | Registered under Cap 366 | AI only | KES 700–3,000/service |
| **Animal Health Assistant / para-vet** | **Registered veterinary para-professional, KVB-licensed** | Most routine treatment, vaccination, deworming, minor procedures | KES 500–2,000/visit + drugs `[?]` |
| **Veterinary surgeon** | KVB-registered | Diagnosis, prescription-only medicines, surgery, PD, dystocia, herd health, certificates | Consultation KES 1,000–3,000; average visit ~KES 5,000 `[KE]` |

Charging models: per-call fee plus drugs (the default); **co-op check-off**
(cost deducted from the milk cheque); monthly vet retainer on commercial farms;
county-subsidised AI and mass vaccination campaigns.

`service_provider` is a typed entity — `FARM_STAFF` | `AI_TECH` | `PARAVET` |
`VET` | `COOP_VET` | `COUNTY` — with `kvb_registration_no` where applicable, and
costs attributable to `CASH`, `CREDIT` or `COOP_CHECKOFF`.

---

## 2.6 Labour and farm admin

### Roles

Farm Manager · **Herdsman / stockman / milker** (*mfugaji*) · feeder / fodder
hand (cut-and-carry, chaff cutting, ration mixing) · calf attendant · **casual**
(*kibarua*, plural *vibarua*) for fodder harvesting, silage, baling, manure ·
watchman (*mlinzi*) · tractor/lorry driver · farm clerk.

### Statutory minimum wage — agricultural industry, from 1 May 2026

Under the Regulation of Wages (Agricultural Industry) (Amendment) Order 2026
(Gazette Supplement No. 128, Legal Notices 95 & 96, 29 May 2026), after a **15%
increase** announced on Labour Day 2026:

| Occupation | Monthly (KES) | Daily (KES) |
| ---------- | ------------- | ----------- |
| Unskilled | 9,196.93 | 385.24 |
| **Stockman, herdsman, watchman** | **20,621.15** ⚠ | 449.81 |
| House servant / cook | 10,498.82 | 399.77 |
| Senior foreman | 20,740.61 | 455.70 |
| Farm foreman | 26,591.20 | 701.11 |
| Farm clerk | 26,591.20 | 701.11 |

> **⚠ Do not hard-code these.** The monthly and daily columns are mutually
> inconsistent — KES 449.81/day × 26 ≈ 11,695, not 20,621. A competing source
> gives **KES 10,621.15** for stockman/herdsman/watchman, which *is* consistent
> with the daily rate. The monthly column is probably transcription-corrupted.
> **Verify against the Gazette.** Store as configurable reference data with an
> effective date. `[?]`

Plus a **15% housing allowance** on the basic wage where the employer does not
provide accommodation. On dairy farms accommodation is usually provided, so it
often isn't paid — model both cases.

**Reality note:** actual wages on smallholder dairy units are frequently KES
8,000–15,000/month for a herdsman with housing, milk and posho provided, and KES
400–700/day for casuals — often below the gazetted minimum. Build the app to
*show* the statutory minimum as a compliance reference rather than assume it.

### Statutory deductions, 2026

| Item | Employee | Employer | Basis | Deadline |
| ---- | -------- | -------- | ----- | -------- |
| **PAYE** | 10% on first 24,000/mo; 25% on next 8,333; 30% to 500,000; 32.5% to 800,000; 35% above | — | taxable pay | **9th** of following month |
| Personal relief | KES 2,400/mo | — | | |
| **NSSF Tier I** | 6% up to the Lower Earnings Limit | **matched 6%** | LEL **KES 9,000/mo from Feb 2026** → max KES 540 each | 9th |
| **NSSF Tier II** | 6% between LEL and Upper Earnings Limit | **matched 6%** | UEL **KES 108,000/mo from Feb 2026** → max KES 5,940 each | 9th |
| **SHIF / SHA** (replaced NHIF) | **2.75% of gross, minimum KES 300, no cap** | **1.375%** ⚠ `[?]` | gross | 9th |
| **Affordable Housing Levy** | **1.5% of gross** | **1.5%** (3% total) | gross | 9th |

> The **SHIF employer contribution is disputed** — some sources state an
> additional 1.375% employer cost, others say the full 2.75% is the employee's
> and the employer merely remits. Verify with SHA/KRA before building payroll.
> `[?]`

**The zero-PAYE case is the common case.** A herdsman on KES 12,000/month has
taxable pay below the personal relief, so PAYE = 0 — but NSSF, SHIF and the
Housing Levy all still apply. Payroll must handle this correctly.

### Casual vs permanent (Employment Act 2007)

| | Casual | Permanent / term |
| - | ------ | ---------------- |
| Definition | Paid at the end of each day, engagement ≤24 h at a time | Written contract |
| **Conversion trap** | A casual working **continuously for more than one month**, or on work that cannot reasonably finish in under 3 months, **converts by operation of law** to a term contract with full benefits | — |
| Annual leave | — (once converted, yes) | **21 working days** per 12 months |
| Sick leave | — | **7 days full + 7 days half pay** after 2 months' service |
| Maternity / paternity | — | **3 months** / **2 weeks** |
| NSSF, SHIF, Housing Levy | **Yes — these apply to casuals too** | Yes |

**Schema consequence:** track `employment_type`, `start_date`, and days worked
per casual per engagement, with an **automatic warning as a casual approaches one
month of continuous engagement**. Accrue leave at 1.75 days/month.

### Recurring farm bills — the chart of accounts

Feeds & fodder (dairy meal, brans/cakes, minerals, salt, bought-in hay/silage,
fodder seed, fertiliser for Napier) · labour (wages, statutory, casuals, staff
milk/posho ration) · veterinary & health (drugs, vaccines, acaricides, dewormers,
call-outs, retainer) · breeding (AI, straws, PD fees, bull upkeep) · milk
marketing (transport to CBE, cess ≤0.5%, co-op admin levy) · utilities
(electricity for chiller/chaff cutter/milking machine/pump; water — piped,
borehole, dry-season bowser) · machinery (chaff cutter fuel and repairs, milking
machine servicing and liners, tractor, generator diesel, can and bucket
replacement) · cooling · rent · loan repayments · **livestock insurance**
(reportedly ~4% of a cow's purchase price in some co-op schemes) · bedding and
housing (sawdust, sand, floor and roof repairs) · licences and compliance (KDB
permit, county single business permit, milk-handler medical certificates) ·
manure handling — or **manure sale revenue**, see §2.8.

---

## 2.7 Regulation and compliance

### Framework

- **Dairy Industry Act, Cap. 336** — establishes the Kenya Dairy Board.
- **The Kenya Dairy Industry Regulations, 2021** — Registration/Licensing/Cess &
  Levy; Returns, Reports & Estimates; Compliance Officer; **Produce Traceability
  and Recall**; plus the Dairy Produce Safety Regulations 2020/21.
- **Carriage of Milk Regulations** — milk carriage permit.
- **Veterinary Surgeons and Veterinary Para-Professionals Act, Cap 366.**
- **Employment Act 2007**, **NSSF Act 2013**, **Social Health Insurance Act
  2023**, **Affordable Housing Act 2024**.
- **KS EAS 67: Raw cow milk — Specification** (2006/07, revised 2019).

### Licensing — what a producer actually needs

**An individual primary producer selling raw milk from their own farm generally
does NOT need a KDB processing licence.** Licensing bites once you collect, bulk,
transport, trade or process.

| Category | Fee (KES/yr) |
| -------- | ------------ |
| Dairy farmer groups and individual farmers collecting, bulking and marketing raw milk | **1,800** total |
| Premises retailing pasteurised milk in small quantities | 2,500 |
| Premises processing 3,000–5,000 L/day + dispensing units | 6,600 incl. application |
| Processors below 20,000 L/day | 25,000 |
| Processors above 20,000 L/day | 50,000 |
| Milk carriage permit | required for transport |

Fees are from secondary sources — verify at
[kdb.go.ke](https://www.kdb.go.ke/index.php/permit-categories-and-fees/). `[?]`

In practice also required: county single business permit, public health / food
handler medical certificates for anyone handling milk, and NEMA/public health
approval for larger premises.

### Hygiene

Milk must move in **aluminium or stainless steel** cans and approved vehicles —
**plastic jerricans are non-compliant**, though ubiquitous informally. Premises
need adequate potable water. Personnel need a **medical certificate**.
Regulations set conditions for farms, collection centres, milk bars, dispensers,
cottages, mini-dairies and processors, and cover labelling, calibration, records,
storage and distribution. Milk should be chilled to ≤4 °C within a short window
of milking, commonly quoted as 2–3 hours. `[?]`

### Traceability

The **Produce Traceability and Recall Regulations 2021** create an explicit
obligation. For a farm this means answering: *which animals contributed to which
delivery, on which date, and were any of them under treatment?*

That maps exactly onto our data model:
`animal → milking session → daily bulk → delivery → statement line`. Keep that
lineage intact and traceability is satisfied as a by-product.

### Records that unlock money

| Need | Records required |
| ---- | ---------------- |
| Co-op membership | National ID, photo, share capital, membership fee, farm location, animal count → then a **member number** used on every delivery |
| **Credit from co-op / SACCO** | Certification by the society; **all advanced credit is repaid from milk proceeds** — a consistent delivery history *is* the collateral, typically 6–12 months |
| **Livestock insurance** | **A vet's valuation report** assessing breed, age, production history and health → the Sum Insured. Plus ear tag, photographs, health and vaccination records. Premium ~4% of purchase price in one co-op scheme |
| Insurance as collateral | the policy document is accepted by financiers as alternative security |
| Selling breeding stock at a premium | KLBA/DRSK registration, pedigree, milk records, brucellosis/TB certificates |

> **Build an exportable "animal passport"** — a one-page PDF per animal with ID,
> breed, DOB, sire and dam, calving history, lactation yields, vaccinations and
> treatments, and current status. That single artifact serves insurance
> valuation, credit applications and sale negotiations. It is cheap to build and
> is the kind of thing that makes a farm keep entering data.

---

## 2.8 Profitability

### Cost of production per litre

```
Total cost (period)
  Variable
    + Feeds & fodder (purchased + imputed cost of home-grown)
    + Veterinary, drugs, vaccines, acaricides, dewormers
    + Breeding (AI, semen, PD, bull upkeep)
    + Casual labour
    + Milk marketing, transport, co-op levy, cess
    + Utilities directly used (water, electricity for cooling and chaff cutting)
    + Consumables (detergents, teat dip, filters, bedding)
  Fixed
    + Permanent labour + statutory contributions
    + Depreciation (cowshed, milking equipment, chaff cutter, cooling)
    + Land rent or imputed land cost
    + Interest on loans
    + Insurance, licences
    + Herd depreciation / replacement cost

Cost per litre = total cost ÷ litres PRODUCED (not litres sold)
```

Compute **both** variants and label them: **cash cost per litre** (out-of-pocket,
what farmers think about) and **full economic cost per litre** (including family
labour, own fodder, depreciation, land — the true figure).

**Benchmark `[KE]`:** the Kenya Dairy Board puts cost of production at
**KES 30–37 per litre**. Against a farm-gate price of KES 42–52, that is a gross
margin of roughly **KES 8–20/litre**.

**The mathematical heart of Kenyan dairy profitability:** cost per litre falls
steeply with yield per cow, because a large share of cost — maintenance feed,
labour, housing, health — is **per cow, not per litre**. A cow giving 8 L/day
carries the same maintenance cost as one giving 20.

### Revenue lines — don't miss the non-milk ones

Milk to co-op/processor (less deductions and cess) · direct/hawked milk at a
higher rate · **imputed value of home consumption and staff ration** ·
**calf sales** (a 10-cow farm example valued these at KES 16,667–41,667/month) ·
**in-calf heifer sales** — the highest-value output of a well-run herd ·
cull cow sales by liveweight · **manure sales**, KES 10,000–15,000/month for a
10-cow unit `[KE]`, plus biogas slurry · surplus fodder/hay sales ·
**herd inventory change** — the value of the herd growing is a real income line.

### Margins actually reported

| Source | Figure | Assessment |
| ------ | ------ | ---------- |
| Kenyan smallholder study | **KES 2,192/cow/month ≈ 26,309/cow/year gross margin** `[KE]` | **Credible** — ~8 L/day × 30 × KES 45 ≈ 10,800 revenue, less ~8,600 variable cost. Use as the realistic baseline |
| KDB | KES 30–37/L cost vs 42–52/L price → **KES 8–20/L** | Credible, consistent |
| A commercial blog's "10-cow farm" | net profit KES 174,000–279,000/month | **Not credible — do not use.** Feed at KES 45–60k/month for 10 milking cows is impossible: 10 cows × 6 kg dairy meal × 30 d × KES 46 ≈ **KES 83,000 for concentrate alone**, before forage. And 25 L/cow/day is 3× the national average. Marketing arithmetic `[?]` |

**Default model assumptions** (smallholder, zero-graze, Central/Rift Valley, 2026):
yield 10–15 L/cow/day in milk · 280–305 days in milk/year · farm-gate KES 45–52/L ·
cost of production KES 32–38/L · feed 55–65% of cost · gross margin KES 8–16/L ·
**KES 25,000–60,000 gross margin per cow per year.**

### The biggest levers, in order

1. **Yield per cow per day** — dominant, because per-cow fixed costs are diluted.
   Moving 8 → 14 L/day roughly *triples* margin per cow.
2. **Feed cost per litre** (not feed cost in absolute terms). Growing own quality
   forage instead of buying dairy meal is the classic Kenyan intervention;
   home-mixing saves KES 160–400 per 50 kg bag.
3. **Calving interval.** Every day beyond ~380 is a day of tail-lactation or dry
   days at full maintenance cost with deferred calf revenue. Cutting 430 → 390
   days is worth roughly one extra month of peak milk per cycle.
4. **Calf mortality and age at first calving.** Every month AFC exceeds ~24
   adds KES 3,000–5,000 of rearing cost with zero return. Kenya's reality of 34.8
   months against a 24-month target is an enormous, recoverable loss.
5. **Mastitis and milk quality.** At ~73% subclinical prevalence, subclinical
   mastitis is silently removing 10–20% of milk — plus rejection losses and, under
   the new quality-based payment system, a direct price penalty.
6. **Marketing channel mix.** Direct sale at KES 60–100 vs co-op at 45–52. Even a
   small direct share lifts the blended price — but the co-op gives guaranteed
   offtake, check-off inputs and credit access.
7. **Tick control discipline.** ECF incidence 2.5%/month stall-fed vs 6.9%
   herded. Each case risks a KES 150,000+ asset.
8. **Withdrawal-period discipline.** One rejected bulk load can exceed a month's
   profit.
9. **Labour productivity** — litres per labour-hour.
10. **Culling the bottom of the herd.** A 6 L/day cow is usually loss-making at
    KES 45/L; her stall is worth more to a 15 L cow.

### The KPI set the app computes

`litres/cow/day` · `litres/cow/year` · `305-d yield` · `peak yield` ·
`days in milk` · `feed cost/litre` · **`margin over feed cost/litre`** ·
`total cost/litre` · `gross margin/cow/month` · `calving interval` · `days open` ·
`age at first calving` · `services per conception` · `conception rate` ·
`heat detection rate` · `calf mortality %` · `CMT-positive %` · `litres rejected %` ·
`litres withheld (treatment) %` · `culling rate` · `replacement rate` ·
`labour cost/litre` · `stocking rate (cows/acre fodder)`.

---

## 2.9 The record books a Kenyan farm is told to keep

Kenyan extension manuals (KALRO/NAFIS, SNV-KMDP, the ILRI/KARI Smallholder Dairy
Project guide) prescribe a consistent record set. **This is our forms
specification** — matching these layouts is how the digital and paper records
stay reconcilable, per the M-Pesa dual-record lesson.

| Record | Columns |
| ------ | ------- |
| **Herd inventory** | Animal ID/tag · name · sex · breed composition (e.g. "¾ Friesian × ¼ Zebu") · DOB · sire · dam · origin (`BORN` / `PURCHASED` / `GIFT`) · date of entry · purchase price · current class · parity · reproductive status · current weight + date · colour/markings/photo · KLBA registration no. · date and reason of exit (`SOLD`/`DIED`/`SLAUGHTERED`/`CULLED`/`STOLEN`) · exit value. Plus period reconciliation: opening + births + purchases − deaths − sales = closing |
| **Individual cow card** | The canonical Kenyan artifact — one card per cow, pinned in the parlour. Header (ID, name, breed, DOB, sire, dam, date acquired, photo) then breeding & calving history, lactation summaries, health & treatment, weights & BCS |
| **Daily milk record** | Date · cow · morning · noon · evening · day total · remarks (on heat, sick, in treatment, mastitis) |
| **Monthly milk sheet** | Cow names down the left, `1 AM \| 1 PM \| 2 AM \| 2 PM …` across the month, monthly total. **This is the form most Kenyan farms actually use** — replicate it for printing |
| **Daily farm milk summary** | Date · total AM · total PM · total produced · delivered to co-op · sold locally + price · home consumption · fed to calves · staff ration · spoiled/rejected + reason · withheld (treatment) · balance/discrepancy · amount received · recorder's signature |
| **Breeding record** | Cow · last calving date · **dates of heat observed** · service date · service no. for this pregnancy · AI/bull · bull name/straw code/batch/breed · inseminator · cost · **return-to-heat date** · PD date/method/result · **EDD** · steaming-up date · dry-off date · actual calving date · calving ease · calf ID/sex/birth weight · calving problems · days open · calving interval · services per conception |
| **Calf register** | Calf ID · DOB · sex · birth weight · dam · sire · breed · colostrum fed (date, time, litres) · daily milk fed + method · date starter introduced · concentrate intake · monthly weight · disbudding date · deworming dates · vaccination dates · health events · **weaning date & weight** · disposal (retained/sold + price/died + cause) |
| **Feeding record** | Date · animal or group · feed type · quantity · unit · number of animals fed · cost/unit · total cost · remarks |
| **Feed store record** | Date · item · opening balance · received/purchased · supplier · unit price + total · issued out · issued to · closing balance · signature |
| **Fodder production record** | Plot · crop · area (acres) · date planted · inputs + cost · date harvested · quantity (kg/bales/tonnes) · storage location |
| **Health / treatment record** | Date · animal · signs · diagnosis · drug name · active ingredient + batch · dosage & route · duration · **milk withdrawal → clear date** · **meat withdrawal → clear date** · treated by (+ KVB no.) · cost + payment method · outcome · follow-up date |
| **Vaccination / routine record** | Date · animal or group · type (vaccination/deworming/dipping/hoof trim/disbudding) · product + active · batch + expiry · dose · administered by · cost · **next due date** |
| **Income & expenditure (cash book)** | Date · particulars · category · receipt/voucher no. · income · expenditure · payment method (cash/M-Pesa/bank/check-off/credit) · running balance · remarks |
| **Labour record** | Date · employee · role · type · days worked · rate · gross · NSSF · SHIF · housing levy · PAYE · advances/deductions · net paid · signature |
| **Milk delivery & reconciliation** | Date · session · litres delivered · co-op/CBE · delivery note no. · accepted/rejected · reject reason · **litres per the co-op's own record** · variance · butterfat % · rate applied · value |
