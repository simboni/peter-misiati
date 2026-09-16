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

## 8. Emergency and casualty

The triage scale here decides who is seen first. It is the highest-consequence
table in the system and it is entirely a clinical judgement, not an
engineering one.

| # | Rule | Where | Source | Status |
|---|---|---|---|---|
| 8.1 | **Emergency treatment is never gated on payment.** `openAttendance` performs no payer check, no deposit, no coverage probe and no consent form, and will open an attendance with no name at all | `emergency.ts`, `casualty/actions.ts` | Constitution Art. 43(2); Health Act 2017 s.7 | ✅ |
| 8.2 | Triage is the **South African Triage Scale**: a Triage Early Warning Score plus discriminators | `emergency.ts` `tews` | SATS, as published | ⚠️ |
| 8.3 | TEWS components: mobility, respiratory rate, pulse, systolic, temperature, AVPU, trauma | `emergency.ts` | SATS | ⚠️ |
| 8.4 | **Score bands: 7+ red, 5–6 orange, 3–4 yellow, 0–2 green** | `emergency.ts` `triageFromScore` | SATS | ⚠️ |
| 8.5 | **Time targets: red immediate, orange 10 min, yellow 60 min, green 240 min** | `emergency.ts` `TARGET_MINUTES` | SATS | ⚠️ |
| 8.6 | **A discriminator can only raise a colour, never lower it.** The failure that kills people is a sick patient talked into a lower queue | `emergency.ts` `worst` | Design rule | ✅ |
| 8.7 | Raising a triage by hand must record what was seen | `emergency.ts` | Design rule | ✅ |
| 8.8 | A partial set of observations scores only what was recorded, so it **under-reads rather than over-reads** — the safe direction for a score only a discriminator can raise | `emergency.ts` | Design rule | ⚠️ |
| 8.9 | **TEWS treats a respiratory rate of 15–20 as abnormal** (its normal band is 9–14), so a rate most charts print as normal scores 1. This surprises people and is pinned by a test | `emergency.ts` | SATS | ⚠️ |
| 8.10 | **Re-triage does not reset the clock.** Handing a long-waiting patient a fresh target would erase the wait | `emergency.ts` `triagePatient` | Design rule | ✅ |
| 8.11 | Every triage assessment is kept; the first is evidence of what was known then | `emergency.ts` | Design rule | ✅ |
| 8.12 | A red triage raises a **critical alert at the moment of assessment** | `emergency.ts` | Design rule | ✅ |
| 8.13 | Blue is dead on arrival and is **not a queue position** | `emergency.ts` | SATS | ⚠️ |
| 8.14 | Observations outside a plausible range are **refused, not scored** — a transposed digit must not become a triage colour | `emergency.ts` | Design rule | ✅ |
| 8.15 | A patient who cannot say who they are gets a real record under a deliberately provisional name; **identifying them later is a merge, not an edit** | `emergency.ts` `openUnidentified`, `identify` | Design rule | ✅ |
| 8.16 | An estimated age is stored as `dob_estimated`, never as a birthday | `emergency.ts` | Design rule | ✅ |
| 8.17 | **`left_without_being_seen` is a first-class outcome**, not a tidy-up. It is the number that tells a department it is too slow | `emergency.ts` `recordDisposition` | Design rule | ✅ |
| 8.18 | An untriaged patient sorts **above every colour** on the board — an unknown colour is not a mild one | `emergency.ts` `board` | Design rule | ✅ |
| 8.19 | An admission from casualty must name the admission; a referral and a death must each record why | `emergency.ts` | Design rule | ✅ |
| 8.20 | Medico-legal cases are kept **separate from the clinical record**, because the P3 is disclosed to the police and the notes are not | `schema.sql`, `emergency.ts` | DPA 2019; practice | ⚠️ |
| 8.21 | Issuing a P3 records who took it, cannot be done twice, and is written to the audit chain as a disclosure | `emergency.ts` `issueP3` | DPA 2019 | ✅ |
| 8.22 | **Sexual violence and child protection raise a critical alert on opening**, because each has a care pathway and a clock of its own | `emergency.ts` | Practice | 🔴 |
| 8.23 | The median wait and the within-target rate are reported as **absent, not zero**, when nobody was seen | `emergency.ts` `emergencySummary` | Design rule | ✅ |

