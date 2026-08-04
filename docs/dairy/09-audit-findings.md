# 9. Audit findings

Four agents audited the built system against the live application: a workflow
walkthrough in a real browser, a performance and database measurement, a
usability audit against the evidence base in [01-findings.md](01-findings.md),
and a robustness and flexibility review.

**Nothing here has been implemented.** This document is the proposal.

---

## A. Usability audit

Static audit of 52 routes, 42 components, ~11,300 lines.

### A1 — 🔴 Offline is a comment, not a behaviour

`src/lib/outbox.ts` defines `flush()`, `startAutoFlush()` and
`describeSyncState()`. **None of the three is called anywhere in the
application.** The only consumer of the outbox is the milk sheet, and there:

```ts
// MilkSheetForm.tsx:62–86
try { await enqueue({ id: queueId, ... }); } catch {}
const result = await action(prev, formData);   // :76 — NOT in a try/catch
```

`action()` is a Server Action fetch. Offline it **rejects**, the rejection
escapes the `useActionState` reducer, and React unwinds to the nearest error
boundary. The herdsman gets a blank screen — no receipt, no reference code — and
the row he just wrote sits in IndexedDB that nothing will ever drain.

The queue key is `` `milk:${date}:${session}:${rows.length}` `` — the *character
length* of the JSON. Two different milkings whose payloads happen to be the same
length collide and overwrite each other.

Every other write in the system — treatment, service, calving, feed issue, the
delivery round — has no outbox at all.

**Cost:** the one failure mode the market study says permanently ends trust —
losing a record. A herdsman who loses one milking goes back to the notebook and
does not come back.

### A2 — 🔴 A cow under an *unknown* withdrawal period looks completely normal

`isWithheldReason()` exists in `milk.ts` and is **never imported by any
component**. In `MilkSheetForm.tsx` the border (`:214`), icon (`:225`) and block
(`:271`) all test `=== "WITHDRAWAL"` only. So the case the domain layer treats
most conservatively renders with a neutral grey border, a 🐄 icon, and an amber
note visually identical to "her yield dropped".

Downstream is worse. `sales/page.tsx:70` filters the withheld-animal names by
`a.reason === "WITHDRAWAL"`, so her litres count toward `withheldL` but her name
is dropped. If she is the only withheld cow the banner reads:

> **"12 L must not be sold today —  was treated."**

This is the third distinct way the same safety feature has failed open.

### A3 — 🔴 The treatment receipt's colour is inverted

`health/forms.tsx:234` — when there **is** a milk withdrawal the receipt is
amber; when there is **none** it is red ⛔. The ternary is the wrong way round,
on the one screen where colour must be exactly right.

### A4 — 🔴 Fifteen routes have no way back, in a standalone PWA

`manifest.ts:13` sets `display: "standalone"` — no browser chrome, no back
button. `layout.tsx` has no global header. The routes with no exit are the
**capture surface**: `/milk`, `/health/*`, `/feed/*`, `/sales/*`, `/herd`,
`/support`. Every money, people, reports and trading screen — the manager and
owner surfaces — has one.

The herdsman force-quits to get home, and every relaunch mid-milking is a chance
to lose a half-typed sheet.

### A5 — 🟠 Swahili is under 3% real

No i18n layer exists. Live Swahili totals **~36 strings**, all on `/support`,
against well over 1,000 user-facing strings. `CLASS_LABEL_SW` is written, has a
passing test, and is imported by nothing. `layout.tsx:21` hardcodes
`<html lang="en">`.

Kamau is seeded `language: "sw"`. He sees `"Habari, Kamau"`, then an English
application.

### A6 — 🟠 Contrast failures on the two most-used tokens

Computed, not estimated:

| Pair | Ratio | Needs | |
| ---- | ----- | ----- | - |
| `--color-line` on surface | **1.40** | 3.0 (WCAG 1.4.11) | ✗✗ |
| `--color-line` on paper | **1.23** | 3.0 | ✗✗ |
| `--color-ink-3` on paper | **3.72** | 4.5 | ✗ |
| `--color-ink-3` on surface | **4.24** | 4.5 | ✗ |

