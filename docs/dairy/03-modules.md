# 3. Modules

Twelve modules. Each is independently shippable, has one owner role, and returns
something to the person entering the data. Every module maps back to a line in
the client's brief — the mapping table is at the end.

**Universal rules that apply to every module** (evidence in
[01-findings.md §1.5](01-findings.md#15-the-framing-correction-that-shapes-everything)):

| # | Rule |
| - | ---- |
| R1 | **≤5 fields** on any routine entry screen; **≤2–3** may block save |
| R2 | **≤10 seconds per animal, ≤3 taps** for daily capture |
| R3 | **Saving never touches the network.** Offline is the default path, not the fallback |
| R4 | **Warn, never block** — except antibiotic withdrawal, which blocks |
| R5 | **Prefill from last known value, labelled as such** — except money, drug doses and withdrawal periods, which always start empty |
| R6 | **Every save returns a persistent, re-viewable receipt** with a reference code |
| R7 | **Something useful comes back at the moment of entry**, not in next month's report |
| R8 | **Max 2 levels of navigation.** No hamburger menu. Home is a flat grid of task tiles |
| R9 | **Every screen works with the text ignored** — figurative icon + colour + position carry the meaning |
| R10 | **Herdsmen record, manager approves, owner views.** Provenance is permanent and visible |

---

## M0 — Foundation

*Not a user-facing module, but everything depends on it.*

**Contains:** farm (tenant) records, users, roles and permissions, the PIN-based
person picker, the offline sync engine and outbox, the receipt/reference-code
generator, the audit trail, language toggle, and the units/reference-data tables
(feed units, breeds, gestation constants, wage rates, withdrawal periods).

**Roles:**

| Role | Can do |
| ---- | ------ |
| `OWNER` | Everything. Sees all money. Cannot be deleted |
| `MANAGER` | All records, approves staff entries, runs payroll, sees reports |
| `HERDSMAN` | Records milk, feed, heat, health observations. Sees today's entries and their own receipts. **No money screens** |
| `VET` (external, optional) | Read animal health history, add treatments, on invitation only |
| `ACCOUNTANT` (optional) | Read-only financial exports |

**Login is a person picker plus a 4-digit PIN**, auto-returning to the picker
after each save or ~60 seconds idle. Never email/password, never a silently
persisted session. Rationale: only **53.7% of Kenyans personally own a handset**
and 11.3% use a phone they don't own — one phone must comfortably serve four
herdsmen, and "login restrictions" are a named killer of African field
deployments.

**Reference data is per-farm and versioned with effective dates** — wage rates,
milk prices and feed prices all change, and historical records must keep the rate
that applied at the time.

---

## M1 — Herd & Animals

**Who uses it:** manager (registration), everyone (lookup).

**Does:** the animal register and the derived lifecycle. Every animal from calf
to cull, with ID, name (Kenyan farmers name their cows — support it), breed
composition, DOB, sire and dam, origin, photo, KLBA registration, current class,
parity, reproductive status, weights and body condition over time.

**The core design decision:** class is **derived from events**, never typed. See
the state machine in [02-domain-model.md §2.1](02-domain-model.md#the-class-is-derived-never-typed).
A manual override exists only for bought-in animals with unknown history.

**Gives back at entry:** on registering a calf, the app immediately generates its
whole first-year schedule — colostrum window, disbudding at 2–8 weeks, deworming,
the S19 brucellosis window (females, 4–8 months, once for life), ECF-ITM, and the
weaning target. One registration in, a year of reminders out.

**Screens:** herd list (filter by class, searchable by name or tag) · animal
detail (the digital cow card) · add animal · weigh/BCS quick entry · herd
inventory reconciliation.

**Deliverable that earns its keep:** the **animal passport PDF** — one page per
animal covering ID, breed, parentage, calving history, lactation yields,
vaccinations and treatments. It serves insurance valuation, credit applications
and sale negotiations, and it is the reason a farm will bother keeping the
register clean.

---

## M2 — Breeding & Reproduction

**Who uses it:** herdsman (heat observation), manager (service, PD), vet.

**Does:** the full chain — heat observed → service (AI or bull) → return-to-heat
watch → pregnancy diagnosis → expected calving date → steaming up → dry off →
calving → back to heat. Plus repeat services, abortions, stillbirths and calving
difficulty.

**Gives back at entry — this is the module that proves the system's worth:**

The moment a service is recorded, the app shows the calendar it just generated:

> ✓ **Njeri served — 3 Aug, AI, straw KG-4471**
> Watch for return to heat: **24 Aug** (21 days)
> Pregnancy check due: **2 Oct** (60 days)
> Expected calving: **12 May 2027**
> I'll remind you to dry her off on **13 Mar**

This is the iCow bargain, which produced a measured **+13% milk production per
cow and +29% milk income** in a Kenyan impact evaluation: one date in, a
calendar of alerts protecting a KES 150,000+ animal out.

**Interpretation, not just storage.** A return to heat is diagnosed, not merely
recorded — 18–24 days is a normal return, 3–17 days suggests wrong timing or
early embryonic loss, and ~42 days means **a missed heat**, which is a detection
failure the manager can fix. Heat detection rate below 50% is the single biggest
reproductive loss on Kenyan farms.

**Abortion triggers a brucellosis workflow** — isolate the dam, gloves, do not
feed membranes to dogs, test. Brucellosis is endemic, zoonotic and notifiable.

**Screens:** today's breeding actions (the watchboard) · record heat · record
service · record PD · record calving · cow breeding history.

> The Herdwatch watchboard bug — repeat-served cows getting stuck on the board
> forever — is a specific thing to test against. Every alert must clear on an
> outcome.

---

## M3 — Milk Production

**Who uses it:** herdsman, twice a day, every day. **This is the highest-volume
screen in the system and everything else is negotiable before this is.**

**Does:** yield per cow per session (`MORNING`/`NOON`/`EVENING`), with the number
of sessions per day configurable per farm.

**The entry screen is the whole product.** A single scrolling list of the
lactating herd, each row prefilled with that cow's last recorded value in grey
and labelled *"12.5 L — same as yesterday"*, requiring one tap to accept. Tick to
accept, edit only the exceptions. Three fields total: cow, session, litres.
Everything else — butterfat, weight, notes — sits behind an optional "Add more"
that never blocks the save.

**Automatic behaviour:**

- Days in milk 0–4 → **colostrum, auto-flagged `NOT_SALEABLE`**
- Animal under antibiotic withdrawal → **row locked to `WITHHELD_TREATMENT`**,
  with the clear date shown. This is the one hard block in the system
- A value far off the cow's norm → soft, dismissible warning, and the record
  **saves flagged** for the manager's review queue. It is never rejected

**Gives back at entry:** the running herd total for the session as you go, and an
immediate flag when a cow drops — *"Njeri down 30% for 3 days — check her."* A
sustained drop is the earliest cheap signal of mastitis, heat, or illness.

**Computes:** days in milk, peak yield and days to peak, cumulative lactation
yield, projected 305-day yield, persistency, litres per cow per day.

**Screens:** today's milk sheet (bulk entry) · single-cow quick entry · lactation
curve · monthly milk sheet (printable, matching the paper layout Kenyan farms
already use).

---

## M4 — Milk Sales & Disposal

**Who uses it:** manager and route rider; owner reviews.

**Does:** where every litre went, and who owes what for it.

### The three sales channels

The client sells through co-operatives, institutions and individual households.
These are not variations on "direct sale" — they are three different businesses
with different paperwork, different money, and different failure modes. The
module models each properly.

| | **Co-operative / processor** | **Institution** | **Household** |
| - | --- | --- | --- |
| Who | Co-op, CBE, Brookside, New KCC, Githunguri, Meru, Daima | Schools, hospitals, hotels, restaurants, colleges | Neighbours, doorstep customers |
| Volume | The bulk of production, one drop | 20–200 L, scheduled | 1–3 L each, many customers |
| Price | Lowest — the floor price | Middle, contracted | **Highest** |
| Paperwork | Member number, delivery note | **Delivery note per drop + invoice on terms**, often an LPO | A tab in an exercise book |
| Payment | **Monthly, less check-off deductions** | **Credit terms** — 30/60 days | **Running tab, settled weekly or monthly** |
| Quality testing | At reception, drives price | On acceptance | None |
| Main risk | Rejection at reception; opaque deductions | **Slow payment; holiday seasonality** | **Bad debt; volume disputes** |
| Upside | Guaranteed offtake, check-off credit access | Steady contracted volume | Best margin per litre |

**Each channel gets what it actually needs:**

- **Co-operative** — member number on every delivery, quality result per drop, the
  month-end statement reconciliation described below, and a **late-payment
  interest calculator**: under LN 20/2021 buyers must pay after the end of the
  month of supply, and late payment attracts simple monthly interest at the CBK
  base rate. Most farmers never claim it because nobody computes it. New KCC once
  failed to pay KES 300m in arrears, so **track co-op and processor payment
  performance exactly as for institutions** — counterparty risk runs both ways.
- **Institution** — a **delivery note per drop with a counter-signature**, an
  invoice covering the period with an **eTIMS reference field**, payment terms
  with a due date, **LPO number, value and expiry** as a first-class object (a
  farm holding a school LPO can borrow against it), and **arrears aging in
  0–30 / 31–60 / 61–90 / 90+ buckets**. School customers pause over holidays
  rather than being deleted, so the standing order carries a
  `paused_from`/`paused_to` window and the volume forecast doesn't collapse every
  December.
  **Public institutions**: worth flagging **AGPO** to the client — 30% of all
  public procurement is reserved for enterprises at least 70% owned and managed
  by youth, women or persons with disabilities, and it binds all 47 counties. If
  the farm's ownership qualifies, that is a real edge on county school tenders,
  and it needs a valid KRA Tax Compliance Certificate.
- **Household** — a **standing order** ("Mama Njeri, 2 L every morning"), a
  running ledger, and a settlement day. The delivery sheet is generated from the
  standing orders, prefilled, and the rider edits only the exceptions — the same
  two-tap pattern as the milk sheet.

### ⚠ Correction: household payment behaviour is an open question, not a fact

An earlier draft of this document asserted that Kenyan households buy on a
running tab settled at month end. **No source supports that.** Targeted research
found no published description of the exercise-book credit convention, no figure
for typical household daily volume, and no bad-debt rate — nobody appears to have
published on farm-to-neighbour milk credit at all. The substantial study in this
space covers *peri-urban informal milk vendors*, not commercial farms selling to
neighbours.

Worse for the assumption: one sourced finding **cuts against it** — in the
informal chain, payment for milk delivered is reported as **prompt, often daily
or weekly**, unlike formal trade.

What *is* sourced is that credit selling is structurally normal in the trade, and
that **"with few strategies to recoup costs from customers who fail to repay,
failure to collect debt may cause default."** The risk is real; its size is
unmeasured.

**So the design is deliberately permissive rather than opinionated:** support
cash-on-delivery *and* a running tab, farm-collection *and* delivery, and an
arbitrary settlement day per customer. Let real usage reveal the distribution.
Ten interviews with the client's own customers will beat every published source
on this question — see [08-open-questions.md](08-open-questions.md).

### The receivables problem, where it does apply

Wherever credit *is* extended, direct sales carry the best price and the worst
risk, and the traditional control — an exercise book at the farm — cannot tell
you who is drifting until the money is already gone. This is unambiguously true
of institutions, where it is not a judgement call at all:

> Public-sector payment delays run **30 to 90 days, "and in many cases
> significantly longer."** Kenyan public pending bills reached **KES 465.87
> billion as of March 2026**. In one survey **over 68% of Kenyan SMEs had turned
> down or delayed a confirmed supply contract** for lack of upfront capital.

**An institutional delivery therefore creates a receivable, not revenue.** If the
schema conflates the two, the farm's cash position is systematically overstated by
30–90 days of sales. This is the single most expensive thing to get wrong here and
the hardest to retrofit.

So the module carries a proper **customer ledger**: every delivery is a debit,
every payment a credit, with a running balance, days since last payment, and
**debtor aging in current / 30 / 60 / 90+ buckets**. A **credit limit per
customer** warns the rider *before* the next delivery rather than after the
default. Payments recorded by staff sit `PENDING` until the manager approves,
because this is the point in a Kenyan farm where cash most often goes missing.

**Gives back at entry:** the rider finishes the round and sees the day's takings
split into cash collected versus credit extended, plus a named list of anyone
over their limit.

### Everything else the milk goes to

Home consumption, calf feeding, staff ration, spoilage, rejection at reception,
and treatment withholding — all valued at market price even where no money
changes hands, so the owner can see the true cost of "free" milk.

**The reconciliation constraint:** `Σ(session yields) = Σ(disposals)`. The
difference is surfaced, not hidden — unexplained shrinkage between parlour and
can is the classic milk-theft signal, and the farm will want to see it daily.

**Quality capture per delivery:** butterfat, protein, SNF, lactometer, alcohol
test result, accepted/rejected + reason. Kenya launched a **Quality-Based Milk
Payment System in January 2026**, so deliveries must support quality-adjusted
pricing, not litres × a flat rate.

**The differentiating feature — co-op statement reconciliation.** At month end
the farm enters (or imports) the co-operative's statement: litres the co-op
recorded, rate applied, quality bonus, every check-off deduction (AI, feeds, vet,
advances, SACCO, transport levy, membership, county cess ≤0.5%), and net pay. The
app then shows, line by line, **where the co-op's numbers differ from the farm's
own delivery records**.

"Why is my cheque smaller than I expected" is the number one dairy co-op
grievance in Kenya, and no competitor answers it.

**Gives back at entry:** value of today's milk in KES, immediately, split by
channel — and the **blended price per litre across all channels**, which is the
number that tells the owner whether the channel mix is right. Selling everything
to the co-op is safe and cheap; selling everything direct is lucrative and risky.
The blended price plus the bad-debt figure is how that trade-off gets managed
instead of guessed.

**Screens:** delivery round (generated from standing orders) · record co-op
delivery · customer list with balances · customer ledger · record payment ·
debtor aging · invoices · daily disposal summary · co-op statement entry ·
reconciliation view.

---

## M5 — Feed & Inventory

**Who uses it:** feeder/herdsman (issues), manager (purchases).

**Does:** feed purchases, store balances, issues to animal groups, and the fodder
the farm grows itself. Three categories as the client specified, correctly
populated for Kenya: **fodder** (Napier, Boma Rhodes, lucerne, desmodium, maize
silage, hay, sweet potato vines, brachiaria, fodder trees, crop residues),
**concentrates** (dairy meal, maize germ, wheat bran, pollard, cotton seed cake,
sunflower cake, soya, fishmeal, molasses, calf pellets, dairy cubes, growers'
meal), and **minerals/salts** (Maclik Super and equivalents, high-phosphorus,
high-calcium, salt licks). Plus **water**, which most systems forget and which is
one of the cheapest fixes for low yield.

**The unit trap, handled properly:** never store a bale or a bag without its
weight. A Kenyan hay bale ranges 12–25 kg and a round bale 300–500 kg; dairy meal
comes in 70 kg *and* 50 kg bags at very different prices. Every stock line
carries `quantity`, `unit`, and `unit_weight_kg`. Informal units — headload,
wheelbarrow, pickup load — are supported with a farm-set conversion factor,
because that is how fresh Napier is actually measured.

**Flow:** `purchase → store → issue to ration → consumption`, with opening
balance, purchases, issues and closing balance per feed per period, and a derived
**cost per kg of dry matter**.

**Feeding records** are per group by default (lactating / dry / heifers / calves)
with per-animal capture available for high-value animals or where the farm wants
it. Per-animal feeding of every cow every day is a burden most farms will not
sustain; the system supports it but defaults to groups.

**Feeding guidance built in:** the challenge-feeding rule — *1 kg dairy meal per
extra 1.5 L of milk above 8 litres* — as a **configurable rule with a default**,
because farmers also quote 1 kg per 2 L and 1 kg per 3 L. Plus the 70:30
forage:concentrate ratio, the ≤4 kg-per-feed acidosis guard, steaming-up rates,
and Maclik's 200 g + 60 g per extra 5 kg of milk.

**Gives back at entry:** stock remaining and **days of cover left** — *"Dairy
meal: 8 bags, 6 days left at current rate. Order by Friday."* And the number that
matters most in the whole system, updated daily:

> **Margin over feed cost: KES 14.20 per litre** (milk revenue KES 48.00 − feed
> cost KES 33.80)

**Screens:** feed store · record purchase · issue feed · fodder production ·
ration guidance · days-of-cover dashboard.

---

## M6 — Health & Veterinary

**Who uses it:** herdsman (observations, routine treatments), manager, vet.

**Does:** clinical treatments, routine schedules (deworming every 3 months,
tick control weekly in ECF areas, hoof trimming, disbudding at 2–8 weeks),
vaccinations against the Kenyan calendar, CMT mastitis screening, and body
condition.

**The withdrawal-period engine is the highest-value feature in the system.**
On recording a treatment the app computes `milk_clear_at` and `meat_clear_at`
from the **product's own label period**, then:

- **Hard-blocks** that cow's milk from co-op, processor and direct sale until
  clear, forcing disposal to `WITHHELD_TREATMENT`
- Puts a persistent flag on the animal **and on tomorrow's milking sheet**
- Blocks sale-for-slaughter until the meat period clears
- Tracks litres discarded as a reported KPI

The stakes: **15–19% of Kenyan milk samples test positive for antibiotic
residues**, and one farmer's residual milk can cause a whole chilling-plant load
to be rejected — a cost co-ops pass back to the offending member. This is the one
place where blocking beats warning.

Withdrawal periods are **stored per product**, entered by the user or held in a
product master — never derived from a hard-coded drug list, because the legally
operative number is the one on the PCPB-approved label.

**Vaccination schedules with real validation:** the S19 brucellosis window
(females only, 4–8 months, once for life) and ECF-ITM (once for life, and
vaccinated animals become carriers) both need hard rules, not reminders.

**Costs attributed** to cash, credit or **co-op check-off**, with the service
provider typed (`FARM_STAFF` / `AI_TECH` / `PARAVET` / `VET` / `COOP_VET` /
`COUNTY`) and a KVB registration number where applicable.

**Gives back at entry:** the clear dates, stated plainly — *"Do not sell Njeri's
milk until Thursday 7 Aug"* — and the next-due date for any routine.

**Screens:** treat animal · routine batch (dip/spray/deworm the whole herd in one
action) · vaccination schedule · CMT screening · health history · withdrawal
board (who is currently withheld).

> Batch actions are first-class here. Herdwatch's most-cited complaint is that
> weight-band batching for drug dosing is slow and you cannot apply multiple
> drugs to one animal at once. We do both.

---

## M7 — Animal Trading

**Who uses it:** owner, manager.

**Does:** buying and selling livestock — the client's "selling dairy animals,
in-calf, in-calf heifers, milkers, bulling heifers and calves."

**Sale records** capture what actually drives Kenyan price: class at sale,
**months pregnant** (a 7-month in-calf heifer commands a large premium), **current
daily yield in litres** (milking cows are literally priced per litre), weight for
beef sales, breed and grade, counterparty and counterparty type (farmer, broker,
co-op, butchery, KMC), and payment method.

**Purchases** create the animal record with an unknown-history flag and a manual
class override.

**Gives back at entry:** for a sale, the animal's **lifetime contribution** —
total litres produced, calves born, total feed and vet cost, and the resulting
profit or loss on that animal. For a purchase, a reminder that price is best
justified by records, with the animal passport ready to request from the seller.

**The cull list** is the sharp end of this module: the herd ranked by margin,
with the loss-makers named. *"Most dairies have 10–15% of their herd losing
money"* — a 6 L/day cow at KES 45/L is usually loss-making in a zero-graze unit,
and her stall is worth more to a 15 L cow.

---

## M8 — People & Payroll

**Who uses it:** manager, owner.

**Does:** employee records, attendance, wages and Kenyan statutory deductions.

**Roles modelled:** farm manager, herdsman/stockman, feeder, calf attendant,
casual (*kibarua*), watchman, driver, farm clerk.

**Payroll computes** PAYE (with the KES 2,400 personal relief), NSSF Tier I and
II against the February 2026 limits (LEL 9,000, UEL 108,000), SHIF/SHA at 2.75%
of gross with a KES 300 minimum and no cap, and the Affordable Housing Levy at
1.5%. **The zero-PAYE case is the common case** — a herdsman on KES 12,000 owes
no PAYE but owes all three of the others, and payroll must get that right.

**The casual-conversion warning is a genuine compliance feature:** under the
Employment Act 2007 a casual working continuously for more than one month
converts by operation of law into a term employee with full benefits. The system
warns as that threshold approaches — most farms discover this at a tribunal.

**Statutory minimums are shown as a compliance reference, not assumed.** Actual
dairy wages are frequently below the gazetted rate; the app shows the farm where
it stands rather than refusing to record reality.

**Payments** record method (cash, M-Pesa, bank) with the M-Pesa confirmation
code. **Money entries by staff enter a `pending` state until the manager
approves** — segregation of duties, because SME theft in Kenya concentrates
exactly where one person controls a whole transaction.

**Also handles:** onboarding (contract type, start date, ID, NSSF/KRA PIN,
next of kin), leave accrual at 1.75 days/month toward 21 days a year, sick leave
entitlement, advances and their recovery, and the staff milk ration as a cost in
kind.

---

## M9 — Money: Expenses, Income & Suppliers

**Who uses it:** manager, owner.

**Does:** the farm cash book, the chart of accounts, suppliers, and the monthly
bills the client listed.

**Categories:** feeds & fodder · labour · veterinary & health · breeding ·
milk marketing (transport, co-op levy, county cess) · utilities (electricity for
chiller, chaff cutter, milking machine and pump; water including dry-season
bowsers) · machinery (fuel, repairs, milking machine liners, generator diesel) ·
cooling · rent · loan repayments · **livestock insurance** · bedding & housing ·
licences & compliance (KDB permit, county business permit, milk-handler medicals)
· manure handling.

**Suppliers** are typed — agrovet, feed miller, hay supplier, AI provider, vet
practice, transporter, co-operative — with contact details, payment terms, credit
balance and purchase history. The co-op appears here as both a customer (milk)
and a supplier (check-off inputs), which is exactly how Kenyan dairy works.

**On M-Pesa, we start with records, not integration.** Full Daraja integration
needs business registration, a Paybill or a Till upgraded to bank settlement
(a Till settling to a personal M-Pesa number is **not eligible**), B2C approval,
and an always-reachable public callback. What the farm needs on day one is the
**transaction record** — who, how much, for what, when, and the M-Pesa
confirmation code — plus a **daily reconcile screen that ingests the M-Pesa CSV
statement** and matches it against recorded transactions. That delivers most of
the value at a fraction of the cost and approval burden. Daraja is a Phase 3
decision, taken only once the record-keeping is used daily.

**Gives back at entry:** the running month-to-date position and cost per litre,
updated with every entry, so an expense is never just a number going into a hole.

---

## M10 — Reports & Insights

**Who uses it:** owner primarily, manager daily.

**The rule that governs this module:** *reports state conclusions, not tables.*
Kenyan smallholder dairy farmers have education "not sufficient for making
complex computations and interpretations for key decision making." Every number
is paired with a sentence saying what to do about it. The test: show the owner
one report and ask "what should you do this week?" — they should answer without
reading a number twice.

**The three reports that matter most:**

1. **Money this month** — milk revenue by channel, costs by category, cost per
   litre (cash *and* full economic), margin over feed cost, and the single
   sentence that summarises the month.
2. **Cow league table** — every cow ranked by margin, with the loss-makers named
   and a recommended action for each.
3. **What needs doing this week** — the consolidated action list across breeding,
   health and feed, one line each: who, which animal, what action, by when.

**Then the standard set:** milk production (daily, monthly, per cow, lactation
curves) · breeding performance (calving interval, days open, age at first
calving, services per conception, conception rate, heat detection rate) ·
health (treatment history, withdrawal log, vaccination compliance, disease
incidence) · feed (consumption, cost per litre, days of cover, purchase history)
· payroll · herd inventory movement · **co-op reconciliation** · animal
profitability.

**Printing is a first-class output, not an afterthought.** A print stylesheet
comes before any PDF code — Chrome on Android prints to PDF natively and it works
offline. The **printable daily sheet mirrors the farm's existing notebook
layout** so the digital and paper records stay visually reconcilable. This is
deliberate: M-Pesa, the most trusted money system in Kenya, requires every agent
to keep a paper log alongside the digital record and does not consider that
redundant. Then: PDF for the animal passport and formal reports, Excel for
payroll and expenses (that is what an accountant wants), CSV as the universal
fallback that opens on any phone.

**Full data export is a headline feature.** Farmbrite users complain they cannot
export to Excel; vendor lock-in is failure #2 in the market. "You can leave
whenever you want" is a differentiator competitors cannot copy without
cannibalising themselves.

---

## M11 — Alerts & Notifications

*Cross-cutting. It is what makes every other module worth using.*

**The rule:** every alert names **one person, one animal, one action, one
deadline**, and is dismissed with an outcome that feeds back into accuracy. There
is a daily cap. We measure **action completion rate**, not alert volume — alert
fatigue is a documented failure mode where "the value is entirely contingent on
someone acting on the alerts."

**What generates alerts:** return-to-heat watch (21 days post-service) ·
pregnancy check due (60 days) · steaming-up start · dry-off due · calving
imminent · vaccination and deworming due · **milk withdrawal clearing** · low
feed stock · a cow's yield dropping · a heifer reaching breeding weight · a
casual approaching one month of continuous engagement · co-op statement variance.

**Channels:** in-app first. SMS for the owner's daily digest and for anything
time-critical, via Africa's Talking at roughly **KES 0.40–0.80 per message** —
note the CAK-approved Sender ID takes 2–5 business days and company letterhead,
so it is a lead-time item to start early. WhatsApp is worth considering for the
owner's weekly summary.

**Design the daily digest on the Sky Dairy pattern**, which is the highest-trust
feature in Kenyan co-operative dairy: a single SMS with what happened and the
running total. *"Mon 3 Aug: 187 L (AM 104, PM 83). Delivered 170 L. Value KES
8,840. Month to date: KES 231,400."*

---

## M12 — Support, Training & Contact

**Who uses it:** everyone.

**Does:** the client's "contact us in case of any issues" and "trainings and
seminars."

**Support** is in-app: a WhatsApp link (the channel Kenyan businesses actually
use), a phone number, and an issue form that attaches the current screen and sync
state automatically so the user doesn't have to describe a bug. Published
response times. This is the moat against foreign SaaS — none of them can service
a farm in Nyandarua, and *"they are really helpful when trying to sell it to you
but aftercare is zero"* is the most damning review in the whole market study.

**Training** is a content module: short how-to guides tied to each screen, plus a
farm-level library of seminars and trainings — scheduled sessions, attendance,
materials, trainer, cost. DigiCow's most-praised feature is **pre-recorded
vernacular audio training**, which is worth copying: audio in Swahili works for
users for whom text does not, and it costs almost nothing to host.

**Rollout support is part of the product, not a service afterthought.** Mercy
Corps, after reaching 16 million smallholders, concluded that *"the technology
itself will only get us so far."* Digital Green's 10× cost-effectiveness rests on
human mediation. Plan a named trainer on-farm for the first weeks and one
designated champion among the staff.

---

## Mapping to the client's brief

| Client's words | Module |
| -------------- | ------ |
| Expenses, outputs and inputs | M9, M10 |
| Selling dairy animals — in-calf, in-calf heifers, milkers, lactating, bulling heifers, calves | M7, with the class model in M1 |
| Buying different types of feeds — fodder, concentrates, salts | M5 |
| Employees onboarding, payment, farm managers | M8 |
| Other monthly bills | M9 |
| Feeding record per cow, per stage, in quantity or kg | M5 |
| Milk production and sales, other milk records for home use etc. | M3, M4 |
| Suppliers | M9 |
| Medication / health records from veterinary, and all these expenses | M6, costs flowing to M9 |
| Updates on cow process — calf, heifer, served, birth (breeding records) | M1 lifecycle + M2 |
| Reports from all the above | M10 |
| Contact us in case of any issues | M12 |
| Trainings and seminars | M12 |

**Added beyond the brief, and why:**

| Addition | Justification |
| -------- | ------------- |
| **Withdrawal-period enforcement** (M6) | One rejected bulk load can exceed a month's profit; 15–19% of Kenyan milk tests residue-positive |
| **Co-op statement reconciliation** (M4) | The #1 farmer grievance in Kenyan dairy, unserved by any competitor |
| **Margin over feed cost** (M5/M10) | Feed is 55–65% of cost; without it the farm cannot tell which cows lose money |
| **Alerts engine** (M11) | The mechanism that made iCow deliver +13% milk and +29% milk income |
| **Animal passport** (M1) | Unlocks insurance valuation, credit and premium sale prices |
| **Offline-first** (M0) | Rural internet use in Kenya is 21–28% |
| **Person-picker + PIN login** (M0) | Only 53.7% of Kenyans personally own the phone they use |