### What an emergency clinician should be asked first

1. **Is SATS the right scale for this facility?** Some Kenyan units run their
   own colour scheme or a locally adapted version. The scale, its bands and its
   targets are three constants in one file, but changing them changes who is
   seen first — which is the whole module.
2. **Are the time targets the ones this facility is held to?** 10/60/240
   minutes are the SATS defaults. If the county or the facility's own charter
   sets different ones, the breach list is measuring the wrong thing, and the
   breach list is the screen the department runs on.
3. **What should happen on a sexual violence case, minute by minute?** Marked
   🔴 because the system currently raises an alert and stops. There is a
   national post-rape care pathway — PRC form, forensic sampling window,
   PEP timing — and none of it is modelled. It needs to be, or the alert is
   the only thing standing between the patient and the general queue.

## 9. Referrals

Mostly design and operational rules rather than clinical ones, but two need a
clinician's agreement and one needs the county's.

| # | Rule | Where | Source | Status |
|---|---|---|---|---|
| 9.1 | **A patient cannot depart towards a facility that has not accepted them.** `depart` refuses on a referral that is merely raised | `referrals.ts` `departReferral` | Design rule | ✅ |
| 9.2 | An acceptance records **a name, not just a yes** — somebody has to be findable when the patient reaches the gate | `referrals.ts` `acceptReferral` | Design rule | ✅ |
| 9.3 | **A referral to a higher level must record what was already done here.** A referral that cannot say what was tried is how a referral hospital ends up seeing everything | `referrals.ts` `raiseReferral` | Practice | ⚠️ |
| 9.4 | The level rule is **advisory, not enforced**. Kenya's levels describe capability, not permission, and a dispensary with a dying patient does not need software routing it via the health centre | `referrals.ts` | Design rule | ⚠️ |
| 9.5 | A decline must say why, so the next facility knows whether to try the same place | `referrals.ts` `declineReferral` | Design rule | ✅ |
| 9.6 | **Acceptance targets: emergency 30 min, urgent 4 h, routine 48 h.** Past the target the referral is flagged as unanswered | `referrals.ts` `ACCEPTANCE_TARGET_MINUTES` | Operational | 🔴 |
| 9.7 | **A referral with no outcome stays open forever.** There is no automatic tidy-up; closing it needs somebody to say what happened to the patient | `referrals.ts` `awaitingOutcome` | Design rule | ✅ |
| 9.8 | Past **7 days** with no counter-referral the loop is treated as broken | `referrals.ts` `OUTCOME_CHASE_DAYS` | Operational | 🔴 |
| 9.9 | A counter-referral must say what was done **and what this facility should continue** — that is the point of it coming back | `referrals.ts` `recordOutcome` | Practice | ⚠️ |
| 9.10 | The **loop-closed rate counts only referrals that actually left.** One still waiting for acceptance is a different problem and would blame the wrong thing | `referrals.ts` `referralSummary` | Design rule | ✅ |
| 9.11 | Destinations come from a **directory, not free text**. A destination nobody can telephone is not a destination | `schema.sql`, `referrals.ts` | Design rule | ✅ |
| 9.12 | The directory carries **same-level neighbours**, not only bigger hospitals — a directory of only referral hospitals quietly teaches everybody to refer upwards | `referrals.ts` `seedReferralDirectory` | Design rule | ✅ |
| 9.13 | A facility not in the directory can still be used, recorded by name | `referrals.ts` | Design rule | ✅ |
| 9.14 | **Both directions are kept.** A facility that only records what it sends cannot show what it receives | `schema.sql` | Design rule | ✅ |
| 9.15 | Every state change is an event row with who and when — the defence against "we never received it" | `schema.sql` `referral_events` | Design rule | ✅ |
| 9.16 | The letter is returned as **data, not rendered**, so print, screen and transmission cannot drift apart | `referrals.ts` `referralLetter` | Design rule | ✅ |
| 9.17 | **The demonstration directory is eight facilities.** The real one is a KMHFL extract for the county and its neighbours, loaded at commissioning | `referrals.ts` | — | 🔴 |

