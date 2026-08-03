# 4. Workflows

The software has to fit the farm's day, not the other way round. This document
describes the rhythm the system must slot into, and the exact flow through each
screen.

---

## 4.1 The daily rhythm

```
05:00  MORNING MILKING            Herdsman    → M3 milk entry (bulk, ~3 min)
                                              → M2 heat observations noted
06:30  FEED ISSUE                 Feeder      → M5 issue feed to groups (~1 min)
07:00  ROUTINE HEALTH             Herdsman    → M6 spray/dip if due, batch action
08:00  MILK DISPATCH              Manager     → M4 delivery to co-op, quality result
                                              → receipt: litres + KES value
09:00  MANAGER ROUND              Manager     → M11 today's action list
                                              → M6 treatments, M2 services, PD
                                              → approve pending staff entries
12:00  (NOON MILKING if 3×)       Herdsman    → M3
16:30  EVENING MILKING            Herdsman    → M3 milk entry
17:30  FEED ISSUE                 Feeder      → M5
18:00  DAILY CLOSE                Manager     → M4 reconcile: produced vs disposed
                                              → print/sign the daily sheet
18:30  OWNER DIGEST               (automatic) → M11 one SMS: litres, value, MTD
```

**Total staff data-entry time target: under 12 minutes per day across all
roles.** Anything above that decays into fabricated data. The milk round alone
must stay under three minutes for the whole herd.

---

## 4.2 The milk entry flow — the one that must be perfect

This screen runs twice a day, every day, forever. If it is wrong, nothing else
matters.

```
┌─ Person picker ──────────────────────────────────────┐
│  Who is milking?   [ photo ] [ photo ] [ photo ]     │
│                     Kamau     Wanjiru    Otieno      │
│  → 4-digit PIN                                        │
└───────────────────────────────────────────────────────┘
                        ↓  (2 taps, ~3 seconds)
┌─ Home: flat grid of task tiles ──────────────────────┐
│   🥛 MILK      🌾 FEED      💉 HEALTH     ♥ HEAT      │
└───────────────────────────────────────────────────────┘
                        ↓  (1 tap)
┌─ Morning milking — Mon 3 Aug ────────── ✓ 3 waiting ─┐
│                                                       │
│  Njeri      [ 12.5 ] L   same as yesterday      ✓    │
│  Wanjiku    [ 15.0 ] L   same as yesterday      ✓    │
│  Muthoni    ⛔ WITHHELD — treated, clear Thu 7 Aug   │
│  Nyambura   [  8.0 ] L   ⚠ down 30% for 3 days      │
│  Chepkoech  [ 11.0 ] L   same as yesterday      ✓    │
│  Akinyi     🍼 COLOSTRUM — day 2, not for sale      │
│                                                       │
│  Total so far: 46.5 L                    [ SAVE ]    │
└───────────────────────────────────────────────────────┘
                        ↓
┌─ Receipt (persistent, re-viewable, offline) ─────────┐
│  ✓ Morning milking recorded                          │
│    5 cows · 46.5 L · Mon 3 Aug 6:12am · by Kamau    │
│    Ref MK4T9                                         │
│                                                       │
│  ⚠ Nyambura down 30% for 3 days — tell the manager   │
│  ✓ Saved on phone. Will send when there's network.   │
└───────────────────────────────────────────────────────┘
```

**What is happening in that screen, and why:**

| Element | Rationale |
| ------- | --------- |
| Prefilled last value, greyed, labelled | Defaults cut manual entry errors from 1–3% to near zero. Labelling them stops the user accepting a wrong default blindly |
| Tick to accept, edit exceptions only | Bulk entry is the only pattern that survives twice-daily use across a whole herd |
| `WITHHELD` row is **locked**, not just flagged | The one hard block in the system. A rejected bulk load can exceed a month's profit |
| Colostrum auto-detected from days in milk | The herdsman should not have to remember; the system knows the calving date |
| Yield-drop warning is inline, at entry | R7 — value comes back at the moment of entry, not next month |
| The out-of-range value **saves flagged** | Warn, never block. Rigid validation produces fabricated data, not complete data |
| Running total visible | Immediate feedback that the work is landing |
| Reference code on the receipt | The M-Pesa pattern — the herdsman can show the manager what he entered three hours ago, offline |
| Sync chip in the header | "Saved on phone (3 waiting)" / "Sending…" / "All sent". Never a spinner that can hang |

