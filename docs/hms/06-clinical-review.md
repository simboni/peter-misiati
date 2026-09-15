# Clinical rules that need a clinician's signature

**Purpose.** The system encodes clinical rules — scoring thresholds, reference
ranges, drug warnings, care pathways. Each was taken from a published source and
each is written down here with that source, so a Kenyan clinician can check them
without reading code.

**Who needs to sign this off.** A clinical advisor (a medical officer or senior
clinical officer with Kenyan outpatient and inpatient experience) and, for the
revenue rules, a claims specialist. The market research names both as the single
biggest predictor of whether a health system works in practice: *"every
documented HMIS failure traces back to software built without someone who has
worked the counter."*

**How to use this document.** Go down the table. For each row, either tick it or
tell the engineer what it should be. Nothing here is hard to change — they are
data or a single function — but changing them after go-live means re-checking
every record that was scored under the old rule.

**Status key.** ✅ checked against the published source · ⚠️ needs a Kenyan
clinician's judgement · 🔴 placeholder, must be replaced before go-live

---

## 1. Diagnosis coding

| # | Rule | Where | Source | Status |
|---|---|---|---|---|
| 1.1 | Ten ICD-11 codes ship with the system; every one was checked individually against the published MMS classification | `seed.ts` `ICD11_STARTER` | WHO ICD-11 MMS | ✅ |
| 1.2 | Codes that could not be confirmed were left out rather than guessed | — | — | ✅ |
| 1.3 | **The full WHO ICD-11 MMS release must be loaded before go-live.** Ten codes is not a catalogue; a clinician who cannot find their diagnosis picks something close, and that is how wrong codes reach claims | `importCodes()` | — | 🔴 |
| 1.4 | Only *verified* codes can be used on a claim. A guessed code is worse than none: no code stops at the scrubber, a wrong one is paid and then clawed back | `terminology.ts` | Design rule | ✅ |
| 1.5 | An encounter cannot close without exactly one coded **primary** diagnosis | `encounters.ts` | SHA claim requirement | ⚠️ |

## 2. Prescribing safety

| # | Rule | Where | Source | Status |
|---|---|---|---|---|
| 2.1 | A **severe or anaphylactic** allergy blocks prescribing and needs a written override | `prescribing.ts` `checkSafety` | Design rule | ⚠️ |
| 2.2 | A **mild** allergy informs and stops nothing | `prescribing.ts` | Design rule | ⚠️ |
| 2.3 | A controlled drug flags the **pharmacy**, not the prescriber | `prescribing.ts` | Design rule | ⚠️ |
| 2.4 | Only one grade of warning interrupts. A system that blocks on everything teaches clinicians to override reflexively, and then the warning that mattered is overridden too | — | Design rule | ⚠️ |
| 2.5 | **Drug–drug interaction checking does not exist.** Allergy checking only | — | — | 🔴 |
| 2.6 | **Paediatric dose calculation does not exist.** A dose is typed free-hand | — | — | 🔴 |
| 2.7 | A product with no PPB registration cannot be dispensed or taken into stock | `inventory.ts`, `pharmacy.ts` | Pharmacy and Poisons Act | ✅ |
| 2.8 | **PPB registration numbers in the starter formulary are placeholders.** The real register must be loaded | `seed.ts` `FORMULARY_STARTER` | — | 🔴 |

## 3. Laboratory

| # | Rule | Where | Source | Status |
|---|---|---|---|---|
| 3.1 | A reading becomes a result only when a **KMLTTB-registered** technologist releases it | `laboratory.ts` | KMLTTB | ✅ |
| 3.2 | Reference ranges are matched to the patient's **sex and age**, most specific first | `laboratory.ts` `rangeFor` | Standard practice | ✅ |
| 3.3 | Adult haemoglobin: male 13–17, female 12–15 g/dL. Panic below 7 or above 20 | `seed.ts` | Standard literature | ⚠️ |
| 3.4 | Child haemoglobin (0–14 years): 11–14 g/dL. Panic below 6 | `seed.ts` | Standard literature | ⚠️ |
| 3.5 | Potassium 3.5–5.1 mmol/L. Panic below 2.5 or above 6.5 | `seed.ts` | Standard literature | ⚠️ |
| 3.6 | Sodium 135–145 mmol/L. Panic below 120 or above 160 | `seed.ts` | Standard literature | ⚠️ |
| 3.7 | Glucose 3.9–7.8 mmol/L. Panic below 2.5 or above 25 | `seed.ts` | Standard literature | ⚠️ |
| 3.8 | WBC 4–11, platelets 150–450 ×10⁹/L, creatinine 60–110 µmol/L | `seed.ts` | Standard literature | ⚠️ |
| 3.9 | **A facility running its own analyser must load the ranges that analyser was validated against.** A flag from somebody else's instrument is a flag nobody trusts | `defineRange()` | — | 🔴 |
| 3.10 | A panic value raises a critical alert on the ordering clinician's desk in the same transaction as the release | `laboratory.ts` | Design rule | ✅ |
| 3.11 | A qualitative result is "abnormal" when it reads positive, reactive, detected or seen | `laboratory.ts` | Design rule | ⚠️ |

