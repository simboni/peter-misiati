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

## 6. Programme registers (HIV, TB, NCD)

| # | Rule | Where | Source | Status |
|---|---|---|---|---|
| 6.1 | Lost to follow-up after **28 days** on HIV care | `programmes.ts` `LOST_AFTER_DAYS` | General practice | ⚠️ |
| 6.2 | Lost to follow-up after **14 days** on TB treatment — a fortnight off treatment risks resistance | `programmes.ts` | General practice | ⚠️ |
| 6.3 | Lost to follow-up after **60 days** on the NCD clinic | `programmes.ts` | General practice | ⚠️ |
| 6.4 | HIV and NCD cohorts run **12 months**; TB runs **6**, because treatment is a fixed course | `programmes.ts` `seedProgrammes` | General practice | ⚠️ |
| 6.5 | The cohort is the month of enrolment, stamped then and never moved | `programmes.ts` | Programme reporting | ✅ |
| 6.6 | **Transferred out counts as RETAINED** in the retention figure — they are in care, elsewhere. Getting this wrong understates every facility that refers | `programmes.ts` `cohortReport` | Programme reporting | ⚠️ |
| 6.7 | A patient cannot hold two enrolments in one programme, and a programme number cannot be re-used | `programmes.ts` | Design rule | ✅ |
| 6.8 | Findings recorded per programme: HIV viral load and adherence, TB sputum, NCD blood pressure and HbA1c | `programmes/page.tsx` | General practice | ⚠️ |
| 6.9 | **These thresholds and cohort lengths are from general practice, NOT from Kenya's current programme guidelines.** They are data, changeable in one place | — | — | 🔴 |

## 7. Maternity, newborn and child health

This is the section that most needs a midwife's eye. Everything below is a
decision the code makes on its own, and most of it comes from published
guidance rather than from anyone at the facility having agreed to it.