**Three fields: cow, session, litres.** Butterfat, weight and notes live behind an
optional "Add more" that never blocks the save.

---

## 4.3 The breeding chain — the flow that pays for the system

This is where one entry generates months of value, and it is the flow to
demonstrate when selling the system.

```
  ♥ HEAT OBSERVED                                       Herdsman, 5 seconds
  │   pick cow → tap "on heat" → done
  │   ↓ system responds immediately:
  │   "Njeri on heat, seen this morning → inseminate this evening"
  │   (the AM/PM rule, applied for the user)
  ↓
  💉 SERVICE                                            Manager or AI tech
  │   cow · date · AI or bull · straw code · inseminator · cost
  │   ↓ system generates and SHOWS the whole calendar:
  │      • Return-to-heat watch:   24 Aug   (+21 d)
  │      • Pregnancy check due:     2 Oct   (+60 d)
  │      • Expected calving:       12 May 2027  (+283 d, breed-adjusted)
  │      • Dry off:                13 Mar   (EDD − 60 d)
  │      • Steaming up starts:     13 Mar
  ↓
  ⏱ DAY 21 — RETURN-TO-HEAT WATCH                       automatic alert
  │   ├─ no return  → continue to PD
  │   └─ returns to heat → record repeat service, and the system INTERPRETS:
  │         18–24 d → normal return, one cycle missed
  │          3–17 d → wrong timing or early embryonic loss
  │           ~42 d → ⚠ A MISSED HEAT — a detection failure, not a fertility one
  ↓
  🩺 DAY 60 — PREGNANCY DIAGNOSIS                        vet or para-vet
  │   rectal palpation (the Kenyan default) · result · months pregnant
  │   ├─ POSITIVE → class becomes IN-CALF, EDD confirmed
  │   └─ NEGATIVE → back to BULLING, alert the manager
  ↓
  🌾 EDD − 60 d — DRY OFF + STEAMING UP                  alert
  │   stop milking (abrupt), dry cow therapy in all four quarters
  │   ⛔ dry cow therapy sets a withdrawal: no sale until ≥30 d after infusion
  │      AND ≥96 h after calving, whichever is later
  │   extra concentrate 2–3 kg/day begins
  ↓
  🐄 CALVING                                             herdsman + manager
  │   date · ease score 1–5 · calf sex · birth weight · live/stillborn
  │   · retained placenta? (flag if not passed within 6–12 h) · milk fever?
  │   ↓ system does three things at once:
  │      1. creates the CALF record + its whole first-year schedule
  │      2. starts the dam's new lactation, days in milk = 0
  │      3. flags days 0–4 as COLOSTRUM, not saleable
  │      4. computes and displays: calving interval, days open,
  │         services per conception — with the KES cost of any overrun
  ↓
  ⏱ DAY 40–60 — VOLUNTARY WAITING PERIOD ENDS
      cow becomes eligible for service. Back to the top.
```

**If an abortion is recorded at any point**, the system does not simply file it.
It opens the brucellosis workflow: isolate the dam, handle membranes with gloves,
do not feed them to dogs, test the dam. Brucellosis is endemic in Kenya, zoonotic
and notifiable — this is a human-health prompt, not a record.

---

## 4.4 The health and withdrawal flow