### What to ask, and of whom

1. **A clinician:** is "record what was already done" the right gate on an
   upward referral, or does it slow down a genuine emergency? The module
   applies it to every referral going up a level, including emergencies. An
   alternative is to exempt emergency urgency — but that is the exact case
   where the receiving hospital most needs to know what has been given.
2. **The county referral coordinator:** are 30 minutes, 4 hours and 48 hours
   the right windows to expect an answer in, and is 7 days the right point to
   call a loop broken? These four numbers decide what the two worklists show,
   and they are currently operational guesses.
3. **The facility:** which KMHFL facilities actually belong in the directory.
   This is the highest-value data task in the module and the cheapest — it is
   a list, and getting it right is the difference between a referral somebody
   can telephone and a name on a form.

## 10. Theatre

The checklist table below is the highest-consequence list in the system after
the triage scale. Two of these rules are the only things standing between a
theatre and a never-event.

| # | Rule | Where | Source | Status |
|---|---|---|---|---|
| 10.1 | **Anaesthesia does not start without the sign-in.** Enforced, not advised | `theatre.ts` `startAnaesthesia` | WHO Surgical Safety Checklist | ✅ |
| 10.2 | **The knife does not touch the patient without the time-out** | `theatre.ts` `recordIncision` | WHO | ✅ |
| 10.3 | **The patient does not leave theatre without the sign-out** | `theatre.ts` `leaveTheatre` | WHO | ✅ |
| 10.4 | Every checklist item is answered and stored **individually**, never as one "checklist done" flag — a checklist recorded as a single tick is one nobody read aloud | `schema.sql`, `theatre.ts` | Design rule | ✅ |
| 10.5 | **"Not applicable" is an answer; silence is not.** A stage cannot be completed while any item is unanswered | `theatre.ts` `completeStage` | Design rule | ✅ |
| 10.6 | **A "no" is recorded and escalated, never blocked.** Software that refuses to proceed on a "no" teaches a team to answer yes, which is worse than no checklist at all. The decision to proceed stays with the surgeon | `theatre.ts` `answerChecklist` | Design rule | ⚠️ |
| 10.7 | **The 19 checklist items are the WHO checklist as published**, across three stages | `theatre.ts` `CHECKLIST` | WHO | ⚠️ |
| 10.8 | **Which items are "critical"** — the ones where a "no" raises an alert: identity, site marking, anaesthesia check, oximeter, allergy, airway, blood loss risk, confirm-aloud, sterility, antibiotic, procedure recorded, counts, specimen | `theatre.ts` | Judgement | 🔴 |
| 10.9 | Each completed stage is **signed**, with the answers as the signed content | `theatre.ts` `completeStage` | Design rule | ✅ |
| 10.10 | **The count must reconcile before sign-out.** Swabs, instruments and needles counted in and out; a mismatch blocks the sign-out | `theatre.ts` `completeStage`, `countDiscrepancies` | Practice | ✅ |
| 10.11 | A mismatch raises a **critical alert** saying nobody leaves theatre | `theatre.ts` `recordCountOut` | Practice | ✅ |
| 10.12 | **A discrepancy is cleared by recording how it was resolved, never by editing the numbers.** The record has to show there was one | `theatre.ts` `resolveCount` | Design rule | ✅ |
| 10.13 | Surgical consent is **separate from general treatment consent** and is signed against the procedure and the risks together, so a later change to either no longer matches | `theatre.ts` `recordSurgicalConsent` | Practice | ⚠️ |
| 10.14 | **Anaesthesia does not start without recorded surgical consent** | `theatre.ts` | Practice | ✅ |
| 10.15 | **What was performed is recorded separately from what was planned.** A difference is a deviation from consent, escalated as one; the plan is never edited to match | `theatre.ts` `closeCase` | Design rule | ✅ |
| 10.16 | The operation note must say what was done **and** what was found, and is signed | `theatre.ts` | Practice | ✅ |
| 10.17 | Who was in the room is recorded — an operation note that cannot name the scrub nurse is not a record anybody can rely on afterwards | `schema.sql` `theatre_team` | Practice | ⚠️ |
| 10.18 | **Urgency windows: immediate 1 h, urgent 24 h, expedited 7 days, elective no clock** | `theatre.ts` `URGENCY_TARGET_HOURS` | NCEPOD classification | 🔴 |
| 10.19 | **ASA grade 1 to 6**, recorded but not currently acted on | `schema.sql` | ASA | ⚠️ |
| 10.20 | **Cancellation carries a category as well as a reason.** The categories are the ones a theatre manager argues about: no anaesthetist, no bed, no blood, patient unfit | `theatre.ts` `cancelCase` | Practice | ⚠️ |
| 10.21 | "Cancelled on the day" means the patient had been called for, or the cancellation fell on the scheduled date — that is the cancellation a theatre manager is asked about | `theatre.ts` `theatreSummary` | Design rule | ⚠️ |