| # | Rule | Where | Source | Status |
|---|---|---|---|---|
| 7.1 | The expected date is the last menstrual period **plus 280 days** (Naegele's rule), derived and never stored twice | `maternity.ts` `expectedDate` | Standard obstetric practice | ✅ |
| 7.2 | A dating **scan overrides** the last menstrual period, and the record shows which was used | `maternity.ts` | Standard obstetric practice | ✅ |
| 7.3 | A pregnancy with neither an LMP nor a scan date is **refused at booking** — it cannot be scheduled, assessed for prematurity, or claimed | `maternity.ts` `bookPregnancy` | Design rule | ✅ |
| 7.4 | The antenatal schedule is **8 contacts, at 12, 20, 26, 30, 34, 36, 38 and 40 weeks** | `maternity.ts` `ANC_CONTACT_WEEKS` | WHO 2016 antenatal care model | ⚠️ |
| 7.5 | **Systolic ≥ 140 or diastolic ≥ 90 raises a CRITICAL alert** — raised blood pressure in pregnancy is pre-eclampsia until proven otherwise | `maternity.ts` `recordAncContact` | Standard obstetric practice | ⚠️ |
| 7.6 | **Haemoglobin < 7 g/dL raises a CRITICAL alert** as severe anaemia | `maternity.ts` | WHO anaemia thresholds | ⚠️ |
| 7.7 | Any free-text danger sign escalates, whatever it says — the system does not attempt to judge which ones matter | `maternity.ts` | Design rule | ✅ |
| 7.8 | Gestation is **computed and stored at each contact**, so the record shows what the midwife knew that morning rather than what a later correction implies | `maternity.ts` | Design rule | ✅ |
| 7.9 | **Under 37 completed weeks is preterm** | `maternity.ts` `TERM_WEEKS` | WHO definition | ✅ |
| 7.10 | **Under 2500 g is low birth weight**, is flagged at the delivery and is reported | `maternity.ts` `LOW_BIRTH_WEIGHT_GRAMS` | WHO definition | ✅ |
| 7.11 | Every **live baby is registered as a patient in their own right**, with their own file number and date of birth. Twins are two records | `maternity.ts` `recordDelivery` | Design rule | ✅ |
| 7.12 | A baby who did not live gets **no patient record** — a stillbirth is recorded against the delivery | `maternity.ts` | Design rule | ⚠️ |
| 7.13 | Postnatal contacts at **24 hours, day 3, week 1–2 and week 6** | `maternity.ts` `PNC_SCHEDULE` | WHO postnatal care guidance | ⚠️ |
| 7.14 | A postnatal danger sign is **always critical** — most maternal deaths occur in these days | `maternity.ts` `recordPncContact` | Standard practice | ⚠️ |
| 7.15 | A repeat dose of a vaccine already given is **refused**, not duplicated — a double dose is a reportable event | `maternity.ts` `recordImmunisation` | Design rule | ⚠️ |
| 7.16 | Immunisation due dates come from the **child's own date of birth**, never the mother's delivery date | `maternity.ts` `immunisationCard` | Design rule | ✅ |
| 7.17 | The childhood schedule is **17 vaccines**: BCG and OPV0 at birth; OPV/PCV/pentavalent/rotavirus at 6, 10 and 14 weeks; IPV at 14; vitamin A at 6 months; measles–rubella at 9 and 18 months | `maternity.ts` `seedImmunisationSchedule` | Kenya national schedule as published | 🔴 |
| 7.18 | **The KEPI schedule changes.** A card built on a stale schedule marks children overdue who are not, and misses children who are. It must be confirmed against the current national schedule, and re-confirmed when it changes | — | — | 🔴 |
| 7.19 | The caesarean rate and the stillbirth rate per 1000 total births are reported as **absent, not zero**, when there were no deliveries in the period | `maternity.ts` `maternitySummary` | Design rule | ✅ |
| 7.20 | Maternity is claimed **inside the SHA package, against the mother's own SHA number**. There is no Linda Mama number: that scheme ended with NHIF when SHA took over, and the module deliberately does not ask for one | `maternity.ts`, `schema.sql` | SHA transition, October 2024 | ✅ |

### What a midwife should be asked first

Three questions, in the order they matter:

1. **Is it 8 contacts or 4?** The code follows WHO's 2016 eight-contact model.
   If the facility still works Kenya's older four-visit focused schedule, every
   woman on the register will read as behind from her second contact onwards.
   This is one line of data to change (`ANC_CONTACT_WEEKS`), but it changes
   what the whole antenatal screen says.
2. **Are 140/90 and Hb 7 the right lines to draw?** They are the thresholds at
   which the system interrupts somebody. Set too low and the alerts get
   ignored; too high and the one that mattered was never raised.
3. **Is the immunisation schedule current?** It is the only list here a
   clinician can check in five minutes, and the only one where being out of
   date silently produces wrong work every day.

## 8. Public health

| # | Rule | Where | Source | Status |
|---|---|---|---|---|
| 8.1 | Notifiable conditions are detected from coded diagnoses as they are made, because the Act's clock runs from diagnosis | `reporting.ts` | Public Health Act | ✅ |
| 8.2 | **The notifiable list is four conditions** — malaria, tuberculosis, cholera, measles. The full schedule must be loaded | `reporting.ts` `NOTIFIABLE_PREFIXES` | — | 🔴 |
| 8.3 | Reporting one requires the county's reference — it is the proof it was made | `reporting.ts` | Design rule | ✅ |
| 8.4 | MOH 705A is under five, 705B is five and over, split by age **on the day of the visit** | `reporting.ts` | MOH forms | ✅ |
| 8.5 | A condition is counted whichever code in its ICD-11 family the clinician used | `reporting.ts` `MOH705_CONDITIONS` | Design rule | ⚠️ |
| 8.6 | **The 705 condition list is six conditions.** The real form has many more rows | `reporting.ts` | — | 🔴 |

## 9. Revenue (for the claims specialist, not the clinician)

| # | Rule | Where | Source | Status |
|---|---|---|---|---|
| 9.1 | Nine scrubber gates, each mapped to a documented SHA rejection cause | `claims.ts` `scrub` | SHA published causes | ⚠️ |
| 9.2 | **The gates are inferred from documented causes, not from 50 real rejected claims.** The roadmap says to build them from a real corpus and that is still the right next step | — | — | 🔴 |
| 9.3 | A claim beyond the payer's submission window (SHA: 7 days) escalates rather than blocking, because a late claim still has an appeal path | `claims.ts` | SHA | ⚠️ |
| 9.4 | Tariffs and benefit rules are **illustrative**. The SHA schedule for the contracting cycle must be loaded | `seed.ts` | — | 🔴 |
| 9.5 | Money is integer cents throughout, and a price is fixed as of the date of service | `billing.ts` | Design rule | ✅ |

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
11. Programme lost-to-follow-up thresholds and cohort lengths, against Kenya's
    current HIV, TB and NCD programme guidelines
12. The childhood immunisation schedule, against the current KEPI schedule
13. A midwife's answer on the antenatal contact schedule (8 contacts or 4) and
    on the blood-pressure and haemoglobin alert thresholds