```
  🔍 OBSERVATION                                        Herdsman
  │   "Njeri not eating" / "swollen quarter" / "limping"
  │   → recorded as an observation, flagged to the manager. No diagnosis required
  ↓
  📞 MANAGER DECIDES
  │   ├─ routine, treat on farm (dewormer, spray)  → staff records it
  │   └─ call the vet or para-vet                  → visit scheduled
  ↓
  💊 TREATMENT RECORDED                                 Manager or vet
  │   animal · date · signs · diagnosis · PRODUCT (from the product master)
  │   · active ingredient · batch · dose · route · duration · treated by · cost
  │
  │   ⚠ The withdrawal period comes from the PRODUCT, not a hard-coded drug list.
  │      The legally operative number is on the PCPB-approved label.
  ↓
  ⛔ THE BLOCK ENGAGES — automatically, immediately
  │   milk_clear_at = treatment_end + milk_withdrawal_days
  │   meat_clear_at = treatment_end + meat_withdrawal_days
  │
  │   • Tomorrow's milking sheet shows that row LOCKED
  │   • Milk auto-dispositions to WITHHELD_TREATMENT
  │   • Sale-for-slaughter blocked until the meat period clears
  │   • Litres discarded accumulate as a reported KPI
  ↓
  📱 RECEIPT, IN PLAIN LANGUAGE
  │   "Do not sell Njeri's milk until Thursday 7 August.
  │    Do not sell her for slaughter until 31 August."
  ↓
  ✓ CLEAR DATE ARRIVES                                  automatic alert
      "Njeri's milk is clear from today." Row unlocks.
```

**Routine batch actions** bypass this whole flow, because they must be fast:
select a group (or the whole herd), pick the product, one confirm. Weekly tick
spraying across 60 animals is one action, not sixty.

---

## 4.5 The feed and margin flow

```
  🛒 PURCHASE                                           Manager
  │   supplier · feed · quantity · UNIT · UNIT WEIGHT · price · payment method
  │   ↓ never a bag or bale without its weight — this is where cost accuracy
  │     is won or lost
  ↓
  📦 STORE BALANCE UPDATES
  │   opening + received − issued = closing, per feed, per period
  ↓
  🌾 DAILY ISSUE                                        Feeder
  │   group (lactating / dry / heifers / calves) · feed · quantity
  │   ↓ prefilled from yesterday. Two taps for an unchanged day
  ↓
  📊 THE NUMBER COMES BACK, EVERY DAY
  │   "Dairy meal: 8 bags left. 6 days of cover. Order by Friday."
  │
  │   "MARGIN OVER FEED COST: KES 14.20 per litre"
  │     milk revenue     KES 48.00/L
  │     feed cost        KES 33.80/L
  │
  │   This is the single most useful management number in dairy, and
  │   almost no competitor computes it.
  ↓
  🏆 MONTHLY — THE COW LEAGUE TABLE
      every cow ranked by margin, loss-makers named, action recommended
      "Nyambura: 6 L/day, feed cost KES 41/L, milk value KES 45/L.
       She is making KES 4/L. Consider culling."
```

---

## 4.6 The month-end money flow

```
  📄 CO-OP STATEMENT ARRIVES                            Manager
  │   enter (or import) what the co-op says:
  │   litres recorded · rate · quality bonus · every deduction · net pay
  ↓
  🔍 RECONCILIATION — the differentiating screen
  │
  │   Farm recorded:   4,820 L        Co-op recorded:   4,795 L
  │   ⚠ Variance:        25 L  (KES 1,300)  ← investigate
  │
  │   Deductions the co-op applied:
  │     AI services        KES  6,000   ✓ matches 2 services on record
  │     Feeds (check-off)  KES 42,000   ✓ matches 12 bags
  │     Vet                KES  8,500   ⚠ no matching vet visit on record
  │     SACCO loan         KES 15,000   ✓
  │     Transport levy     KES  2,400   ✓
  │     County cess        KES  1,247   ✓ 0.5% of gross
  │
  │   "Why is my cheque smaller than I expected" — answered, line by line.
  ↓
  💰 M-PESA RECONCILE                                   Manager, daily
  │   import the M-Pesa CSV statement → match against recorded transactions
  │   unmatched entries surface immediately
  │   ↓ do this every evening, while errors are still fixable
  ↓
  📊 MONTH CLOSE
      cost per litre (cash and full economic) · margin over feed cost ·
      gross margin per cow · revenue by channel · the one-sentence summary
```

---

## 4.7 The approval and trust flow

Segregation of duties, made visible. SME theft in Kenya concentrates precisely
where one person controls an entire transaction process.