### What to ask a surgeon and an anaesthetist

1. **Is this your checklist?** The 19 items are WHO's. Many facilities have
   adapted them — added a fire-risk item, split the antibiotic item, dropped
   one that never applies. The items are data in one constant; the adaptation
   is a small change and should be made before anyone is trained on it.
2. **Which items should raise an alert on a "no"?** Marked 🔴 because the
   critical set is my judgement, not a published list. Get it wrong in one
   direction and the alerts are ignored; in the other, the one that mattered
   never fired.
3. **Are the urgency windows right?** 1 hour / 24 hours / 7 days is the NCEPOD
   classification. Also worth deciding: should ASA grade gate anything — an
   ASA 4 on an elective list in a level 2 facility is arguably a case that
   should not be booked here at all, and the system currently records it
   without comment.

## 11. Radiology

Everything here follows from one fact: you cannot un-expose somebody. Two of
these rules are the only things standing between a patient and an avoidable
dose, and one is the only thing standing between a patient and a magnet.

| # | Rule | Where | Source | Status |
|---|---|---|---|---|
| 11.1 | **Nothing ionising is exposed without a recorded justification**, and it is enforced at `performStudy`, not collected afterwards | `radiology.ts` | Radiation Protection Act; IAEA BSS | ✅ |
| 11.2 | **The pregnancy question is answered before an ionising exposure** of a female patient who could be pregnant. "Not applicable" is an answer and has to say why | `radiology.ts` `justifyStudy` | Practice | ✅ |
| 11.3 | **Childbearing age is taken as 12 to 55.** A convention, not a law: too narrow and somebody is missed, too wide and the question becomes noise that gets clicked through | `radiology.ts` `CHILDBEARING_AGE` | Judgement | 🔴 |
| 11.4 | A female patient with **no date of birth is asked anyway** — unknown is not a reason to skip the question | `radiology.ts` `needsPregnancyCheck` | Design rule | ✅ |
| 11.5 | **A possible or confirmed pregnancy escalates the study; it does not block it.** A necessary film in a shocked patient is still the right film, and blocking teaches people to answer "not pregnant" to get past the screen | `radiology.ts` | Design rule | ⚠️ |
| 11.6 | **Ultrasound and MRI are not ionising**, so neither needs a dose justification or a pregnancy check | `radiology.ts` `IONISING` | Physics | ✅ |
| 11.7 | **MRI is the one place the system refuses outright.** A "yes" or "unknown" on pacemaker, aneurysm clip, cochlear implant or metal in the eye stops the scan until a radiologist or MRI safety officer clears it | `radiology.ts` `performStudy` | Practice | ⚠️ |
| 11.8 | An MRI cannot run until **every** screening question is answered | `radiology.ts` | Practice | ✅ |
| 11.9 | **The seven MRI screening questions**, and which four of them block | `radiology.ts` `MRI_SCREENING` | Standard screening, abbreviated | 🔴 |
| 11.10 | **Dose is cumulative and per patient.** "How much has this child had this year" is the question nobody can usually answer, because dose is recorded per study and never summed | `radiology.ts` `cumulativeDose` | Design rule | ✅ |
| 11.11 | Where equipment reports no dose, a **typical figure is used and marked as an estimate**, so a cumulative total is never silently zero for a facility with older machines | `radiology.ts` `TYPICAL_DOSE_USV` | Design rule | ⚠️ |
| 11.12 | **The typical dose figures are illustrative** — X-ray 100 µSv, CT 7000, fluoroscopy 3000, mammography 400. They must be replaced with the facility's own measured values | `radiology.ts` | — | 🔴 |
| 11.13 | **A repeat must record why the first study was not adequate.** A repeat is a second dose, and a department needs to know which projection or which machine keeps repeating | `radiology.ts` `openStudy` | Practice | ✅ |
| 11.14 | Two studies never share an accession — that is how one patient's film lands on another's report | `schema.sql` | Design rule | ✅ |
| 11.15 | **A critical finding is communicated to a named person at a recorded time**, exactly as a panic laboratory value is. Filing it is not communicating it | `radiology.ts` `recordCommunication` | Practice | ✅ |
| 11.16 | **A final report that disagrees with the provisional is kept as a discrepancy**, and the provisional is never overwritten — it is what the ward acted on overnight | `radiology.ts` `reportStudy` | Practice | ✅ |
| 11.17 | A discrepancy must say what the difference is **and what follows from it** | `radiology.ts` | Design rule | ✅ |
| 11.18 | A report must give an **impression**, not only findings — findings without one leave the decision to the reader | `radiology.ts` | Practice | ⚠️ |
| 11.19 | A second report of the same kind is refused; **a correction is an addendum** | `radiology.ts` | Practice | ✅ |
| 11.20 | Every report is **signed**, with the reporter's licence number where one is current | `radiology.ts` | Design rule | ✅ |
| 11.21 | An imaging request is an **order**, on the same table the laboratory uses — one worklist, one idea of what is outstanding | `radiology.ts`, `orders.ts` | Design rule | ✅ |

