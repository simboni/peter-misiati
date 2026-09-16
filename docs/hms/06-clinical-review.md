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

## 13. Accounting (for the accountant)

The ledger is the one module where the rules are not a matter of judgement:
double entry has been settled for five hundred years. What is worth reviewing
is how the operational side is mapped into it.

| # | Rule | Where | Source | Status |
|---|---|---|---|---|
| 13.1 | **A journal that does not balance is refused** before anything is written — not warned about, not queued for review | `accounting.ts` `postJournal` | Double entry | ✅ |
| 13.2 | Each line is a debit **or** a credit, never both and never neither; amounts are whole cents and never negative, because the side carries the sign | `schema.sql`, `accounting.ts` | Double entry | ✅ |
| 13.3 | **A posted journal is never edited.** It is reversed by a second journal that points at the first and says why, and both stand | `accounting.ts` `reverseJournal` | Double entry | ✅ |
| 13.4 | A journal cannot be reversed twice | `accounting.ts` | Double entry | ✅ |
| 13.5 | **A closed period takes no postings.** A late entry goes to the open period with a note about what it is for | `accounting.ts` `postJournal` | Standard practice | ✅ |
| 13.6 | **A period is not closed over an out-of-balance trial balance** — closing would freeze the error in place | `accounting.ts` `closePeriod` | Standard practice | ✅ |
| 13.7 | Reopening a closed period must record why. Auditors ask | `accounting.ts` `reopenPeriod` | Standard practice | ✅ |
| 13.8 | Periods are **calendar months opened on demand**. A facility with a different year-end defines its own | `accounting.ts` `periodFor` | Judgement | ⚠️ |
| 13.9 | **Nobody types a journal for ordinary work.** Invoices, payments, deliveries and supplier payments become journals automatically; a clinician never sees a debit | `accounting.ts` `postFromOperations` | Design rule | ✅ |
| 13.10 | **Running the posting job twice cannot double-post.** Every posting carries the id of the thing it is the accounting for, and that pair is unique. Without this a posting job is a machine for double-counting | `schema.sql` `idx_journal_source` | Design rule | ✅ |
| 13.11 | **A patient's debt and a payer's are different accounts** — different ages, different people chasing them | `accounting.ts` `ACCOUNT` | Practice | ✅ |
| 13.12 | **A waiver is not money.** It is the debt written off to an expense account; treating it as cash inflates both income and the cash book | `accounting.ts` | Practice | ✅ |
| 13.13 | A refund posts the other way round **from the same rows** — there is one payments table, not a payments table and a refunds table | `accounting.ts`, `billing.ts` | Design rule | ✅ |
| 13.14 | **The ledger is reconciled against operations, not assumed to agree.** Cash and M-Pesa against the till, receivables against outstanding invoices and claims | `accounting.ts` `reconcile` | Design rule | ✅ |
| 13.15 | **Only payment-sourced cash is compared against the till.** A float, petty cash or a correction is real cash and not a till discrepancy; it is shown separately rather than allowed to masquerade as one | `accounting.ts` | Design rule | ✅ |
| 13.16 | An account's balance is reported on **its own normal side**, so income reads as a positive figure rather than a negative asset | `accounting.ts` `trialBalance` | Double entry | ✅ |
| 13.17 | The balance sheet shows **the surplus separately** rather than folding it into equity | `accounting.ts` `balanceSheet` | Judgement | ⚠️ |
| 13.18 | **The chart of accounts is a starter, not a chart.** Seventeen accounts, enough to demonstrate the mechanism | `accounting.ts` `seedChartOfAccounts` | — | 🔴 |
| 13.19 | **No VAT treatment is implemented.** Most healthcare services in Kenya are exempt, which is not the same as zero-rated, and the difference matters for input tax | — | — | 🔴 |
| 13.20 | **No withholding tax on supplier payments.** A supplier payment debits the payable and credits the bank in full | `accounting.ts` | — | 🔴 |
| 13.21 | **Stock is posted at purchase cost when received, and never relieved on issue.** Cost of goods sold is not computed, so the surplus figure overstates until it is | `accounting.ts` `postFromOperations` | — | 🔴 |

### What to ask the accountant, in order

1. **The chart of accounts.** Seventeen accounts demonstrates the mechanism and
   runs nobody's business. This is the cheapest of the red items and the one
   everything else depends on.