`--color-line` is used **117 times** and is the border of every text input,
select and checkbox. At 1.40:1 the boundary of a form control is effectively
invisible — in a dim shed at 5am on a fingerprinted screen, the herdsman cannot
see where the litres box is.

`--color-ink-3` is used **130 times, 69 of them at 12px** — every hint, every
reference code, every "same as yesterday" label.

Both are two-line token changes.

### A7 — 🟠 A new farm cannot set itself up

`createProduct`, `createFeedItem` and `createCustomerAction` exist as Server
Actions with **no UI at all**. The empty states form closed loops: `/health/treat`
says "add the drug first" and links nowhere; `/feed/purchase` says "add a feed to
the catalogue first" and links nowhere; `/sales/round` says standing orders build
the round, and there is no standing-order form.

The first screen a fresh deployment shows tells a farm owner to run
`npm run db:seed`.

### A8 — 🟠 `guard()` leaks raw database errors, in the withdrawal colour

`dal.ts:138` returns `err.message` verbatim, so a constraint violation surfaces
as `duplicate key value violates unique constraint "milk_record_pkey"`. These
render through `HardBlock`, which is documented as *"used only for withdrawal
periods"*. A network hiccup produces the same red ⛔ as "this milk will poison
the tank", diluting the only signal that must never be ignored.

`NotPermittedError` also prints the capability code: *"You do not have permission
to do this (RECORD)."*

### A9 — 🟠 Drug routes are shown as raw codes

`health/forms.tsx:195` renders `IM / IV / SC / PO / INTRAMAMMARY / TOPICAL /
INTRAUTERINE` directly. This is `rc=6` — the exact DairyComp mistake the product
exists not to repeat — sitting in the capture surface. Every other enum in the
codebase has a label map; this one was missed.

### A10 — 🟡 Smaller, all real

- **Heat timestamp prefills in UTC.** A heat observed at 05:00 EAT prefills as
  02:00; at 01:30 EAT it prefills as 22:30 *the previous day*. The AM/PM rule is
  the entire point of the field. `breeding/heat/page.tsx:20`.
- **Money is `required`** on both trading forms and the feed purchase — the other
  half of the fabricated-data failure. A sale with no agreed price forces an
  invented number into the cull list and the margin figures.
- **Three `.tap` anchors are ~20px tall** because `min-height` does nothing on an
  inline box — including "Do the group" on the health board, the route to weekly
  tick spraying.
- **`Receipt` has no `role="status"`** so the herdsman's withdrawal confirmation
  is not announced, while the accountant's expense receipt is.
- **Four nested `<label>` elements**; checkboxes render 24px wide × 48px tall
  because the global `input` rule overrides the utility class.
- **The PWA icons do not exist** — `dairy/public/` is not present, so both
  manifest icons 404 and the install prompt is suppressed on some Androids.
- **`"MPESA"` renders as `"Mpesa"`** in the money forms. It is the most
  recognised brand in the product's vocabulary and the anchor of its trust model.
- **Surveillance-toned copy**: *"3.5 L unaccounted for. Where did it go?"* is
  shown to any signed-in role with no action attached, and the flagged-milk queue
  attaches the recorder's name to a list of suspect numbers.

### A11 — Structural duplication behind several of the above

`Field`, `SubmitButton`, `ErrorBanner`, `MoreFields` and the receipt are each
implemented **four times** — `ui.tsx` plus three form-kits — and have drifted:
one takes `error?: string`, three take `errors?: string[]`; one has
`role="status"`, three do not. That is why the accessibility fix needs applying
in four places rather than one.

The icon vocabulary is also overloaded: 💉 means both vaccination and AI service,
🐄 means herd, batch health, calved, calving now, an ordinary milk row and buying
and selling.

### What is already good and should not be touched

1. **The milk sheet prefill.** A cow with history starts pre-accepted; a cow with
   none starts blank and unticked — *"nothing is invented on her behalf"*. Labels
   read "same as yesterday" or "same as Thu 31 Jul — 5 days ago".
2. **The sticky running total.** Thumb-reachable, live, honest about what is
   already saved.