### What to ask a radiographer and a radiologist

1. **Is 12 to 55 the right window for the pregnancy question?** Marked red.
   It is the single most-answered question in the module, and getting it wrong
   either misses somebody or turns the prompt into a reflex click.
2. **Is the MRI screening list complete enough, and is the blocking set
   right?** Marked red. The seven questions are an abbreviation of the
   standard screening. A facility with an MRI needs its own full form and its
   own named safety officer — and if the facility has no MRI, this is dead
   code that should be turned off rather than left looking functional.
3. **What are this facility's actual doses?** The typical figures are
   order-of-magnitude placeholders so that a cumulative total is never
   silently zero. They are honest about being estimates — the screen says what
   share of the total is estimated rather than measured — but they are not
   this facility's numbers, and dose audit needs real ones.

Also worth a decision from whoever holds the facility's radiation licence:
this module records dose and justification, but the **licence itself, the
personnel dosimetry and the equipment QA schedule sit with the national
regulator, not with this software**. Nothing here should be mistaken for
compliance with that.

## 12. Procurement (for the administrator, not the clinician)

Money leaks out of a facility in three ways: paying for goods nobody can show
arrived, paying a price nobody agreed, and one person controlling the chain
from request to payment. These rules are three controls against those three.

| # | Rule | Where | Source | Status |
|---|---|---|---|---|
| 12.1 | **The three-way match is computed, not asserted.** An invoice is checked line by line against what was ordered and what was received, from the rows rather than from a total | `procurement.ts` `matchInvoice` | Standard control | ✅ |
| 12.2 | **The payable figure is the received quantity at the ordered price** — the definition of what a facility actually owes, and almost never the number on the invoice when something has gone wrong | `procurement.ts` | Standard control | ✅ |
| 12.3 | **A mismatch queries the invoice; it does not block it.** Blocking would move the payment off the system, which is worse than a payment the system can explain. Approving a queried invoice needs a written reason | `procurement.ts` `approveInvoice` | Design rule | ⚠️ |
| 12.4 | **The person who raised a requisition cannot approve it.** The oldest control in procurement and the first one quietly dropped, so it lives in code rather than in a policy document | `procurement.ts` `decideRequisition` | Standard control | ✅ |
| 12.5 | **The person who recorded an invoice cannot approve it for payment** | `procurement.ts` | Standard control | ✅ |
| 12.6 | Only an approved invoice is paid, and a payment records its reference | `procurement.ts` `payInvoice` | Standard control | ✅ |
| 12.7 | **The same invoice number from one supplier cannot be recorded twice** — paying an invoice twice is the simplest fraud there is, and the easiest to make impossible | `schema.sql`, `procurement.ts` | Standard control | ✅ |
| 12.8 | **A supplier without a current PPB licence cannot supply medicines**, checked at the order rather than the invoice — by the invoice the drugs are on the shelf and somebody has taken them | `procurement.ts` `canSupplyMedicines` | Pharmacy and Poisons Board | ⚠️ |
| 12.9 | **Every line on a purchase order is treated as a medicine** for the licence check. Conservative, and wrong for a facility that buys gloves and stationery through the same module | `procurement.ts` `issuePurchaseOrder` | Judgement | 🔴 |
| 12.10 | A delivery **cannot bring what was not ordered** — that is how unordered stock, and the invoice for it, enters a facility | `procurement.ts` `receiveDelivery` | Standard control | ✅ |
| 12.11 | **Receiving creates the goods received note and the stock batch together**, so there is no window in which a delivery exists on paper and not on the shelf | `procurement.ts` | Design rule | ✅ |
| 12.12 | A short delivery leaves the order **part received**, worked out from the rows rather than asserted at the door | `procurement.ts` | Design rule | ✅ |
| 12.13 | **Rejected quantity has its own column and its own reason.** Short-dated stock refused on the day is a supplier problem; accepted, it is the facility's | `schema.sql` | Practice | ✅ |
| 12.14 | Expired stock is **refused at the door** — the only place refusing it is cheap | `inventory.ts` `receiveStock` | PPB | ✅ |
| 12.15 | **Choosing a supplier must record why**, and the audit entry flags when it was not the cheapest. "Cheapest" is a reason; so is "the only one with stock" | `procurement.ts` `selectQuotation` | PPADA 2015; practice | ✅ |
| 12.16 | **Three quotations is expected but not enforced.** The threshold that applies depends on the facility's legal status and its own procurement policy, and is not something this software can know | `procurement.ts` `EXPECTED_QUOTATIONS` | PPADA 2015 | 🔴 |
| 12.17 | Blocking a supplier records why, removes them from the list you order from, and leaves them on the list you audit | `procurement.ts` `blockSupplier` | Design rule | ✅ |
| 12.18 | **AGPO category and certificate are recorded but not enforced.** A public entity has a 30% reservation to meet; the module can show the split but does not police it | `schema.sql` | AGPO | 🔴 |
| 12.19 | A supplier invoice with **no eTIMS control number is surfaced** — it may not be claimable against tax | `procurement.ts` `procurementSummary` | KRA | ⚠️ |
| 12.20 | A requisition records **what the store had at the moment of asking**, so an approver can judge it without going to look | `procurement.ts` `raiseRequisition` | Design rule | ✅ |