2. **Cost of goods sold.** Marked red and the most consequential: stock is
   capitalised when it arrives and never released when it is dispensed, so the
   income statement shows income without the cost of the medicines that earned
   it. The surplus on that page is therefore too high, and will stay too high
   until issues post against cost of goods. The mechanism exists — stock
   movements are already recorded per batch with a unit cost — but the posting
   is not written.
3. **VAT and withholding.** Neither is implemented. Healthcare services are
   largely exempt in Kenya, which is not the same as zero-rated, and the
   distinction decides whether input tax can be recovered. That is a question
   for an accountant and not one this software should guess at.

Nothing in this module is tax advice, and the facility's own accountant should
see the chart and the mappings before a single figure is relied on.

## 14. Payroll (for the accountant, urgently)

**This section needs an accountant before anybody is paid from this module.**
It is the most Kenya-specific code in the system and the easiest to be
confidently wrong about: PAYE bands, the NSSF tier limits, the SHIF rate and
the housing levy have each changed within the last three years.

| # | Rule | Where | Source | Status |
|---|---|---|---|---|
| 14.1 | **Every statutory rate is a row with the date it took effect and a note of its source** — not a constant. Correcting one after a Finance Act is a data change, not a release | `schema.sql` `statutory_rates` | Design rule | ✅ |
| 14.2 | A payslip is computed from the rates in force on **its own pay date**, and the result is stored. Reprinting one from two years ago shows what was actually paid | `payroll.ts` `computePay`, `payslips` | Design rule | ✅ |
| 14.3 | **Loading the rates twice does not double anybody's deductions.** Idempotent on (kind, date, lower bound), with a COALESCE in the index because SQLite treats nulls as distinct | `payroll.ts` `setRate` | Design rule | ✅ |
| 14.4 | A payroll will not run if no rate is in force for the pay date — **producing zero deductions silently would be far worse than refusing** | `payroll.ts` `createRun` | Design rule | ✅ |
| 14.5 | **PAYE bands: 10% / 25% / 30% / 32.5% / 35%**, monthly, seeded as in force from 1 July 2023 | `payroll.ts` `seedStatutoryRates` | Published rates | 🔴 |
| 14.6 | **Personal relief KES 2,400 a month**, taken off the tax and never refunded as pay | `payroll.ts` | Published rates | 🔴 |
| 14.7 | **NSSF two tiers at 6% each**, employee and employer, on limits of KES 8,000 and KES 72,000 — seeded as in force from February 2025. The limits rise on a published schedule | `payroll.ts` | NSSF Act 2013 | 🔴 |
| 14.8 | **SHIF at 2.75% of gross, minimum KES 300**, in force from October 2024 when it replaced NHIF | `payroll.ts` | SHIF | 🔴 |
| 14.9 | **Housing levy at 1.5% of gross, matched by the employer**, in force from March 2024 | `payroll.ts` | Affordable Housing Act 2024 | 🔴 |
| 14.10 | **The order of the deductions**: NSSF, SHIF and the housing levy come off gross, PAYE is computed on what is left, and relief comes off the tax. Getting that order wrong changes what a person is paid | `payroll.ts` `computePay` | Tax law | 🔴 |
| 14.11 | **Whether an allowance is taxable is explicit, never assumed.** It is the commonest payroll error there is | `schema.sql` `pay_items.taxable` | Practice | ✅ |
| 14.12 | **A non-taxable allowance is excluded from the NSSF, SHIF and housing bases as well as from PAYE.** Defensible for a genuine reimbursement, but it is a judgement and it changes three figures | `payroll.ts` | Judgement | 🔴 |
| 14.13 | **Net pay is never negative.** Statutory deductions take priority and a SACCO or advance recovery gets what is left; the shortfall is reported so it can be rescheduled, not carried | `payroll.ts` | Design rule | ✅ |
| 14.14 | **Prepared by one person, approved by another.** Payroll is where a facility's largest recurring payment leaves, and one person controlling it end to end is how a ghost worker gets paid for three years | `payroll.ts` `approveRun` | Standard control | ✅ |
| 14.15 | **A paid run is never edited or cancelled.** A correction is a new run — a payslip is evidence in an employment dispute | `payroll.ts` `cancelRun` | Practice | ✅ |
| 14.16 | A cancelled run releases its period, so it can be rerun. Enforced by a **partial** unique index, because a plain one would block the rerun | `schema.sql` `idx_run_period` | Design rule | ✅ |
| 14.17 | Paying a run posts **the whole cost of employment** — gross plus the employer's own contributions — not just the bank transfer. Posting only the net understates staff costs by roughly a third | `payroll.ts` `payRun` | Accounting | ✅ |
| 14.18 | The deductions are a **liability until remitted**, not an expense already settled | `payroll.ts` | Accounting | ✅ |
| 14.19 | An employee with **no KRA PIN is surfaced** — there is no PAYE return without one | `payroll.ts` `payrollSummary` | KRA | ✅ |
| 14.20 | A leaver stays on the record, off the payroll, and off the next run | `payroll.ts` `endEmployment` | Design rule | ✅ |
| 14.21 | **No NITA levy, no leave accrual, no gratuity, no overtime rules, no casual-worker treatment** | — | — | 🔴 |