```
  HERDSMAN records          →   MANAGER approves        →   OWNER views
  ────────────────────          ──────────────────          ────────────
  milk, feed, heat,             a single scrollable          reports only
  observations,                 list, swipe to approve       no entry burden
  routine treatments            flagged/out-of-range         SMS digest daily
                                items surface here

  Money entries by staff enter PENDING and do not affect any report until
  a manager approves them.

  Every record permanently shows who entered it and who approved it.
```

**Framing matters as much as mechanism.** If herdsmen believe the app exists to
catch them, they will produce compliant, false data. The receipt is theirs — it
is proof they delivered the milk, and proof they were paid.

---

## 4.8 The seasonal and periodic rhythm

| Cadence | What happens | Modules |
| ------- | ------------ | ------- |
| **Twice daily** | Milk entry, feed issue | M3, M5 |
| **Daily** | Milk disposal and reconciliation, action list, owner digest, M-Pesa reconcile | M4, M11, M9 |
| **Weekly** | Tick spraying/dipping (ECF areas), feed stock check and ordering, review flagged entries | M6, M5 |
| **Fortnightly** | Heat detection review — are we catching 70% of heats? | M2, M10 |
| **Monthly** | Payroll and statutory remittance (due the 9th), co-op statement reconciliation, CMT screening across the lactating herd, body condition scoring, weigh growing stock, cow league table, month close | M8, M4, M6, M1, M10 |
| **Quarterly** | Deworming, cost of production review, cull decisions | M6, M10, M7 |
| **Every 6 months** | FMD vaccination, hoof trimming | M6 |
| **Annually** | LSD, anthrax, blackquarter vaccination; brucellosis testing; KDB permit and county business permit renewal; insurance valuation | M6, M9 |
| **Once per animal** | S19 brucellosis (females, 4–8 months), ECF-ITM Muguga cocktail | M6 |
| **Per lactation** | Dry off, steaming up, calving, colostrum, 305-day lactation close | M2, M3 |

---

## 4.9 The offline flow

Every write follows the same path, and it never waits for the network.

```
  User taps SAVE
        ↓
  Client generates a UUID for the row
        ↓
  Write to IndexedDB immediately          ← the save is DONE here
        ↓
  Receipt shown, marked "saved on phone"
        ↓
  Outbox queue holds it
        ↓
  Background flusher drains when online
        ↓
  Server: INSERT … ON CONFLICT (id) DO NOTHING
        ↓
  Sync chip updates: "All sent"
```

**Client-generated UUIDs plus `ON CONFLICT DO NOTHING` is the whole trick.** A
double-flush over a flaky link is harmless, which removes roughly 90% of the
complexity of offline sync. See
[06-architecture.md §offline](06-architecture.md#offline) for the full design.

**Domain modelling supports this:** milk records, feed issues and health events
are **append-only**. Append-only plus client UUIDs makes conflicts structurally
impossible for the 95% of writes that matter. Edits and deletes are reserved for
online-only manager screens.

---

## 4.10 Onboarding a new farm

The rollout is part of the product. *"The technology itself will only get us so
far"* — Mercy Corps, after 16 million smallholders.

| Day | Step |
| --- | ---- |
| **1** | Farm created. Owner account. Set milking sessions per day, co-op/processor, milk price, currency |
| **1** | **Import the herd.** Spreadsheet or guided entry. Name, tag, breed, DOB, current class, last calving date, days in milk. This is the only heavy data-entry day in the system's life |
| **2** | Staff added with photos and PINs. Roles assigned. Phones set up with the PWA installed to the home screen |
| **2** | Feed store opening balances. Supplier list. Product master for drugs, with withdrawal periods from the labels |
| **3–7** | **Milk entry only.** Nothing else. Get the twice-daily rhythm established before adding anything |
| **Week 2** | Add feed issues and health observations |
| **Week 3** | Add breeding events. The first generated calving calendar is the moment the system sells itself |
| **Week 4** | First payroll run. First month-end close. First cow league table |
| **Ongoing** | A named trainer on-farm for the first weeks, and one designated champion among the staff |

**The metric we watch is records entered per active user per week — never
registrations.** DigiFarm had 1,038,817 registered farmers and 30% active. One
Kenyan agritech claiming a million farmers had 3% who ever transacted.