### What to ask the administrator, and the accountant

1. **Is every purchase a medicine?** Marked red. The PPB licence check runs on
   every line of every order. That is right for a pharmacy store and wrong for
   gloves, fuel or stationery — a facility buying those through this module
   will be blocked by a rule meant for drugs. The fix is a product category, and
   it should be made before anybody is trained on a workaround.
2. **What is this facility's quotation threshold?** Marked red. Three is the
   rule most work to, and below the tender threshold it is the law for a public
   entity — but the threshold depends on legal status and on the facility's own
   policy. The module counts and shows; somebody has to decide what it should
   refuse.
3. **Does the AGPO reservation apply here?** Marked red. If the facility is a
   public entity, 30% of procurement spend is reserved for youth, women and
   persons with disability. The category is recorded against every supplier, so
   the report can be built — but it is not built, and not enforced.

One more, for whoever signs the cheques: **the module deliberately lets a
queried invoice be paid**, with a written reason. That is a design choice, not
an oversight. Refusing outright would push the payment into a cheque book the
system never sees, and a payment this system can explain is worth more than one
it never learns about.

## 13. Public health

| # | Rule | Where | Source | Status |
|---|---|---|---|---|
| 13.1 | Notifiable conditions are detected from coded diagnoses as they are made, because the Act's clock runs from diagnosis | `reporting.ts` | Public Health Act | ✅ |
| 13.2 | **The notifiable list is four conditions** — malaria, tuberculosis, cholera, measles. The full schedule must be loaded | `reporting.ts` `NOTIFIABLE_PREFIXES` | — | 🔴 |
| 13.3 | Reporting one requires the county's reference — it is the proof it was made | `reporting.ts` | Design rule | ✅ |
| 13.4 | MOH 705A is under five, 705B is five and over, split by age **on the day of the visit** | `reporting.ts` | MOH forms | ✅ |
| 13.5 | A condition is counted whichever code in its ICD-11 family the clinician used | `reporting.ts` `MOH705_CONDITIONS` | Design rule | ⚠️ |
| 13.6 | **The 705 condition list is six conditions.** The real form has many more rows | `reporting.ts` | — | 🔴 |