### What to ask the accountant, in order

1. **Check all six rate tables against the current law.** Marked red because
   they are the module's entire output. They were seeded from published rates
   as understood at the time of writing, which is not the same as being right
   today. The whole design exists so that this is a data change, and the
   Statutory rates screen says so in a red box above the table.
2. **Confirm the order of the deductions** (rule 14.10) and **what a
   non-taxable allowance is exempt from** (rule 14.12). The second is the
   subtler one: the module excludes a genuine reimbursement from the NSSF,
   SHIF and housing bases as well as from PAYE. That is defensible, and it is
   still a judgement that changes three figures on every affected payslip.
3. **Decide what is missing.** NITA levy, leave accrual, gratuity, overtime and
   the treatment of casual workers are all absent. For a small private clinic
   that may be acceptable for a first release; for anything with unionised
   staff it is not.

Nothing in this module is tax advice.

## 15. Human resources

Mostly employment law rather than clinical judgement, but one rule here is a
patient-safety rule wearing an HR coat.

| # | Rule | Where | Source | Status |
|---|---|---|---|---|
| 15.1 | **Cover is matched on the regulator's registration, not the job title.** A title is what a facility calls somebody; a registration is what the law lets them do. Two people both called "Laboratory Technologist" where only one holds a KMLTTB registration is the case this exists to get right | `hr.ts` `coverFor` | Design rule | ✅ |
| 15.2 | **Leave is not blocked for want of cover — it is acknowledged in writing.** People are entitled to leave, and software that refuses it teaches a facility to keep its leave register in a notebook where nobody can see the gap at all | `hr.ts` `decideLeave` | Design rule | ⚠️ |
| 15.3 | Approving uncovered leave raises an alert to the facility, because a laboratory closed for a week is not an HR matter | `hr.ts` | Design rule | ✅ |
| 15.4 | A licence that lapses **during** the absence is not cover | `hr.ts` `coverFor` | Design rule | ✅ |
| 15.5 | Somebody who holds no registration needs no licensed cover, and saying so is not a failure | `hr.ts` | Design rule | ✅ |
| 15.6 | **A lapsed registration is not a reminder** — the access module has been refusing that person's licensed actions since the day it expired. HR's job is that it never comes as news | `hr.ts` `expiries`, `access.ts` | Design rule | ✅ |
| 15.7 | **Only the latest licence per regulator counts.** A renewed one is not expiring, and adding an older row to somebody who holds a current one lapses nothing | `hr.ts` `expiries` | Design rule | ✅ |
| 15.8 | **The expiry horizon is 90 days** — enough for a KMPDC or NCK renewal to be possible. A facility with slower internal approvals wants longer | `hr.ts` `EXPIRY_HORIZON_DAYS` | Judgement | 🔴 |
| 15.9 | **A fixed-term contract with no end date is refused.** A tribunal reads it as permanent | `hr.ts` `issueContract` | Employment Act 2007 | ⚠️ |
| 15.10 | A renewal **supersedes** rather than replaces: the old terms are what applied while they applied, and an employment dispute is fought over exactly that | `hr.ts` | Practice | ✅ |
| 15.11 | **Annual leave 21 working days** after twelve months' service | `hr.ts` `seedLeaveTypes` | Employment Act 2007 | 🔴 |
| 15.12 | **Sick leave 14 days.** The Act gives 7 at full pay and 7 at half pay — THE HALF-PAY HALF IS NOT MODELLED, so payroll will overpay a long sickness | `hr.ts` | Employment Act 2007 | 🔴 |
| 15.13 | **Maternity 90 days, paternity 14 days**, per event | `hr.ts` | Employment Act 2007 | 🔴 |
| 15.14 | **A leave balance is the sum of rows, never a number somebody edited.** Accrual, leave taken and explicit adjustments each leave a row, so a balance can always be explained to the person whose it is | `hr.ts` `leaveBalance` | Design rule | ✅ |
| 15.15 | Approved leave comes off the balance **before** it is taken, so two bookings cannot both fit in the same remaining days | `hr.ts` | Design rule | ✅ |
| 15.16 | Leave beyond the balance is refused, and the refusal says what is left. Adjusting past it needs a recorded reason | `hr.ts` | Design rule | ✅ |
| 15.17 | Somebody other than the requester approves leave | `hr.ts` | Standard control | ✅ |
| 15.18 | **Leave is counted in working days, excluding weekends. PUBLIC HOLIDAYS ARE NOT EXCLUDED** — Kenya's are partly gazetted each year and partly moveable, and no holiday calendar is loaded | `hr.ts` `workingDays` | — | 🔴 |
| 15.19 | **An employee cannot be heard before being notified.** A hearing held before the notice is not a hearing, however well minuted | `hr.ts` `recordHearing` | Employment Act 2007 | ✅ |
| 15.20 | **A dismissal without a recorded hearing is refused** — it is unfair whatever the employee did, and it is the single most expensive mistake a Kenyan employer can make at the tribunal | `hr.ts` `closeCase` | Employment Act 2007 | ✅ |
| 15.21 | Whether the employee was accompanied is recorded, because the Act gives that right and a tribunal asks | `schema.sql` `hr_cases` | Employment Act 2007 | ✅ |
| 15.22 | **No roster, no shift pattern, no overtime, no probation-period rules, no notice-period enforcement, no terminal dues calculation** | — | — | 🔴 |