3. **The withdrawal copy.** *"Do not sell Njeri's milk until Mon 11 Aug. She was
   treated — keep this milk out of the can."*
4. **The service receipt** — one date in, the whole calendar back.
5. **The calving receipt's economics** — calving interval against target and what
   the extra days cost in shillings. Nobody in this market does this.
6. **The alert dismissal model** — four outcomes, never a bare ×, and the header
   reports action completion rate rather than alert volume.
7. **The watchboard has no "mark as done"** — items clear because the record
   changed, which is exactly the competitor bug it names.
8. **The printable daily sheet** — mirrors the notebook, blank boxes not zeros
   (*"a zero is a claim nobody made"*). Do not modernise it.
9. **The PIN pad** — custom because the Android numeric keyboard covers the field
   it fills.
10. **`/herd` works with JavaScript off.** Zoom is deliberately enabled to 5×.
    Pull-to-refresh is disabled so it cannot eat a half-typed milking.

---

## B. Performance audit

All timings measured against a realistic load: 60 animals, two years of
twice-daily milking (**87,600 milk records**), 1,264 lifecycle events, 200 health
events, 500 feed issues, 730 disposals.

Measured on PGlite, where network round-trip is ~0. **On a real Postgres the
N+1 findings get worse, not better** — 404 queries × 2 ms RTT adds 0.8 s of pure
latency.

### B1 — The three changes with the best ratio

| # | Change | Measured before | Measured after | Effort |
| - | ------ | --------------- | -------------- | ------ |
| 1 | Move `LOSS_CHANNELS`/`REVENUE_CHANNELS` out of `db/schema.ts` | `/milk` ships **56.9 KB of drizzle-orm + the entire database schema** to the browser | 162 KB → 148.7 KB gzip First Load JS; **~2.1 s off the twice-daily screen on 2G** | **<1 hour** |
| 2 | Replace the per-day loop in `milkProduction` | **3,259 ms / 367 queries / 87,840 rows** (year report) | **6.0 ms / 1 query — 540×** | Low |
| 3 | Batch `animalFacts` across the herd | **528 ms / 404 queries** | **8.2 ms / 6 queries — 64×** | Medium |

Change 3 fixes `cullList`, `cowLeagueTable` and `sellCandidates` at once — they
all funnel through the same per-animal loop — and takes `/reports` from 623 ms to
roughly 100 ms.

### B2 — The bundle leak, exactly one line

```ts
src/lib/domain/milk.ts:5
import { LOSS_CHANNELS, REVENUE_CHANNELS, type DisposalChannel } from "@/db/schema";
```

Those are **runtime values, not types**. The milk sheet imports
`checkYieldPlausibility` from this module, which drags `@/db/schema` and
therefore `drizzle-orm/pg-core` across the client boundary. The browser
downloads drizzle's entity-kind machinery and **328 table, column and index
names** — every table in the app.

Every other domain module gets this right with `import type`. This is the only
offender.

**`zod` is clean** — zero hits in any client chunk. The `"use server"` discipline
is working.

### B3 — Full timings

```
milkProduction (year)     3259 ms   367 q   87,840 rows
cowLeagueTable (90d)       576 ms   404 q   23,177 rows
cullList (90d)             529 ms   404 q
sellCandidates             489 ms   506 q
milkSheet  ← twice daily   146 ms     9 q    6,437 rows
listHerd                    35 ms     9 q
dayProduction                6.6 ms   1 q
withdrawalMap                1.9 ms   1 q
```

`cullList` re-fetches the same animal row **57 times** — rows already in memory.

### B4 — Indexes are fine; query *count* is the problem

`EXPLAIN ANALYZE` confirms the existing indexes are used correctly and are well
matched to the real WHERE/ORDER BY clauses. Each individual `animalFacts` query
runs in 0.03 ms — it is the 392 of them that cost half a second.

**One real gap:** `flaggedQueue` has no index covering `flagged`, so it does a
Bitmap Heap Scan over 87,600 rows taking 20 ms **to return zero results**. A
one-line partial index fixes it — the cheapest win in the entire audit.