## 4. Inpatient

| # | Rule | Where | Source | Status |
|---|---|---|---|---|
| 4.1 | NEWS2 aggregate early-warning score, standard scoring table | `inpatient.ts` `news2` | RCP NEWS2 | ⚠️ |
| 4.2 | **The consciousness (AVPU) and supplemental-oxygen components are NOT recorded**, so the score under-reads rather than over-reads | `inpatient.ts` | — | 🔴 |
| 4.3 | Escalation threshold is set at **5**, chosen to account for 4.2 | `inpatient.ts` `NEWS2_ESCALATION` | — | ⚠️ |
| 4.4 | A score of 7 or more is critical rather than a warning | `inpatient.ts` | RCP NEWS2 | ⚠️ |
| 4.5 | A temperature outside 25–45 °C is refused as a mis-keyed reading | `inpatient.ts` | Design rule | ⚠️ |
| 4.6 | Diastolic above systolic is refused as the two being the wrong way round | `inpatient.ts` | Design rule | ✅ |
| 4.7 | A dose not given must record why. "No entry" could mean refused, vomited, absent or forgotten, and at an inquest those are entirely different | `inpatient.ts` | Design rule | ✅ |
| 4.8 | A sex-restricted ward refuses an admission of the other sex | `inpatient.ts` | Design rule | ⚠️ |

## 5. Triage and the queue

| # | Rule | Where | Source | Status |
|---|---|---|---|---|
| 5.1 | Three priorities: emergency, urgent, routine — seen in that order, then by waiting time | `frontdesk.ts` | Kenyan triage practice | ⚠️ |
| 5.2 | **No formal triage scale** (no MTS, no ESI, no South African Triage Scale). Priority is set by a person | — | — | ⚠️ |
| 5.3 | Vitals are stored as integers in fixed units: temperature in tenths of °C, weight in grams, height in mm | `frontdesk.ts` | Design rule | ✅ |

## 6. Public health

| # | Rule | Where | Source | Status |
|---|---|---|---|---|
| 6.1 | Notifiable conditions are detected from coded diagnoses as they are made, because the Act's clock runs from diagnosis | `reporting.ts` | Public Health Act | ✅ |
| 6.2 | **The notifiable list is four conditions** — malaria, tuberculosis, cholera, measles. The full schedule must be loaded | `reporting.ts` `NOTIFIABLE_PREFIXES` | — | 🔴 |
| 6.3 | Reporting one requires the county's reference — it is the proof it was made | `reporting.ts` | Design rule | ✅ |
| 6.4 | MOH 705A is under five, 705B is five and over, split by age **on the day of the visit** | `reporting.ts` | MOH forms | ✅ |
| 6.5 | A condition is counted whichever code in its ICD-11 family the clinician used | `reporting.ts` `MOH705_CONDITIONS` | Design rule | ⚠️ |
| 6.6 | **The 705 condition list is six conditions.** The real form has many more rows | `reporting.ts` | — | 🔴 |

## 7. Revenue (for the claims specialist, not the clinician)

| # | Rule | Where | Source | Status |
|---|---|---|---|---|
| 7.1 | Nine scrubber gates, each mapped to a documented SHA rejection cause | `claims.ts` `scrub` | SHA published causes | ⚠️ |
| 7.2 | **The gates are inferred from documented causes, not from 50 real rejected claims.** The roadmap says to build them from a real corpus and that is still the right next step | — | — | 🔴 |
| 7.3 | A claim beyond the payer's submission window (SHA: 7 days) escalates rather than blocking, because a late claim still has an appeal path | `claims.ts` | SHA | ⚠️ |
| 7.4 | Tariffs and benefit rules are **illustrative**. The SHA schedule for the contracting cycle must be loaded | `seed.ts` | — | 🔴 |
| 7.5 | Money is integer cents throughout, and a price is fixed as of the date of service | `billing.ts` | Design rule | ✅ |

---

## What must be replaced before go-live

Everything marked 🔴, in one list:

1. The full WHO ICD-11 MMS release
2. The real PPB product register
3. The SHA tariff schedule and benefit package for the contracting cycle
4. Laboratory reference ranges validated against the facility's own analyser
5. The full Public Health Act notifiable-disease schedule
6. The complete MOH 705A/705B condition rows
7. NEWS2 consciousness and supplemental-oxygen scoring
8. Drug–drug interaction checking
9. Paediatric dose calculation
10. A scrubber rule set built from 50 real rejected claims