### What to ask an HR adviser, in order

1. **Sick leave at half pay.** Marked red and it costs money: the Act gives
   seven days at full pay and seven at half, and only the fourteen days are
   modelled. Payroll will overpay anybody off sick for more than a week. It
   needs either a half-pay leave type or a rule in the payroll.
2. **Public holidays.** Marked red. Leave is counted in working days excluding
   weekends only, so any leave spanning a holiday charges the employee a day
   they were entitled to anyway. Kenya's holidays are partly gazetted each year,
   so this is a calendar to load rather than a rule to write.
3. **Check every entitlement against any collective agreement.** The seeded
   figures are the Employment Act minimums. A facility with unionised staff is
   almost certainly bound by better terms, and those belong in the data.

Also worth a decision: **rule 15.2 lets leave be approved with nobody
registered to cover**, on a written acknowledgement. That is deliberate — a
system that refuses is a system nobody uses — but a facility may prefer that
certain registrations (a sole pharmacist, a sole anaesthetist) block outright.
That would be a short list in configuration, and it does not exist yet.

## 16. Equipment, cold chain and estates

An asset register is usually a finance artefact. Two of the rules below are
clinical, and they are the reason this module is in this document at all.

| # | Rule | Where | Source | Status |
|---|---|---|---|---|
| 16.1 | **An overdue blocking check stops the equipment being used.** An autoclave past its pressure test is not a maintenance backlog item, it is a theatre that should not open | `assets.ts` `usable` | Design rule | ✅ |
| 16.2 | **Blocking is a property of the check, not of the asset.** A pressure test or a radiation licence blocks; a furniture inspection warns, because a chair with a late inspection is not a chair nobody may sit in | `assets.ts` `usable` | Design rule | ⚠️ |
| 16.3 | **Which checks block, and which assets are critical, are facility decisions.** The seeded set — pressure vessel test, radiation facility licence, QA survey — is a convention and not a regulation this system verified | `assets.ts` `seedAssets` | Judgement | 🔴 |
| 16.4 | **A failed check does not advance the next due date.** The work still has to be done, and a system that treats "inspected and failed" as "inspected" is worse than one that records nothing | `assets.ts` `recordMaintenance` | Design rule | ✅ |
| 16.5 | A failed blocking check takes the asset out of service and raises a critical alert | `assets.ts` `recordMaintenance` | Design rule | ✅ |
| 16.6 | **A failed check must record what was found.** That row is the most important one in the table — it is what somebody comes looking for | `assets.ts` `recordMaintenance` | Design rule | ✅ |
| 16.7 | **A cold chain excursion quarantines every batch in that fridge's store, at the moment the reading is written down.** Not a task for somebody later: a nurse must not be able to draw up a vaccine from a fridge that failed overnight | `assets.ts` `recordTemperature`, `inventory.ts` `quarantineBatch` | Design rule | ✅ |
| 16.8 | **The cold chain range is 2–8 °C**, the WHO range KEPI works to for most antigens. Some products differ, and a facility storing them needs a range per asset — which this does not yet support | `assets.ts` `COLD_CHAIN_RANGE` | WHO / KEPI | 🔴 |
| 16.9 | **Quarantine is not disposal.** The stock is unpickable, not written off: each batch is assessed against its own stability data before anything is released or destroyed, and that assessment is a pharmacist's judgement this system does not make | `inventory.ts` `releaseBatch` | Design rule | ⚠️ |
| 16.10 | Every batch in the store is quarantined, not only the vaccines — whatever was in the fridge was at that temperature | `assets.ts` `recordTemperature` | Design rule | ✅ |
| 16.11 | A fridge unread for more than 24 hours is flagged as unwatched, whatever its last reading said | `assets.ts` `coldChainBoard` | Practice | ⚠️ |
| 16.12 | **The excursion duration is not modelled.** A reading is a point in time; how long the stock was out of range between two readings is unknown, and cumulative exposure is what actually decides whether a vaccine is still viable | — | — | 🔴 |
| 16.13 | **Twice-daily reading is not enforced and no data logger is integrated.** The board says who has not read a fridge; nothing makes them | — | — | 🔴 |
| 16.14 | A reading outside −40 to 60 °C is refused as a transposed digit rather than recorded | `assets.ts` `recordTemperature` | Design rule | ✅ |
| 16.15 | **Downtime runs from when the fault was reported**, not from when somebody opened a job card — which is the number a maintenance department would rather report | `assets.ts` `openFaults` | Design rule | ✅ |
| 16.16 | A fault on a critical asset raises an alert; a fault reported as still usable warns rather than blocks | `assets.ts` `reportFault` | Design rule | ✅ |
| 16.17 | Fixing one fault does not return an asset to service while another still holds it out | `assets.ts` `closeWorkOrder` | Design rule | ✅ |
| 16.18 | **Warranty is captured at the moment the fault is reported**, from the warranty date then. Working it out afterwards is how a facility pays for a repair it was owed free — and a repair billed under warranty is surfaced on the summary | `assets.ts` `reportFault`, `assetSummary` | Design rule | ✅ |
| 16.19 | **Depreciation is straight line over the useful life**, posted idempotently into the same ledger as everything else, and the register's book value is computed on the same basis so the two cannot drift | `assets.ts` `postDepreciation`, `bookValue` | Convention | ⚠️ |
| 16.20 | **Useful lives are conventions, not policy.** 120 months for equipment, 96 for a vehicle, 84 for a fridge. A facility's own policy, and the KRA wear-and-tear classes that matter for tax, are different questions | `assets.ts` `seedAssets` | Judgement | 🔴 |
| 16.21 | Depreciation credits an accumulated depreciation contra-account rather than the asset, so the ledger keeps saying what the thing cost | `accounting.ts` `ACCOUNT` | Standard practice | ✅ |
| 16.22 | **Disposal is a status change, not an accounting entry.** Nothing computes a gain or loss on disposal, and PPADA disposal procedure for public facilities is not modelled at all | `assets.ts` `setAssetStatus` | — | 🔴 |
| 16.23 | **Nothing else in the system asks `usable()` yet.** The theatre can still book a list against an autoclave whose pressure test has lapsed; the answer exists but is not wired into theatre or radiology | — | — | 🔴 |
| 16.24 | **No calibration traceability, no spare parts, no meter readings, no planned-maintenance labour costing** | — | — | 🔴 |