### B5 — `Promise.all` is not buying anything (honest negative)

Measured: `/reports` serial 622.9 ms vs `Promise.all` 603.3 ms — **3%**. PGlite
executes one query at a time, so every `Promise.all` in the codebase is
serialising anyway. **Do not spend effort here; spend it on query count.**

### B6 — Payload is fine (honest negative)

RSC payloads are **1–2 KB gzipped per page** — they compress ~15:1. The 129
`select()` calls with no column list cost server time and disk I/O, not user
bytes. My concern here was unfounded.

### B7 — The 2G reality

| | gzip | 2G transfer at ~50 kbps |
| - | ---- | ----------------------- |
| Shared JS (React 19 + App Router floor) | 129.3 KB | **20.7 s** |
| `/milk` First Load JS | 162.0 KB | **25.9 s** |
| The drizzle leak alone | 13.3 KB | **2.1 s** |

The 129 KB floor is not reducible without changing framework posture. Only ~13 KB
of it is ours to cut — but that 13 KB is free.

### B8 — Caching: the plumbing was built and never connected

**30+ `updateTag()` calls** exist across six modules, tagging `herd:${farmId}`,
`milk:${farmId}`, `withdrawal:${farmId}`, `money:${farmId}`. There are **zero**
occurrences of `use cache`, `cacheLife` or `cacheTag`, and `cacheComponents` is
off.

Per the Next 16 docs, tags must first be assigned to cached data. **Every one of
those 30+ calls currently invalidates nothing.** The invalidation half is
written; the caching half is missing.

All 48 pages are `force-dynamic` and there are **zero `<Suspense>` boundaries**,
so TTFB on `/reports` is the full 623 ms before a single byte leaves the server.

`milkSheet` and `withdrawalMap` must stay uncached — they carry a food-safety
control.

---

## C. Robustness and flexibility audit

### C1 — 🔴 The outbox is never drained (confirms A1 independently)

`flush()` and `startAutoFlush()` are called from nowhere. The chip says "Saved on
phone (1 waiting)" and **it is a lie** — nothing will ever send it. There is also
no service worker, so offline the app is a Chrome dinosaur.

### C2 — 🔴 Two phones recording the same milking double-count it *(verified)*

`milk_record` has **no unique constraint** on `(farm_id, animal_id, recorded_on,
session)` — only indexes. De-duplication relies entirely on the client row id,
and `MilkSheetForm` mints a **new** id on every page load for any unsaved row.

The agent ran it:

```
save1 savedCount=1   save2 savedCount=1
milk rows stored: 2 ['12.00','12.00']
dayProduction totalL: 24
```

**12 L becomes 24 L**, and it propagates into the withdrawal guard's saleable
pool, margin over feed cost, the cow league table and the co-op reconciliation
variance — wrong in the farm's favour, which is the direction nobody checks.

### C3 — 🔴 The 60-second idle timeout is not implemented

`IDLE_TIMEOUT_SECONDS = 60` is exported and **used nowhere**. The session cookie
lasts **12 hours**, and `signOut` is wired to exactly one place: the "Not you?"
link.

On the shared phone this product is built around, the first herdsman who signs in
at 5am owns the session all day. Every milking, treatment, delivery and payment
by the next three herdsmen is attributed to him. **Segregation of duties — the
stated anti-theft control — silently fails, and the audit trail is wrong in
exactly the way that matters when money goes missing.**

### C4 — 🔴 A herdsman can read every customer's debt *(verified)*

`sales.ts` has no capability helper at all. Eight read functions check ownership
but never capability, and the pages call only `verifySession()`.

```
HERDSMAN debtorAging total: 50000  debtors: 1
HERDSMAN channelMix ok
```

The DAL says *"See money at all. Herdsmen never do."* Hiding the home tile is not
a boundary — the DAL's own docblock says so.

### C5 — 🔴 `recordSale` loses the money if it half-fails

No transaction, non-deterministic ids. If the process dies between the exit
insert and the income insert, the cow is out of the herd and the KES 180,000 is
not in the books — and on retry the unique constraint returns *"already left the
herd"*, so **the income is never posted**. For an in-calf heifer sale this is the
largest transaction a smallholder makes all year.