## 14. Revenue (for the claims specialist, not the clinician)

| # | Rule | Where | Source | Status |
|---|---|---|---|---|
| 14.1 | Nine scrubber gates, each mapped to a documented SHA rejection cause | `claims.ts` `scrub` | SHA published causes | ⚠️ |
| 14.2 | **The gates are inferred from documented causes, not from 50 real rejected claims.** The roadmap says to build them from a real corpus and that is still the right next step | — | — | 🔴 |
| 14.3 | A claim beyond the payer's submission window (SHA: 7 days) escalates rather than blocking, because a late claim still has an appeal path | `claims.ts` | SHA | ⚠️ |
| 14.4 | Tariffs and benefit rules are **illustrative**. The SHA schedule for the contracting cycle must be loaded | `seed.ts` | — | 🔴 |
| 14.5 | Money is integer cents throughout, and a price is fixed as of the date of service | `billing.ts` | Design rule | ✅ |

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
14. The national post-rape care pathway — PRC form, forensic sampling window,
    PEP timing. Casualty currently raises an alert and models nothing further
15. An emergency clinician's answer on the triage scale, its score bands and
    its time targets
16. The referral directory as a real KMHFL extract for this county and its
    neighbours
17. The referral acceptance windows and the broken-loop threshold, agreed with
    the county referral coordinator
18. Which WHO checklist items should raise an alert on a "no", confirmed by a
    surgeon and an anaesthetist
19. The theatre urgency windows, and whether ASA grade should gate a booking
20. The childbearing-age window for the imaging pregnancy question
21. The MRI safety screening as this facility's own full form, with a named
    safety officer — or the modality turned off if there is no scanner
22. This facility's own measured dose figures, replacing the illustrative ones
23. A product category, so the PPB licence check on a purchase order applies to
    medicines and not to gloves and stationery
24. This facility's quotation threshold, and whether the AGPO reservation
    applies to it