### What to ask a biomedical engineer and a pharmacist, in order

1. **Which checks block** (16.2, 16.3). A biomedical engineer's list of what may
   not be used when a check is overdue, and what merely warns. Getting this
   wrong in either direction is expensive: too much blocking and the facility
   works around the system, too little and it does not do its job.
2. **The cold chain range per product** (16.8). 2–8 °C covers most KEPI
   antigens. A facility holding anything else needs a range on the asset, and
   that column does not exist yet.
3. **What happens after an excursion** (16.9, 16.12). The stock is frozen
   pending assessment, which is the safe default, but the assessment itself —
   cumulative exposure against each product's stability data — is a pharmacist's
   decision the system only records. Whether a data logger should feed this at
   all is the same conversation.
4. **Wiring `usable()` into theatre and radiology** (16.23). The rule exists and
   nothing asks it. Until it does, rule 16.1 is a screen rather than a control.

## 17. Public health

| # | Rule | Where | Source | Status |
|---|---|---|---|---|
| 17.1 | Notifiable conditions are detected from coded diagnoses as they are made, because the Act's clock runs from diagnosis | `reporting.ts` | Public Health Act | ✅ |
| 17.2 | **The notifiable list is four conditions** — malaria, tuberculosis, cholera, measles. The full schedule must be loaded | `reporting.ts` `NOTIFIABLE_PREFIXES` | — | 🔴 |
| 17.3 | Reporting one requires the county's reference — it is the proof it was made | `reporting.ts` | Design rule | ✅ |
| 17.4 | MOH 705A is under five, 705B is five and over, split by age **on the day of the visit** | `reporting.ts` | MOH forms | ✅ |
| 17.5 | A condition is counted whichever code in its ICD-11 family the clinician used | `reporting.ts` `MOH705_CONDITIONS` | Design rule | ⚠️ |
| 17.6 | **The 705 condition list is six conditions.** The real form has many more rows | `reporting.ts` | — | 🔴 |