Only one multi-step write in the whole app is transactional (calving), and even
that leaves alert creation outside the transaction.

### C6 — 🟠 PIN brute force is weak in three compounding ways

It is a **60-second rolling window, not a lockout** — 5 tries/minute is
**7,200/day** against a 10,000-space PIN, and real PINs cluster. The limiter is
an in-memory `Map`, so a restart or a second instance zeroes it. And `/login` is
public and **hands out the target list**: every staff member's id, name, photo
and role, unfiltered by `active`.

### C7 — 🟠 Twenty-one of twenty-three disputed figures need a redeploy

The `referenceValue` table is correctly designed. **Exactly one thing reads it.**
One more is wired but broken: the CBK rate query looks for
`kind='RATE', key='CBK_BASE'` while the seed writes
`kind='CBK_BASE_RATE', key='PCT_PER_ANNUM'` — they never match, so late-payment
interest always uses the hard-coded fallback. That query also omits `farmId`.

Hard-coded and needing a developer: payroll rates including the disputed SHIF
employer figure, the agricultural minimum wage table, gestation lengths (whose
comment claims it is configurable — no such read exists), the breeding calendar,
withdrawal fallbacks, the vaccination calendar (a `routine_schedule` table exists
and is never read or written), feed unit weights, the concentrate rule, cost of
production, the farm-gate benchmark, and the cull-list constants that decide
which cow gets sold.

**There is no UI to set a milk price.** The only insert into `price_list` is the
seed. Changing the most-used configurable in the system requires SQL.

### C8 — 🟠 Production blockers

- **PGlite is single-writer, single-threaded, and takes a directory lock.** Any
  second process crashes at boot or silently diverges. There is also no
  migration path: `drizzle.config.ts` has no credentials, `ddl.sql` is not
  idempotent, and PGlite has no `pg_dump` — so the "it's just a `pg_dump`" claim
  in the source is not achievable with the tooling present.
- **No error boundary anywhere.** A herdsman who types `/money` gets Next's raw
  "Application error" with a digest hash.
- **Zero observability.** No logger, no `console.error`, nothing. `guard()`
  swallows every exception and returns `err.message` to the browser — a
  constraint violation reaches the herdsman as
  `duplicate key value violates unique constraint`.
- **`today()` is UTC.** Kenya is UTC+3, so anything recorded between midnight and
  3am is filed on the previous day — including a night treatment, which sets the
  withdrawal clock.
- **No backup of `.pgdata` at all**, and the "take your data with you" export
  omits `calving_outcome` (the calf-to-dam link), `product` (**the legally
  operative withdrawal periods**), prices and reference data.

### C9 — 🟠 What a second, different farm hits

Three milkings a day and processor-only sales mostly work. **Weekly payroll is
impossible** — the schema keys payroll on a month with a unique constraint. A
breed outside the nine hard-coded gestation lengths silently gets 283 days,
putting every calving, dry-off and steaming-up date wrong.

`createProduct`, `createFeedItem`, `createCustomerAction`, `createStandingOrder`,
`createInvoiceAction` and `updateEmployee` are all `"use server"` actions
**imported by nothing**. A new farm cannot add a drug, a feed, a customer or a
standing order without SQL.

**RLS does not exist anywhere** — zero policies, and `app.farm_id` appears
nowhere. Login is hard-wired to `select().from(farm).limit(1)` with no
`ORDER BY`. There is no way to create a farm, a user or a PIN outside the seed
script.

### C10 — What is genuinely solid

Idempotency design where it is applied (client UUIDs, deterministic linked ids,
seven unique constraints) — the agent could not break it. **All 45 Server Actions
have capability checks** — none missing. The M-Pesa CSV importer handles
preambles, column aliases, three date formats, quoted fields, negative and
parenthesised amounts, and in-file duplicates without throwing. Money is
`numeric` throughout, never float. Append-only supersession is applied
consistently across all six modules that read milk. No hard deletes. Nothing
sensitive is logged.
