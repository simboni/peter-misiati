# 7. Roadmap

Build order is driven by one rule: **the farm must get value before it has
finished entering data.** Every phase ends with something the farm would miss if
you took it away.

---

## Phase 0 — Foundation (est. 3–5 days)

Nothing user-visible. Everything depends on it.

- `dairy/` scaffolded as an independent Next.js 16.2 app, `cacheComponents: true`
- Root `tsconfig.json` and ESLint updated to exclude `dairy/` ⚠ (see
  [06-architecture.md §6.6](06-architecture.md#66-repository-layout))
- Postgres + Drizzle, migrations, seed script
- Multi-tenant scaffolding: `farm_id` everywhere, RLS policies, the DAL
- Better Auth with the phone plugin; person-picker + PIN login
- PWA shell: manifest, service worker, Dexie outbox, the sync chip
- The receipt/reference-code primitive
- Reference data seeded: breeds and gestation lengths, feed units, Kenyan
  statutory rates, the withdrawal-period product master

**Exit criterion:** a herdsman can log in on a cheap Android in airplane mode,
and a write survives a reboot and syncs on reconnect.

---

## Phase 1 — The daily loop (est. 1.5–2 weeks)

**M1 Herd · M3 Milk · M4 Milk sales**

This is the smallest thing that is genuinely useful. A farm could run on Phase 1
alone and be better off than with its notebook.

- Animal register, derived class, herd list, the digital cow card
- Herd import from spreadsheet — the one heavy data-entry day
- **The milk sheet**: bulk entry, prefilled from yesterday, colostrum
  auto-detected, out-of-range warns and saves flagged, running total, receipt
- Milk allocation across channels, daily reconciliation with visible variance
- **Customers and the three sales channels** — co-op/processor, institution,
  household — with per-customer pricing
- **Standing orders and the delivery round**, prefilled, rider edits exceptions
- **Customer ledger**: delivery debits, payment credits, running balance,
  credit-limit warning before delivery
- Daily printable sheet mirroring the paper layout
- Owner's daily SMS digest

**Exit criterion:** the whole herd's morning milking is recorded in under three
minutes offline; the delivery round for 13 customers takes under two minutes; and
the owner gets an SMS with litres, value and cash-versus-credit by 18:30.

---

## Phase 2 — The value engine (est. 2–2.5 weeks)

**M2 Breeding · M6 Health · M11 Alerts**

This is where the system stops being a record book and starts paying for itself.

- Heat → service → return watch → PD → calving chain, with the calendar shown
  **at the moment of entry**
- Return-interval interpretation (missed heat vs early loss vs normal return)
- Calving creates the calf, its first-year schedule, and the new lactation
- Abortion → brucellosis workflow
- **The withdrawal engine** — product master, computed clear dates, hard block on
  the milking sheet and the disposal path, plain-language receipt
- Batch routines: dip, spray, deworm the whole herd in one action
- Vaccination schedules with S19 and ECF-ITM validation
- The alerts engine: one person, one animal, one action, one deadline; daily cap;
  dismissal with outcome

**Exit criterion:** recording one AI service produces a visible calendar out to
calving, and treating one cow visibly locks her milk on tomorrow's sheet.

---

## Phase 3 — The money (est. 2–2.5 weeks)

**M5 Feed · M9 Expenses & suppliers · M7 Trading**

- Feed items, purchases with mandatory unit weights, store balances, issues
- Days-of-cover alerts
- **Margin over feed cost per litre — the home-screen number**
- Fodder production records
- Chart of accounts, expenses, income, suppliers, receipt photos
- M-Pesa transaction records + **CSV statement import and daily reconcile**
- Animal purchases and sales with Kenyan price drivers
- The cull list, ranked by margin
- **Customer statements, institutional invoices, debtor aging and write-offs**
- **Blended price per litre across channels**, against bad debt written off

**Exit criterion:** the owner can answer "which of my cows are losing me money",
"what did milk actually cost me to produce this month", and "who owes me what,
and for how long."

---

## Phase 4 — People and the co-op (est. 1.5–2 weeks)

**M8 Payroll · M4 co-op reconciliation**

- Employees, onboarding, attendance, casual-conversion warning
- Payroll: PAYE with personal relief, NSSF Tier I/II, SHIF, Housing Levy —
  **including the zero-PAYE case**
- Leave accrual, advances, milk ration in kind
- Payslips, statutory remittance summary for the 9th
- **Co-op statement entry and line-by-line reconciliation** — the differentiating
  screen

**Exit criterion:** payroll runs correctly for a herdsman on KES 12,000, and the
month's co-op cheque is explained deduction by deduction.

---

## Phase 5 — Reports, support, polish (est. 1.5 weeks)

**M10 Reports · M12 Support & training**

- The three headline reports: money this month, cow league table, what needs
  doing this week — **conclusions, not tables**
- Full standard report set
- Print stylesheets, PDF animal passport, Excel payroll and expenses, CSV export
- Support: WhatsApp link, ticket form with auto-captured screen and sync state
- Training library, seminar records, Swahili audio guides
- Swahili UI toggle
- Accessibility pass: every screen operable with the text ignored

**Exit criterion:** the owner reads one report and can say what to do this week
without re-reading a number.

---

## Phase 6 — Hardening and rollout (est. 1 week + on-farm time)

- The DP test suite from
  [03-modules.md](03-modules.md#universal-rules-that-apply-to-every-module):
  stopwatch the milk round, airplane-mode 50-record test, blur-the-text test,
  four-herdsmen-one-phone test, deliberate-wrong-default test
- Migration to the go-live host (Oracle Always Free, Johannesburg)
- Backups, monitoring, error tracking
- On-farm training week with a named trainer and a designated staff champion
- Instrument **records entered per active user per week** before launch

---

## Timeline

**Roughly 10–12 weeks of focused solo work** to a system a farm runs its business
on. Phase 1 alone is useful in ~3 weeks.

| Phase | Weeks | Cumulative |
| ----- | ----- | ---------- |
| 0 Foundation | 0.5–1 | 1 |
| 1 Daily loop | 1.5–2 | 3 |
| 2 Value engine | 2–2.5 | 5.5 |
| 3 Money | 2–2.5 | 8 |
| 4 People & co-op | 1.5–2 | 10 |
| 5 Reports & polish | 1.5 | 11.5 |
| 6 Hardening & rollout | 1 | 12.5 |

---

## What we deliberately are not building in v1

| Deferred | Why | When |
| -------- | --- | ---- |
| **M-Pesa Daraja integration** | Needs business registration, a Paybill or a Till upgraded to bank settlement, B2C approval, and an always-reachable public callback. Records + CSV reconcile delivers most of the value at a fraction of the cost | After the record-keeping has been used daily for 3 months |
| **USSD / feature-phone entry** | Real need for smallholders, but our users are farm staff with Android access. Adds a whole second interface | If the client expands to a co-operative model |
| **Bidirectional sync engine (PowerSync)** | The outbox queue is sufficient and a sync engine is the #1 way a solo dev sinks a project | When the outbox demonstrably hurts |
| **Sensors, IoT, wearables** | ~€150/cow capex, sensor attrition, alert fatigue. Wrong economics for this segment | Never, unless the client asks |
| **Sign-up and billing surface** | Multi-tenancy is in the schema; the commercial surface isn't needed until customer two | When there is a second farm |
| **ICAR ADE data exchange** | Genuinely valuable for portability, but no Kenyan counterpart consumes it yet | When KLBA/DRSK integration becomes real |
| **Swahili voice notes** | DigiCow's most-praised feature; cheap to host, but content production is the cost | Phase 5+, if training uptake justifies it |

---

## The acceptance tests that matter

Each traces to a research finding, and each is falsifiable on the actual farm.

| # | Test | Fails if |
| - | ---- | -------- |
| 1 | Stopwatch five herdsmen over five days on the milk round | Median exceeds 15 s/cow |
| 2 | Field count on every routine entry screen | Any screen exceeds 5 fields |
| 3 | Airplane mode: 50 records, then reboot the phone | Any record lost, or sync fails on reconnect |
| 4 | Blur all text in screenshots, ask a non-reader to record a milking | They cannot complete it |
| 5 | Four herdsmen, one phone, 20 entries | Any cross-attribution error |
| 6 | Treat a cow, then try to sell her milk | The sale is permitted |
| 7 | Inject an implausible yield | It is rejected rather than saved-and-flagged |
| 8 | Deliberately wrong prefilled default | The herdsman doesn't catch it — the label isn't clear enough |
| 9 | Try to make an unapproved staff payment affect a report | It succeeds |
| 10 | Print the daily sheet, ask the manager to find yesterday's evening milking | Takes more than 10 seconds |
| 10a | Run a 13-customer household round on the rider's phone, offline | Takes more than 2 minutes, or any balance is wrong afterwards |
| 10b | Deliver to a customer already over their credit limit | The warning does not fire **before** the delivery is recorded |
| 10c | Allocate 187 L across channels where the parts sum to 185 | The 2 L discrepancy is not surfaced |
| 11 | Show the owner one report, ask "what should you do this week?" | They must read a number twice to answer |
| 12 | Payroll for a herdsman on KES 12,000 | PAYE is not zero, or NSSF/SHIF/Housing Levy are skipped |

**And the metric we track after launch: records entered per active user per
week.** Never registrations.