## 18. Revenue (for the claims specialist, not the clinician)

| # | Rule | Where | Source | Status |
|---|---|---|---|---|
| 18.1 | Nine scrubber gates, each mapped to a documented SHA rejection cause | `claims.ts` `scrub` | SHA published causes | ⚠️ |
| 18.2 | **The gates are inferred from documented causes, not from 50 real rejected claims.** The roadmap says to build them from a real corpus and that is still the right next step | — | — | 🔴 |
| 18.3 | A claim beyond the payer's submission window (SHA: 7 days) escalates rather than blocking, because a late claim still has an appeal path | `claims.ts` | SHA | ⚠️ |
| 18.4 | Tariffs and benefit rules are **illustrative**. The SHA schedule for the contracting cycle must be loaded | `seed.ts` | — | 🔴 |
| 18.5 | Money is integer cents throughout, and a price is fixed as of the date of service | `billing.ts` | Design rule | ✅ |

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
25. A real chart of accounts, replacing the seventeen-account starter
26. Cost of goods sold: stock is capitalised on receipt and never relieved on
    issue, so the surplus figure overstates until issues post against it
27. VAT treatment and withholding tax on supplier payments
28. **All six payroll rate tables, checked against current law** — PAYE bands,
    personal relief, NSSF tiers, SHIF, housing levy, and the order in which the
    deductions apply
29. Whether a non-taxable allowance is exempt from NSSF, SHIF and the housing
    levy as well as from PAYE
30. NITA levy, leave accrual, gratuity, overtime and casual-worker treatment,
    none of which the payroll handles
31. Sick leave at half pay — the Act's second seven days are not modelled, so
    payroll overpays a long sickness
32. A Kenyan public-holiday calendar, so leave spanning one does not charge the
    employee a day they were entitled to anyway
33. Whether certain sole registrations should block leave outright rather than
    being approved on an acknowledgement
34. A biomedical engineer's list of which maintenance checks block use, and
    which assets are critical
35. The cold chain range per product, and what a pharmacist does with stock
    after an excursion — cumulative exposure is not modelled and a point
    reading is not a duration
36. `usable()` wired into theatre and radiology, so an overdue pressure test
    stops a list rather than merely showing on a screen
37. Useful lives and a disposal policy, including the KRA wear-and-tear classes
    and, for a public facility, PPADA disposal procedure
